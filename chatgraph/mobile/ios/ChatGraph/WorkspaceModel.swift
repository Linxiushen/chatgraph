import Foundation
import SwiftUI
import WebKit

@MainActor
final class WorkspaceModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published private(set) var workspace = WorkspaceConfiguration.effective(
        defaultURL: Bundle.main.object(forInfoDictionaryKey: "ChatGraphDefaultWorkspaceURL") as? String,
        preferences: .standard)
    @Published private(set) var showingWorkspace = false
    @Published private(set) var resettingWorkspace = false
    @Published var status = ""
    @Published var loading = false
    @Published var transferring = false
    @Published var pending: [PendingShare] = []
    @Published private(set) var webView: WKWebView
    var busy: Bool { transferring || resettingWorkspace }
    private var hasLoadedWorkspacePage = false

    override init() {
        webView = Self.makeWebView()
        super.init()
        attachWebView()
        refreshPending()
    }

    private static func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        return WKWebView(frame: .zero, configuration: configuration)
    }

    private func attachWebView() {
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
    }

    static func validatedWorkspace(_ raw: String) throws -> URL {
        try WorkspaceConfiguration.validated(raw)
    }

    func configure(_ raw: String) throws {
        guard !busy else { throw ShareFailure("正在导入或退出工作区，请完成后重试。") }
        workspace = try WorkspaceConfiguration.save(raw, preferences: .standard)
        openWorkspace()
    }

    func forgetWorkspace() async {
        guard !busy else { return }
        resettingWorkspace = true
        showingWorkspace = false
        loading = false
        hasLoadedWorkspacePage = false
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        let websiteDataStore = webView.configuration.websiteDataStore
        webView.loadHTMLString("", baseURL: nil)
        // Detach the active page before clearing login data, so it cannot keep
        // navigating while the asynchronous website-store operation is running.
        webView = Self.makeWebView()
        WorkspaceConfiguration.forget(preferences: .standard)
        workspace = ""
        // Keep IndexedDB/localStorage: their inbox may hold the only remaining
        // original after a successful native transfer. Cookie removal logs out.
        let disposableTypes: Set<String> = [WKWebsiteDataTypeCookies, WKWebsiteDataTypeDiskCache,
                                            WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeOfflineWebApplicationCache]
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            websiteDataStore.removeData(ofTypes: disposableTypes, modifiedSince: .distantPast) {
                continuation.resume()
            }
        }
        // The fresh view also has no back/forward history or active page scripts.
        attachWebView()
        status = "已忘记地址并退出登录。本机收件箱与网站已保存内容保留；默认工作区不会自动恢复。"
        resettingWorkspace = false
    }

    private func sameWorkspace(_ url: URL) -> Bool {
        guard let root = URL(string: workspace) else { return false }
        return url.scheme?.lowercased() == "https" && url.host?.lowercased() == root.host?.lowercased()
            && (url.port ?? 443) == (root.port ?? 443) && url.user == nil && url.password == nil
    }

    func openInbox() {
        guard !busy, let root = try? Self.validatedWorkspace(workspace) else { return }
        status = ""
        showingWorkspace = true
        webView.load(URLRequest(url: root.appendingPathComponent("mobile-inbox.html")))
    }

    func openWorkspace() {
        guard !busy, let root = try? Self.validatedWorkspace(workspace) else { return }
        status = ""
        showingWorkspace = true
        if let page = webView.url, sameWorkspace(page), loading || hasLoadedWorkspacePage { return }
        webView.load(URLRequest(url: root))
    }

    func showHome() { if !busy { showingWorkspace = false } }

    func reloadWorkspace() { if !busy && showingWorkspace { webView.reload() } }

    func refreshPending() {
        do { pending = try ShareStore.list() }
        catch { status = error.localizedDescription }
    }

    func receiveFile(_ url: URL) {
        do { try ShareStore.save(PendingShare.readFile(url)); refreshPending(); status = "已保存在本机收件箱，请选择后导入。" }
        catch { status = error.localizedDescription }
    }

    func remove(_ item: PendingShare) {
        guard !busy else { return }
        do { try ShareStore.remove(item.id); refreshPending() }
        catch { status = error.localizedDescription }
    }

    func clearPending() {
        guard !busy else { return }
        do { try ShareStore.clear(); refreshPending(); status = "已按你的选择清空本机收件箱。" }
        catch { status = "未能完整清空收件箱，请重试。" }
    }

    func openInSafari() {
        guard !busy, let url = try? Self.validatedWorkspace(workspace) else { return }
        UIApplication.shared.open(url)
    }

    /// callAsyncJavaScript supplies structured arguments and awaits the IndexedDB
    /// transaction. Native content is retained until a matching durable receipt arrives.
    func transfer(_ item: PendingShare) async -> Bool {
        guard !busy else { return false }
        guard showingWorkspace, let page = webView.url, sameWorkspace(page), !loading,
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
        const normalized = api.normalizeMobileShare(input);
        const matches = candidate => candidate && ['title','text','url','fileName'].every(k => candidate[k] === normalized[k]);
        let record = null;
        try {
          const receipt = JSON.parse(localStorage.getItem(key) || 'null');
          if (receipt && typeof receipt.id === 'string') record = await api.readMobileShare(receipt.id);
          if (!matches(record)) record = null;
        } catch (_) {}
        if (!record) {
          // A previous native acknowledgement may have been interrupted. Reuse an
          // identical durable entry before writing another copy.
          for (const entry of await api.listMobileShares()) {
            const candidate = await api.readMobileShare(entry.id);
            if (matches(candidate)) {
              record = candidate; break;
            }
          }
        }
        if (!record) record = await api.saveMobileShare(input);
        try { localStorage.setItem(key, JSON.stringify({ id: record.id })); } catch (_) {}
        const saved = await api.readMobileShare(record.id);
        if (!matches(saved)) throw new Error('工作区尚未持久保存原文，请重试');
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

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading = true; hasLoadedWorkspacePage = false }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false; hasLoadedWorkspacePage = true }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report(error) }
    private func report(_ error: Error) {
        loading = false
        if (error as NSError).code != NSURLErrorCancelled { status = "暂时无法连接工作区；本机待整理内容仍保留。\(error.localizedDescription)" }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        guard !resettingWorkspace else { decisionHandler(.cancel); return }
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
