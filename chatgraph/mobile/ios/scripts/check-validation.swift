import Foundation

@main
struct ValidationChecks {
    static func main() throws {
        var checks = 0
        func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
            guard condition() else { throw ShareFailure("Check failed: \(message)") }
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
        print("Passed \(checks) iOS native input validation checks.")
    }
}
