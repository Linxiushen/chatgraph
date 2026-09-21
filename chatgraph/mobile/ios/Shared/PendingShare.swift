import Foundation
import Darwin

struct PendingShare: Codable, Identifiable {
    var id: String = UUID().uuidString.lowercased()
    var title: String = ""
    var text: String = ""
    var url: String = ""
    var fileName: String = ""
    var createdAt: Double = Date().timeIntervalSince1970 * 1000

    var bytes: Int { title.utf8.count + text.utf8.count + url.utf8.count + fileName.utf8.count }
    var label: String { !title.isEmpty ? title : (!fileName.isEmpty ? fileName : (!text.isEmpty ? "一段对话文字" : "待补原文的链接")) }
    var preview: String { String((!text.isEmpty ? text : url).prefix(1000)) }

    func validated() throws -> PendingShare {
        guard UUID(uuidString: id) != nil else { throw ShareFailure("收件标识无效。") }
        guard createdAt.isFinite, createdAt > 0 else { throw ShareFailure("收件时间无效。") }
        guard title.utf8.count <= 4096, url.utf8.count <= 8192, fileName.utf8.count <= 1024,
              text.utf8.count <= (fileName.isEmpty ? 2 : 25) * 1024 * 1024 else {
            throw ShareFailure("文字最多 2 MB，对话文件最多 25 MB。")
        }
        if !fileName.isEmpty {
            guard ["txt", "md", "markdown", "json"].contains(URL(fileURLWithPath: fileName).pathExtension.lowercased()) else {
                throw ShareFailure("仅接收 UTF-8 TXT、Markdown、JSON 文件。")
            }
        }
        guard !text.unicodeScalars.contains(where: { $0.value < 32 && ![9, 10, 13].contains($0.value) }) else {
            throw ShareFailure("内容不是可读取的 UTF-8 文字。")
        }
        if !url.isEmpty {
            guard let value = URL(string: url), ["https", "http"].contains(value.scheme?.lowercased() ?? ""),
                  value.host != nil, value.user == nil, value.password == nil else {
                throw ShareFailure("来源链接需要有效的 HTTP 或 HTTPS 地址。")
            }
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !url.isEmpty else {
            throw ShareFailure("没有收到对话文字或链接。")
        }
        return self
    }

    static func readFile(_ source: URL, fileName: String? = nil) throws -> PendingShare {
        let name = fileName ?? source.lastPathComponent
        guard ["txt", "md", "markdown", "json"].contains(URL(fileURLWithPath: name).pathExtension.lowercased()) else {
            throw ShareFailure("仅接收 UTF-8 TXT、Markdown、JSON 文件。")
        }
        let granted = source.startAccessingSecurityScopedResource()
        defer { if granted { source.stopAccessingSecurityScopedResource() } }
        let attributes = try source.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard attributes.isRegularFile == true, (attributes.fileSize ?? Int.max) <= 25 * 1024 * 1024 else {
            throw ShareFailure("请选择不超过 25 MB 的对话文件。")
        }
        let data = try Data(contentsOf: source, options: .mappedIfSafe)
        guard data.count <= 25 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else {
            throw ShareFailure("文件必须是 UTF-8 编码，且不超过 25 MB。")
        }
        return try PendingShare(title: URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent, text: text, fileName: name).validated()
    }
}

struct ShareFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// The extension and host serialize updates through a shared file lock.
/// No transcript is stored in a URL, UserDefaults or logs.
enum ShareStore {
    static let ttl: Double = 24 * 60 * 60 * 1000

    private static func directory() throws -> URL {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "ChatGraphAppGroup") as? String,
              let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw ShareFailure("App Group 未配置。请使用同一开发者团队签名 App 和分享扩展。")
        }
        let directory = root.appendingPathComponent("PendingShares", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        return directory
    }

    private static func locked<T>(in directory: URL, _ operation: (URL) throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let descriptor = open(directory.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw ShareFailure("无法打开本机收件箱。") }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw ShareFailure("本机收件箱正在使用，请重试。") }
        defer { flock(descriptor, LOCK_UN) }
        return try operation(directory)
    }

    private static func records(in directory: URL) throws -> [PendingShare] {
        let now = Date().timeIntervalSince1970 * 1000
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .compactMap { file -> PendingShare? in
                let item: PendingShare
                do {
                    let attributes = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                    guard attributes.isRegularFile == true, (attributes.fileSize ?? Int.max) <= 50 * 1024 * 1024 + 32768 else {
                        throw ShareFailure("收件文件格式无效。")
                    }
                    let data = try Data(contentsOf: file, options: .mappedIfSafe)
                    item = try JSONDecoder().decode(PendingShare.self, from: data).validated()
                } catch {
                    // A protection/read error or interrupted/corrupt receipt is
                    // not evidence that the user asked to discard the original.
                    throw ShareFailure("部分收件内容暂时无法读取，原件已保留。请稍后重试。")
                }
                if item.createdAt < now - ttl {
                    try FileManager.default.removeItem(at: file)
                    return nil
                }
                // Keep future timestamps: correcting the device clock must not
                // erase a share that was valid when it was saved.
                return item
            }.sorted { $0.createdAt > $1.createdAt }
    }

    static func list() throws -> [PendingShare] { try list(in: directory()) }
    static func list(in directory: URL) throws -> [PendingShare] { try locked(in: directory) { try records(in: $0) } }

    static func save(_ value: PendingShare) throws { try save(value, in: directory()) }
    static func save(_ value: PendingShare, in directory: URL) throws {
        var item = try value.validated()
        try locked(in: directory) { directory in
            let current = try records(in: directory)
            item.createdAt = current.first(where: { $0.id == item.id })?.createdAt ?? Date().timeIntervalSince1970 * 1000
            let others = current.filter { $0.id != item.id }
            guard others.count < 5, others.reduce(item.bytes, { $0 + $1.bytes }) <= 50 * 1024 * 1024 else {
                throw ShareFailure("本机收件箱已满（最多 5 条、合计 50 MB）。请打开 ChatGraph 整理或删除。")
            }
            let data = try JSONEncoder().encode(item)
            try data.write(to: directory.appendingPathComponent("\(item.id).json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    static func remove(_ id: String) throws {
        try remove(id, in: directory())
    }
    static func remove(_ id: String, in directory: URL) throws {
        guard UUID(uuidString: id) != nil else { throw ShareFailure("收件标识无效。") }
        try locked(in: directory) { directory in
            let file = directory.appendingPathComponent("\(id).json")
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        }
    }

    static func clear() throws { try clear(in: directory()) }
    static func clear(in directory: URL) throws {
        try locked(in: directory) { directory in
            for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                where file.pathExtension == "json" {
                try FileManager.default.removeItem(at: file)
            }
        }
    }
}
