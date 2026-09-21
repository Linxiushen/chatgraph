import UIKit
import UniformTypeIdentifiers

@MainActor
final class ShareViewController: UIViewController {
    private let preview = UITextView()
    private let status = UILabel()
    private let saveButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private var pending: PendingShare?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let title = UILabel()
        title.text = "保存到 ChatGraph"
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        let notice = UILabel()
        notice.text = "仅接收这次分享的内容。若只有链接，请在工作区补充对话原文。确认后保存在本机，24 小时内打开 ChatGraph 整理。"
        notice.numberOfLines = 0
        notice.font = .preferredFont(forTextStyle: .footnote)
        notice.textColor = .secondaryLabel
        preview.isEditable = false
        preview.font = .preferredFont(forTextStyle: .body)
        preview.backgroundColor = .secondarySystemBackground
        preview.layer.cornerRadius = 12
        preview.accessibilityLabel = "分享内容预览"
        status.numberOfLines = 0
        status.font = .preferredFont(forTextStyle: .footnote)
        status.text = "正在读取分享内容…"
        saveButton.setTitle("保存到本机收件箱", for: .normal)
        saveButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        saveButton.isEnabled = false
        saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
        cancelButton.setTitle("取消", for: .normal)
        cancelButton.addTarget(self, action: #selector(close), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, notice, preview, status, saveButton, cancelButton])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            preview.heightAnchor.constraint(greaterThanOrEqualToConstant: 100),
            saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            cancelButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
        Task { await loadShare() }
    }

    private func loadShare() async {
        do {
            let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
            let providers = items.flatMap { $0.attachments ?? [] }
            let attributedText = items.compactMap { $0.attributedContentText?.string }.joined(separator: "\n\n")
            guard (!providers.isEmpty || !attributedText.isEmpty), providers.count <= 8 else {
                throw ShareFailure("请分享一段文字、一个链接或一个对话文件。")
            }
            var values: [PendingShare] = []
            for provider in providers { values.append(try await Self.read(provider)) }
            if providers.isEmpty { values.append(try PendingShare(text: attributedText).validated()) }
            let files = values.filter { !$0.fileName.isEmpty }
            guard files.count <= 1 else { throw ShareFailure("一次只接收一个对话文件，请分别分享。") }
            var record: PendingShare
            if let file = files.first { record = file }
            else {
                let texts = values.map(\.text).filter { !$0.isEmpty }
                let urls = Array(Set(values.map(\.url).filter { !$0.isEmpty }))
                guard urls.count <= 1 else { throw ShareFailure("一次只接收一个来源链接，请分别分享。") }
                let title = String((items.first?.attributedTitle?.string ?? "").prefix(200))
                record = PendingShare(title: title, text: texts.joined(separator: "\n\n"), url: urls.first ?? "")
            }
            record = try record.validated()
            pending = record
            preview.text = String((record.text.isEmpty ? record.url : record.text).prefix(6000))
                + (record.text.count > 6000 ? "\n…（预览已截短，保存保留完整内容）" : "")
            status.text = record.fileName.isEmpty ? "检查后保存；不会自动发送给 AI。" : "文件：\(record.fileName) · \(record.bytes / 1024) KB"
            saveButton.isEnabled = true
        } catch {
            status.text = error.localizedDescription
            status.textColor = .systemRed
        }
    }

    private static func read(_ provider: NSItemProvider) async throws -> PendingShare {
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            return try await withCheckedThrowingContinuation { continuation in
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { value, error in
                    do {
                        if let error { throw error }
                        let url = (value as? URL) ?? (value as? String).flatMap(URL.init(string:))
                        guard let url, url.isFileURL else { throw ShareFailure("无法读取分享的文件。") }
                        continuation.resume(returning: try PendingShare.readFile(url))
                    } catch { continuation.resume(throwing: error) }
                }
            }
        }
        let suggested = provider.suggestedName ?? ""
        let fileExtension = URL(fileURLWithPath: suggested).pathExtension.lowercased()
        if ["txt", "md", "markdown", "json"].contains(fileExtension),
           let identifier = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .data) == true }) {
            return try await withCheckedThrowingContinuation { continuation in
                provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
                    do {
                        if let error { throw error }
                        guard let url else { throw ShareFailure("无法读取分享的文件。") }
                        // Temporary provider URLs are valid only inside this callback.
                        let record = try PendingShare.readFile(url, fileName: suggested)
                        continuation.resume(returning: try record.validated())
                    } catch { continuation.resume(throwing: error) }
                }
            }
        }
        let identifier: String
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) { identifier = UTType.plainText.identifier }
        else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) { identifier = UTType.url.identifier }
        else { throw ShareFailure("仅接收文字、HTTP(S) 链接和 UTF-8 TXT、Markdown、JSON 文件。") }
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: identifier, options: nil) { value, error in
                do {
                    if let error { throw error }
                    if let url = value as? URL {
                        if url.isFileURL { continuation.resume(returning: try PendingShare.readFile(url)); return }
                        continuation.resume(returning: try PendingShare(url: url.absoluteString).validated()); return
                    }
                    let string: String?
                    if let value = value as? String { string = value }
                    else if let value = value as? Data, value.count <= 2 * 1024 * 1024 { string = String(data: value, encoding: .utf8) }
                    else { string = nil }
                    guard let string else { throw ShareFailure("分享内容不是可读取的文字。") }
                    let record = identifier == UTType.url.identifier ? PendingShare(url: string) : PendingShare(text: string)
                    continuation.resume(returning: try record.validated())
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    @objc private func save() {
        guard let pending else { return }
        saveButton.isEnabled = false
        do {
            try ShareStore.save(pending)
            status.textColor = .label
            status.text = "已保存，请打开 ChatGraph。内容仍在本机，尚未发送给 AI。"
            preview.text = "已保存：\(pending.label)"
            saveButton.isHidden = true
            cancelButton.setTitle("完成", for: .normal)
        } catch {
            saveButton.isEnabled = true
            status.textColor = .systemRed
            status.text = error.localizedDescription
        }
    }

    @objc private func close() { extensionContext?.completeRequest(returningItems: nil, completionHandler: nil) }
}
