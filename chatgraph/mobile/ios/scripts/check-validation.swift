import Foundation

@main
struct ValidationChecks {
    static func main() throws {
        var checks = 0
        func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
            guard try condition() else { throw ShareFailure("Check failed: \(message)") }
            checks += 1
        }
        func rejects(_ operation: () throws -> Void) throws {
            do { try operation() }
            catch { checks += 1; return }
            throw ShareFailure("Expected invalid input rejection")
        }
        let original = "用户：你怎么看？\n助手：可以用图谱梳理。🧠"
        let record = try PendingShare(text: original).validated()
        try require(record.text == original, "Chinese and Unicode text retained")
        try rejects { _ = try PendingShare().validated() }
        try rejects { _ = try PendingShare(text: "a\u{0000}b").validated() }
        try rejects { _ = try PendingShare(text: String(repeating: "a", count: 2 * 1024 * 1024 + 1)).validated() }
        try rejects { _ = try PendingShare(url: "https://name:secret@example.com").validated() }
        try rejects { _ = try PendingShare(url: "file:///private/document.txt").validated() }
        let link = try PendingShare(url: "https://chatgpt.com/share/example").validated()
        try require(link.text.isEmpty, "link is not a transcript")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let providerTemporaryURL = directory.appendingPathComponent("provider.tmp")
        try Data(original.utf8).write(to: providerTemporaryURL)
        let file = try PendingShare.readFile(providerTemporaryURL, fileName: "对话.md")
        try require(file.text == original && file.fileName == "对话.md", "provider display filename retained")
        try rejects { _ = try PendingShare.readFile(providerTemporaryURL, fileName: "image.png") }
        try Data([0xff, 0xfe, 0x00]).write(to: providerTemporaryURL)
        try rejects { _ = try PendingShare.readFile(providerTemporaryURL, fileName: "bad.txt") }
        let roundTrip = try JSONDecoder().decode(PendingShare.self, from: JSONEncoder().encode(record))
        try require(roundTrip.id == record.id && roundTrip.text == original, "durable JSON round trip")
        let queue = directory.appendingPathComponent("queue", isDirectory: true)
        try ShareStore.save(record, in: queue)
        let queued = try ShareStore.list(in: queue)
        try require(queued.count == 1 && queued[0].text == original, "native queue durable round trip")
        var future = record
        future.createdAt = Date().timeIntervalSince1970 * 1000 + 60_000
        let receipt = queue.appendingPathComponent("\(record.id).json")
        try JSONEncoder().encode(future).write(to: receipt, options: .atomic)
        try require(try ShareStore.list(in: queue).count == 1, "device clock rollback does not erase original")
        let corrupted = Data("partial receipt still needed for recovery".utf8)
        try corrupted.write(to: receipt, options: .atomic)
        try rejects { _ = try ShareStore.list(in: queue) }
        try require(try Data(contentsOf: receipt) == corrupted, "unreadable receipt is preserved")
        try rejects { try ShareStore.save(PendingShare(text: "another original"), in: queue) }
        try require(try Data(contentsOf: receipt) == corrupted, "new writes cannot bypass unreadable queue capacity")
        try ShareStore.remove(record.id, in: queue)
        var stale = PendingShare(text: "分享表单打开超过一天后确认保存")
        stale.createdAt = Date().timeIntervalSince1970 * 1000 - ShareStore.ttl - 1000
        try ShareStore.save(stale, in: queue)
        try require(try ShareStore.list(in: queue).first?.text == stale.text, "explicit save starts a fresh retention period")
        var expired = stale
        expired.createdAt = Date().timeIntervalSince1970 * 1000 - ShareStore.ttl - 1000
        try JSONEncoder().encode(expired).write(to: queue.appendingPathComponent("\(stale.id).json"), options: .atomic)
        try require(try ShareStore.list(in: queue).isEmpty, "confirmed expired receipt is still cleaned")
        for index in 0..<5 { try ShareStore.save(PendingShare(text: "distinct share \(index)"), in: queue) }
        try rejects { try ShareStore.save(PendingShare(text: "sixth"), in: queue) }
        try require(try ShareStore.list(in: queue).count == 5, "queue limit preserves the existing five receipts")
        try ShareStore.clear(in: queue)
        try require(try ShareStore.list(in: queue).isEmpty, "explicit clear removes receipts")
        print("Passed \(checks) iOS native input validation checks.")
    }
}
