import Foundation

@main
struct NormalizeWorkspace {
    static func main() {
        do {
            guard let input = ProcessInfo.processInfo.environment["CHATGRAPH_DEFAULT_WORKSPACE_URL"] else {
                throw WorkspaceConfiguration.InvalidWorkspace()
            }
            if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { print(""); return }
            print(try WorkspaceConfiguration.buildAuthority(input))
        } catch {
            // Never repeat an invalid URL: it could contain accidentally supplied credentials.
            FileHandle.standardError.write(Data("默认工作区地址无效：\(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
}
