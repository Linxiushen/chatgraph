import SwiftUI
import UniformTypeIdentifiers

@main
struct ChatGraphApp: App {
    @StateObject private var model = WorkspaceModel()
    var body: some Scene { WindowGroup { HomeView(model: model) } }
}

struct HomeView: View {
    @ObservedObject var model: WorkspaceModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var settings = false
    @State private var inbox = false
    @State private var filePicker = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !model.showingWorkspace {
                    VStack(spacing: 20) {
                        Image(systemName: "point.3.connected.trianglepath.dotted").font(.system(size: 68)).foregroundStyle(.indigo)
                        Text("让对话成为知识").font(.largeTitle.bold())
                        Text(model.workspace.isEmpty
                            ? "从其他 App 分享文字、链接或对话文件到这里。连接工作区后，把对话整理成知识图谱。"
                            : "工作区已就绪。打开后登录，再选择要整理的对话。")
                            .multilineTextAlignment(.center).foregroundStyle(.secondary)
                        if model.workspace.isEmpty {
                            Button("连接工作区") { settings = true }.buttonStyle(.borderedProminent).disabled(model.busy)
                        } else {
                            Text(model.workspace).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)
                            Button("打开工作区") { model.openWorkspace() }.buttonStyle(.borderedProminent).disabled(model.busy)
                            Button("更换工作区") { settings = true }.disabled(model.busy)
                        }
                        if model.resettingWorkspace { ProgressView("正在退出登录…") }
                        Text("分享入口只能接收你主动分享的内容。只有链接时，仍需补充对话原文。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }.padding(28)
                    Spacer()
                } else {
                    if model.loading { ProgressView().frame(maxWidth: .infinity).padding(6) }
                    WorkspaceWebView(model: model).id(ObjectIdentifier(model.webView))
                }
                if !model.status.isEmpty {
                    Text(model.status).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10).background(Color(uiColor: .secondarySystemBackground))
                }
            }
            .navigationTitle("ChatGraph")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { model.refreshPending(); inbox = true } label: {
                        Label("收件箱 \(model.pending.count)", systemImage: "tray.and.arrow.down")
                    }.accessibilityLabel("本机收件箱，\(model.pending.count) 条")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button { model.showHome() } label: { Label("返回首页", systemImage: "house") }
                            .disabled(model.busy || !model.showingWorkspace)
                        Button { model.openWorkspace() } label: { Label("打开工作区", systemImage: "arrow.up.right.square") }
                            .disabled(model.busy || model.workspace.isEmpty)
                        Button { model.openInSafari() } label: { Label("在 Safari 打开（用于导出）", systemImage: "safari") }
                            .disabled(model.busy || model.workspace.isEmpty)
                        Button { model.openInbox() } label: { Label("工作区收件箱", systemImage: "tray") }
                            .disabled(model.busy || model.workspace.isEmpty)
                        Button { filePicker = true } label: { Label("导入对话文件", systemImage: "doc.badge.plus") }
                        Button { model.reloadWorkspace() } label: { Label("刷新页面", systemImage: "arrow.clockwise") }
                            .disabled(model.busy || !model.showingWorkspace)
                        Button { settings = true } label: { Label("更换工作区", systemImage: "gearshape") }
                            .disabled(model.busy)
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .sheet(isPresented: $settings) { SettingsView(model: model) }
            .sheet(isPresented: $inbox) { NativeInboxView(model: model) }
            .fileImporter(isPresented: $filePicker, allowedContentTypes: [.plainText, .json, .data], allowsMultipleSelection: false) { result in
                switch result {
                case .success(let urls): if let url = urls.first { model.receiveFile(url); inbox = true }
                case .failure(let error): model.status = error.localizedDescription
                }
            }
            .onChange(of: scenePhase) { phase in if phase == .active { model.refreshPending() } }
            .onOpenURL { url in if url.isFileURL { model.receiveFile(url); inbox = true } }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: WorkspaceModel
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var error = ""
    @State private var clearConfirmation = false
    @State private var forgetConfirmation = false
    var body: some View {
        NavigationStack {
            Form {
                Section("HTTPS 工作区") {
                    TextField("https://graph.example.com", text: $address).keyboardType(.URL)
                        .textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Text("填写手机可访问的 ChatGraph 根地址（0.4.1 或以上）。安装包可预设工作区；你手动保存的地址优先。手机不能连接电脑的 127.0.0.1。登录密码只在工作区页面填写。")
                        .font(.footnote)
                }
                Section("收件与隐私") {
                    Text("在其他 App 的分享菜单中选择 ChatGraph。确认后先保存在本机；打开 ChatGraph，再选择导入工作区。")
                    Text("本机收件箱最多 5 条、合计 50 MB。待整理内容在 24 小时后、下次读取时清理；原文不会备份至 iCloud。")
                    Text("只有你点击整理后，工作区才会将所选对话发送给配置的 AI 服务。App 不会读取其他 App 的历史记录。")
                }.font(.footnote)
                if !error.isEmpty { Text(error).foregroundStyle(.red) }
                Button("保存并连接") {
                    do { try model.configure(address); dismiss() }
                    catch { self.error = error.localizedDescription }
                }.disabled(model.busy)
                if !model.workspace.isEmpty {
                    Button("忘记工作区并退出登录", role: .destructive) { forgetConfirmation = true }.disabled(model.busy)
                }
                Button("清空本机待导入内容", role: .destructive) { clearConfirmation = true }.disabled(model.busy)
            }.navigationTitle("更换工作区")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
                .onAppear { address = model.workspace }
                .confirmationDialog("清空本机收件箱？", isPresented: $clearConfirmation, titleVisibility: .visible) {
                    Button("删除全部本机待导入内容", role: .destructive) { model.clearPending() }
                    Button("取消", role: .cancel) {}
                } message: { Text("这会删除尚未导入的原件，包括暂时无法读取的记录。已保存在工作区的图谱不受影响。") }
                .confirmationDialog("忘记工作区并退出登录？", isPresented: $forgetConfirmation, titleVisibility: .visible) {
                    Button("忘记地址并退出登录", role: .destructive) {
                        Task { await model.forgetWorkspace(); dismiss() }
                    }
                    Button("取消", role: .cancel) {}
                } message: {
                    Text("清除工作区地址、App 内网站登录、缓存和浏览历史。本机收件箱与网站已保存内容保留，服务器上的图谱不受影响。下次启动不会恢复预设地址；可手动重新连接。Safari 登录不受影响。")
                }
                .interactiveDismissDisabled(model.busy)
        }
    }
}

struct NativeInboxView: View {
    @ObservedObject var model: WorkspaceModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("先登录工作区，再导入。内容会进入工作区预览；不会自动调用 AI。链接无法代替对话原文。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if !model.workspace.isEmpty && !model.showingWorkspace {
                        Button("先打开工作区登录") { model.openWorkspace(); dismiss() }.disabled(model.busy)
                    }
                }
                if model.pending.isEmpty { Text("暂无待整理内容。请从其他 App 分享文字或文件到 ChatGraph。") }
                ForEach(model.pending) { item in
                    Section(item.label) {
                        Text(item.preview).font(.footnote).lineLimit(10).textSelection(.enabled)
                        Text("\(item.bytes / 1024) KB · 本机暂存 24 小时").font(.caption).foregroundStyle(.secondary)
                        Button("导入当前工作区") { Task { if await model.transfer(item) { dismiss() } } }
                            .disabled(model.busy || model.workspace.isEmpty || !model.showingWorkspace || model.loading)
                        Button("删除本机副本", role: .destructive) { model.remove(item) }.disabled(model.busy)
                    }
                }
                if !model.status.isEmpty { Text(model.status).font(.footnote) }
            }.navigationTitle("本机收件箱")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() }.disabled(model.busy) } }
                .interactiveDismissDisabled(model.busy)
        }
    }
}
