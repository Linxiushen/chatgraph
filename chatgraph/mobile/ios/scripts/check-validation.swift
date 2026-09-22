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
        try require(try WorkspaceConfiguration.validated(" HTTPS://GRAPH.EXAMPLE.COM:443/ \n").absoluteString == "https://graph.example.com", "workspace canonical HTTPS origin")
        try require(try WorkspaceConfiguration.buildAuthority("https://graph.example.com:8443/") == "graph.example.com:8443", "safe build authority retains non-default port")
        try require(try WorkspaceConfiguration.validated("https://[2001:db8::1]:8443").absoluteString == "https://[2001:db8::1]:8443", "valid IPv6 workspace")
        for invalid in ["", "https://", "http://graph.example.com", "https://user:secret@graph.example.com",
                        "https://graph.example.com/path", "https://graph.example.com//", "https://graph.example.com?x=1",
                        "https://graph.example.com#secret", "https://graph.example.com:0", "https://graph.example.com:65536",
                        "https://graph.example.com:99999999999999999999", "https://graph.example.com:",
                        "https://graph.example.com:abc", "https://graph.example.com\\@evil.test", "https://gr aph.example.com",
                        "https://graph.example.com\n.evil.test", "https://localhost", "https://127.0.0.1", "https://[::1]",
                        "https://[abc]", "https://[1:2:3:4:5:6:7:8:9]", "https://graph..example.com",
                        "https://graph%2eexample.com", "https://$(CHATGRAPH_DEFAULT_WORKSPACE_AUTHORITY)"] {
            try rejects { _ = try WorkspaceConfiguration.validated(invalid) }
        }
        let preferenceDomain = "ChatGraphValidation.\(UUID().uuidString)"
        let preferences = UserDefaults(suiteName: preferenceDomain)!
        defer { preferences.removePersistentDomain(forName: preferenceDomain) }
        let buildDefault = "https://default.example.com"
        try require(WorkspaceConfiguration.effective(defaultURL: nil, preferences: preferences).isEmpty, "generic app has no invented workspace")
        try require(WorkspaceConfiguration.effective(defaultURL: buildDefault, preferences: preferences) == buildDefault, "fresh install resolves configured default")
        try require(WorkspaceConfiguration.effective(defaultURL: "https://updated-default.example.com", preferences: UserDefaults(suiteName: preferenceDomain)!) == buildDefault, "first default is pinned across restarts and app updates")
        try WorkspaceConfiguration.save("https://MANUAL.example.com:443/", preferences: preferences)
        try require(WorkspaceConfiguration.effective(defaultURL: buildDefault, preferences: preferences) == "https://manual.example.com", "manual preference takes precedence over build default")
        try rejects { _ = try WorkspaceConfiguration.save("http://wrong.example.com", preferences: preferences) }
        try require(WorkspaceConfiguration.effective(defaultURL: buildDefault, preferences: preferences) == "https://manual.example.com", "failed change preserves previous manual workspace")
        WorkspaceConfiguration.forget(preferences: preferences)
        try require(preferences.string(forKey: WorkspaceConfiguration.savedKey) == nil, "forget clears saved address")
        try require(WorkspaceConfiguration.effective(defaultURL: buildDefault, preferences: UserDefaults(suiteName: preferenceDomain)!).isEmpty, "explicit opt-out survives preferences reload")
        try require(WorkspaceConfiguration.effective(defaultURL: "https://new-default.example.com", preferences: preferences).isEmpty, "app update cannot resurrect forgotten default")
        try WorkspaceConfiguration.save("https://reconnected.example.com", preferences: preferences)
        try require(WorkspaceConfiguration.effective(defaultURL: buildDefault, preferences: preferences) == "https://reconnected.example.com", "manual reconnect works after opt-out")
        preferences.set("invalid saved workspace", forKey: WorkspaceConfiguration.savedKey)
        try require(WorkspaceConfiguration.effective(defaultURL: buildDefault, preferences: preferences).isEmpty, "invalid manual preference never silently selects another server")
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
        WorkspaceConfiguration.forget(preferences: preferences)
        try require(try ShareStore.list(in: queue).first?.text == original, "forgetting workspace leaves native original intact")
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
