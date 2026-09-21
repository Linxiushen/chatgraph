import Foundation
import SwiftUI
import WebKit

@MainActor
final class WorkspaceModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published var workspace: String = UserDefaults.standard.string(forKey: "ChatGraphWorkspace") ?? ""
    @Published var status = ""
    @Published var loading = false
    @Published var transferring = false
    @Published var pending: [PendingShare] = []
    let webView: WKWebView

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        refreshPending()
        if !workspace.isEmpty { openInbox() }
    }

    static func validatedWorkspace(_ raw: String) throws -> URL {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme?.lowercased() == "https", let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else {
            throw ShareFailure("填写 HTTPS 工作区根地址，例如 https://graph.example.com；不要包含路径、密码或查询参数。")
        }
        guard !["localhost", "127.0.0.1", "::1"].contains(host.lowercased()) else {
            throw ShareFailure("手机的 localhost 是手机自身。请填写手机能访问的 HTTPS 工作区。")
        }
        return url
    }

    func configure(_ raw: String) throws {
        let url = try Self.validatedWorkspace(raw)
        workspace = url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        UserDefaults.standard.set(workspace, forKey: "ChatGraphWorkspace")
        openInbox()
    }

    private func sameWorkspace(_ url: URL) -> Bool {
        guard let root = URL(string: workspace) else { return false }
        return url.scheme?.lowercased() == "https" && url.host?.lowercased() == root.host?.lowercased()
            && (url.port ?? 443) == (root.port ?? 443) && url.user == nil && url.password == nil
    }

    func openInbox() {
        guard let root = try? Self.validatedWorkspace(workspace) else { return }
        status = ""
        webView.load(URLRequest(url: root.appendingPathComponent("mobile-inbox.html")))
    }

    func refreshPending() {
        do { pending = try ShareStore.list() }
        catch { status = error.localizedDescription }
    }

    func receiveFile(_ url: URL) {
        do { try ShareStore.save(PendingShare.readFile(url)); refreshPending(); status = "已保存在本机收件箱，请选择后导入。" }
        catch { status = error.localizedDescription }
    }

    func remove(_ item: PendingShare) {
        do { try ShareStore.remove(item.id); refreshPending() }
        catch { status = error.localizedDescription }
    }

    /// callAsyncJavaScript supplies structured arguments and awaits the IndexedDB
    /// transaction. Native content is retained until a matching durable receipt arrives.
    func transfer(_ item: PendingShare) async -> Bool {
        guard !transferring else { return false }
        guard let page = webView.url, sameWorkspace(page), !loading,
              page.path != "/login" && page.path != "/login.html" else {
            status = "请先在工作区完成登录，再打开本机收件箱导入。"
            return false
        }
        transferring = true
        defer { transferring = false }
        let script = """
        if (location.origin !== expectedOrigin) throw new Error('工作区已切换，请重试');
        const api = await import('/mobile.js');
        const key = 'chatgraph:native-receipt:' + input.id;
        let record = null;
        try {
          const receipt = JSON.parse(localStorage.getItem(key) || 'null');
          if (receipt && typeof receipt.id === 'string') record = await api.readMobileShare(receipt.id);
        } catch (_) {}
        if (!record) {
          // A previous native acknowledgement may have been interrupted. Reuse an
          // identical durable entry before writing another copy.
          for (const entry of await api.listMobileShares()) {
            const candidate = await api.readMobileShare(entry.id);
            const normalized = api.normalizeMobileShare(input);
            if (candidate && ['title','text','url','fileName'].every(k => candidate[k] === normalized[k])) {
              record = candidate; break;
            }
          }
        }
        if (!record) record = await api.saveMobileShare(input);
        try { localStorage.setItem(key, JSON.stringify({ id: record.id })); } catch (_) {}
        const saved = await api.readMobileShare(record.id);
        if (!saved) throw new Error('工作区尚未持久保存，请重试');
        return { nativeId: input.id, id: saved.id };
        """
        do {
            let data = try JSONEncoder().encode(try item.validated())
            let input = try JSONSerialization.jsonObject(with: data)
            guard let root = URL(string: workspace), var origin = URLComponents(url: root, resolvingAgainstBaseURL: false) else {
                throw ShareFailure("工作区地址无效。")
            }
            origin.path = ""; origin.query = nil; origin.fragment = nil
            guard let expectedOrigin = origin.string else { throw ShareFailure("工作区地址无效。") }
            // Browser location.origin canonicalizes the default TLS port away.
            let canonicalOrigin = expectedOrigin.hasSuffix(":443") ? String(expectedOrigin.dropLast(4)) : expectedOrigin
            let result = try await webView.callAsyncJavaScript(script,
                arguments: ["input": input, "expectedOrigin": canonicalOrigin], in: nil, contentWorld: .page)
            guard let receipt = result as? [String: Any], receipt["nativeId"] as? String == item.id,
                  let id = receipt["id"] as? String, UUID(uuidString: id) != nil,
                  let current = webView.url, sameWorkspace(current) else {
                throw ShareFailure("未收到工作区保存回执；原文仍保留在本机。")
            }
            try ShareStore.remove(item.id)
            refreshPending()
            status = "已保存到工作区收件箱，请检查原文后整理。"
            var destination = URLComponents(url: root.appendingPathComponent("mobile-inbox.html"), resolvingAgainstBaseURL: false)!
            destination.queryItems = [URLQueryItem(name: "native", value: UUID().uuidString.lowercased())]
            destination.fragment = id
            if let url = destination.url { webView.load(URLRequest(url: url)) }
            return true
        } catch {
            status = "导入未完成，原文仍在本机。\(error.localizedDescription)"
            return false
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading = true }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report(error) }
    private func report(_ error: Error) {
        loading = false
        if (error as NSError).code != NSURLErrorCancelled { status = "暂时无法连接工作区；本机待整理内容仍保留。\(error.localizedDescription)" }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if sameWorkspace(url) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated && ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        } else if action.targetFrame?.isMainFrame != false {
            status = "已阻止跳转到工作区之外的页面。外部链接请使用 Safari 打开。"
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, sameWorkspace(url) { webView.load(action.request) }
        return nil
    }
}

struct WorkspaceWebView: UIViewRepresentable {
    @ObservedObject var model: WorkspaceModel
    func makeUIView(context: Context) -> WKWebView { model.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
