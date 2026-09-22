import Foundation

/// Shared by the app and the build script. No network request or credentials are
/// needed to select a workspace; opening it always remains an explicit action.
enum WorkspaceConfiguration {
    static let savedKey = "ChatGraphWorkspace"
    static let defaultDisabledKey = "ChatGraphDefaultWorkspaceDisabled"

    struct InvalidWorkspace: LocalizedError {
        var errorDescription: String? {
            "填写手机可访问的 HTTPS 工作区根地址；不要包含路径、密码或查询参数，端口须在 1–65535 之间。"
        }
    }

    static func validated(_ raw: String) throws -> URL {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: #"\Ahttps://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?/?\z"#,
                          options: [.regularExpression, .caseInsensitive]) != nil,
              var components = URLComponents(string: value),
              let host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.port == nil || (1...65535).contains(components.port!) else {
            throw InvalidWorkspace()
        }
        if host.hasPrefix("[") {
            let address = String(host.dropFirst().dropLast())
            guard validIPv6(address), address != "::", address != "::1",
                  address != "0:0:0:0:0:0:0:1", address != "0:0:0:0:0:0:0:0" else {
                throw InvalidWorkspace()
            }
        } else {
            guard host.count <= 253, host != "localhost", !host.hasSuffix(".localhost"),
                  !host.hasSuffix("."), host.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({ label in
                      !label.isEmpty && label.count <= 63 && label.first != "-" && label.last != "-"
                  }) else { throw InvalidWorkspace() }
            if host.allSatisfy({ $0.isNumber || $0 == "." }) {
                let bytes = host.split(separator: ".", omittingEmptySubsequences: false)
                guard validIPv4(host), bytes.first != "127", bytes.first != "0" else { throw InvalidWorkspace() }
            }
        }
        components.scheme = "https"
        components.host = host
        components.path = ""
        if components.port == 443 { components.port = nil }
        guard let url = components.url else { throw InvalidWorkspace() }
        return url
    }

    private static func validIPv4(_ address: String) -> Bool {
        let parts = address.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 4 && parts.allSatisfy {
            !$0.isEmpty && ($0.count == 1 || $0.first != "0") && $0.allSatisfy(\.isNumber)
                && Int($0).map { (0...255).contains($0) } == true
        }
    }

    private static func validIPv6(_ address: String) -> Bool {
        let halves = address.components(separatedBy: "::")
        guard halves.count <= 2 else { return false }
        var units = 0
        let groups = address.split(separator: ":", omittingEmptySubsequences: true)
        for (index, group) in groups.enumerated() {
            if group.contains(".") {
                guard index == groups.count - 1, validIPv4(String(group)) else { return false }
                units += 2
            } else {
                guard (1...4).contains(group.count), group.allSatisfy(\.isHexDigit) else { return false }
                units += 1
            }
        }
        guard !address.contains(":::") else { return false }
        return halves.count == 2 ? units < 8 : units == 8 && !address.hasPrefix(":") && !address.hasSuffix(":")
    }

    static func effective(defaultURL: String?, preferences: UserDefaults) -> String {
        // A present manual preference never silently falls back to another server.
        if let saved = preferences.string(forKey: savedKey) {
            return (try? validated(saved).absoluteString) ?? ""
        }
        guard !preferences.bool(forKey: defaultDisabledKey), let defaultURL else { return "" }
        guard let normalized = try? validated(defaultURL).absoluteString else { return "" }
        // Pin the first valid default. An app update must not silently switch the
        // server holding this user's original conversations and login session.
        preferences.set(normalized, forKey: savedKey)
        return normalized
    }

    @discardableResult
    static func save(_ raw: String, preferences: UserDefaults) throws -> String {
        let normalized = try validated(raw).absoluteString
        preferences.set(normalized, forKey: savedKey)
        preferences.set(false, forKey: defaultDisabledKey)
        return normalized
    }

    static func forget(preferences: UserDefaults) {
        preferences.set(true, forKey: defaultDisabledKey)
        preferences.removeObject(forKey: savedKey)
    }

    /// The authority alone is safe to pass as an xcconfig build setting. A literal
    /// https:// in xcconfig would otherwise be truncated at its comment marker.
    static func buildAuthority(_ raw: String) throws -> String {
        let url = try validated(raw)
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = components.host else { throw InvalidWorkspace() }
        return host + (components.port.map { ":\($0)" } ?? "")
    }
}
