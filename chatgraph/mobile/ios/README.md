# ChatGraph iOS 原生客户端

版本 0.4.3（build 7），最低 iOS / iPadOS 16。此目录是可供 Xcode 编译和签名的完整原生工程，包含 SwiftUI 主 App、WKWebView 工作区和系统分享扩展；没有第三方 Swift 依赖，也没有内置 API Key、工作区账号或密码。

**源代码 ZIP 不是可直接安装的 iPhone 安装包。** 如压缩包附带 `ChatGraph-unsigned.ipa`，它是实际编译的未签名 App，仍须用你的 Apple 开发者身份签名后才能真机安装。TestFlight / App Store 分发必须使用 Apple Developer 团队并完成平台流程；本工程不代表已经通过审核。

## 已有功能

- 安装包可预设工作区，首页直接点击“打开工作区”，无需先填写地址；通用构建默认留空，从“连接工作区”手动配置。启动 App 本身不会访问工作区。请部署 0.4.1 或更新版服务器，其中包含 `/mobile.js`、手机收件箱和 App 重启后的任务恢复。
- 使用系统 WKWebView 登录、查看和整理知识图谱，Cookie 保留在 App 的网站存储中。
- 在其他 App 的系统分享菜单选择 ChatGraph，接收文字、HTTP(S) 链接或一个 UTF-8 TXT / Markdown / JSON 文件。
- 分享扩展先展示内容预览；你点击“保存到本机收件箱”才保存。扩展不会强制打开主 App，也不会自动调用 AI。
- 主 App 回到前台刷新本机收件箱。点击“导入当前工作区”，在同一 HTTPS 来源内调用 `saveMobileShare()`，等待 IndexedDB 完成及回读回执后才删除本机副本。随后进入工作区收件箱检查原文。
- 可从主 App 菜单选择文件导入。网络失败、登录过期或工作区收件箱已满时，原文保留在本机。

本机暂存最多 5 条、合计 50 MB；单段文字最多 2 MB，单文件最多 25 MB。文件不写入 iCloud 备份，并使用 iOS 文件保护；超过 24 小时会在下次读取收件箱时清理。工作区的浏览器收件箱也有独立的容量和过期规则。

## 连接你的工作区

填写类似 `https://graph.example.com` 的根地址。`127.0.0.1` / `localhost` 在手机上指向手机自身，不能连接电脑上同名地址；本 App 不附带云服务器，不把模型 Key 打包到手机。

使用同一仓库的 `chatgraph/deploy` 部署方式提供可访问的 HTTPS 工作区。先在手机 Safari 验证地址能打开和登录，然后填入 App。支持正常有效证书；没有关闭 TLS 校验或开放任意 HTTP 访问。

工作区地址保存在本 App 的偏好设置，密码仅在网页中输入。本机队列在你点击导入之前不会发送到服务器。导入只是打开网页预览，调用 AI 仍需在工作区确认。

“更换工作区”可随时保存其他地址，手动地址优先于安装包预设地址；首次采用的有效预设也会保存，后续安装包更改预设不会静默切换服务器。无效地址不会覆盖原配置。端口必须在 1–65535 之间，只接受 HTTPS 根地址，不接受用户信息、路径、查询参数或片段。可填写标准域名（国际化域名使用 Punycode）、IPv4 或方括号 IPv6 地址。返回首页再点击“打开工作区”会继续当前网页，保留编辑状态；“刷新页面”和“工作区收件箱”是显式导航操作。

在设置中确认“忘记工作区并退出登录”会删除地址、退出 App 内的 Cookie 登录并清除缓存及浏览历史。本机队列与网站 IndexedDB / localStorage 中的原文、服务器图谱保留；Safari 登录不受影响。此选择持久保存，重启或更新 App 也不会重新采用预设地址；之后可手动重新连接。正在导入或退出时，禁止切换、遗忘、刷新及重复导入，避免异步保存和退出相互冲突。更换工作区不会删除旧网站数据；忘记工作区不是抹除所有本机数据的功能。

原生收件箱只清理已确认超过保留期的完整记录。临时读盘失败、保护状态或 JSON 损坏会显示错误并保留原件；调整手机时钟也不会立即删除未来时间戳的内容。确认保存时重新计算新记录的保留起点。若确实需要丢弃无法读取的记录，可在工作区设置中选择“清空本机待导入内容”并确认删除。

## 在 Xcode 里安装到自己的 iPhone

1. 使用装有完整 Xcode 15 或更高版本的 Mac，打开 `ChatGraph.xcodeproj`，选择共享 Scheme `ChatGraph`。
2. 在 `Configuration.xcconfig` 把 `APP_BUNDLE_IDENTIFIER` 改为你拥有的唯一标识，例如 `com.yourcompany.chatgraph`，填入 `DEVELOPMENT_TEAM`。默认 App Group 会随之变为 `group.com.yourcompany.chatgraph`，扩展 Bundle ID 为 `com.yourcompany.chatgraph.share`。
3. 在 Apple Developer 的 Identifiers 中注册主 App、分享扩展和同名 App Group；把两个 App ID 都加入这个 App Group。Xcode 的两个 Target 中均启用 App Groups 并选择同一个分组，使用同一 Team 和有效描述文件。首次注册可能由 Xcode 自动完成，取决于你的团队权限；免费 Personal Team 对能力和分发有限制，不能承诺本扩展可用。
4. 插入 iPhone 并信任 Mac。按 Xcode 提示开启设备的 Developer Mode，选择你的设备，运行 `ChatGraph`。
5. 首次打开点击“打开工作区”（未预设地址时先连接）。在任意 App 分享文字或文件，若列表未显示 ChatGraph，打开分享菜单的“更多”并启用 ChatGraph。

主 App 与分享扩展均使用 `Shared/AppGroups.entitlements` 中的 `$(APP_GROUP_IDENTIFIER)`；Info.plist 中的 `ChatGraphAppGroup` 使用相同值。如果运行时显示“App Group 未配置”，检查**两个 Target**的签名、App Group 权限和描述文件，而不是修改或删除存储保护。

## 命令行编译与签名

```bash
cd chatgraph/mobile/ios
# 编译实际 iPhone App，打成未签名 IPA：不能直接安装。
bash scripts/build.sh unsigned

# 编译 iOS Simulator App，可在 Xcode 的模拟器中运行。
bash scripts/build.sh simulator

# 为已有 HTTPS 部署制作可直接进入的安装包（示例域名须替换）。
# 只写服务器地址，绝不能放账号、密码或模型 Key。
CHATGRAPH_DEFAULT_WORKSPACE_URL=https://your-workspace.example.com \
  bash scripts/build.sh unsigned

# 配好 Xcode 登录及 Apple 标识后，签名并归档。
IOS_TEAM_ID=YOURTEAMID IOS_BUNDLE_ID=com.yourcompany.chatgraph \
  bash scripts/build.sh archive

# 复制导出模板，填入真实 Team ID（不要提交证书或密码）。
cp ExportOptions.template.plist ExportOptions.local.plist
# 编辑 ExportOptions.local.plist 后：
bash scripts/build.sh export
```

`CHATGRAPH_DEFAULT_WORKSPACE_URL` 仅影响当前构建，不修改源码。脚本与运行时复用 `Shared/WorkspaceConfiguration.swift`，验证并规范化 HTTPS 根地址；无效输入会中止构建且不回显输入中的凭据。显式设为空字符串会覆盖并清空 xcconfig 预设，未设置该环境变量时沿用 xcconfig。

直接使用 Xcode 或 `xcodebuild` 时，在 `Configuration.xcconfig` 配置 `CHATGRAPH_DEFAULT_WORKSPACE_AUTHORITY` 为真实的 `host` 或 `host:port`，或给 `xcodebuild` 传入同名赋值。不要写 `https://`：xcconfig 会把 `//` 当作注释。`Info.plist` 用 `https://$(CHATGRAPH_DEFAULT_WORKSPACE_AUTHORITY)` 安全拼接，运行时再次验证；默认空值不会连接虚构服务。源仓库和通用 CI 构建保留空预设。`export` 仅导出现有归档；要更换地址必须先重新 `archive`。

默认导出方法为 `app-store-connect`，适用于新版本 Xcode 的 App Store Connect 流程。若使用 Xcode 15，依其 `xcodebuild -help` 支持的方法将其改为 `app-store`。Ad Hoc / Development 导出须使用团队对应的证书、注册设备及描述文件，不能仅改文件后缀。

上传 TestFlight：用 Xcode 的 **Product → Archive → Distribute App → App Store Connect**，选择你的 App 记录并上传。构建处理完成后，在 App Store Connect 设置内部测试或提交外部测试审核。App Store 上架还需填写隐私说明、截图、支持信息并通过审核；这些账号步骤未自动完成。

## 验证与工程维护

工程、共享 Scheme、Info.plist、隐私清单和图标均随源代码提供，无需安装 XcodeGen。`python3 scripts/generate-project.py` 可确定性重新生成它们；此命令会重写生成文件，Swift 源文件和 `Configuration.xcconfig` 不受影响。

```bash
bash scripts/check-source.sh
plutil -lint ChatGraph.xcodeproj/project.pbxproj ChatGraph/Info.plist ChatGraphShare/Info.plist Shared/AppGroups.entitlements
xcodebuild -project ChatGraph.xcodeproj -scheme ChatGraph -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

`check-source.sh` 包括 Foundation 输入/队列/工作区偏好回归及构建地址规范化检查，覆盖端口越界、凭据/路径拒绝、手动地址优先、遗忘后的持久退出预设、原文保留和日志不回显凭据。交付验证应区分 Swift 语法 / plist 检查、Xcode 完整编译和真机操作；通过编译不等于真机分享流程已验证。请以发布说明记录的实际结果为准。真机至少检查：预设与空预设首次启动、手动地址覆盖、忘记后重启不自动恢复、Cookie 登录已退出且原文保留；主动分享文字、仅链接、UTF-8 文件、超限文件拒绝；取消分享；飞行模式暂存；登录后导入；队列满时保留原文；重复导入不新增相同副本；重新启动后继续。

## 已知范围

- iOS 不允许本 App 在后台读取 ChatGPT、DeepSeek 等其他 App 的全部聊天记录。需要来源 App 主动提供分享，或用户复制 / 导出文件。
- 来源 App 常常只分享 URL；这不意味着已拿到原文。工作区会提示补充原文，不会冒充抓取私有聊天。
- 原生 App 不含 Safari 网页采集扩展；项目另有 `mobile/safari-shortcut.js` 供用户在 Safari 对当前已加载页面运行快捷指令。
- Web 工作区的浏览器下载与原生文件分享不是同一套功能；此版没有为 WKWebView 的所有 blob 下载实现原生导出适配，可从 App 菜单“在 Safari 打开（用于导出）”进入同一工作区操作，Safari 可能要求重新登录。
- 未提供通用可直接安装的签名 IPA；签名凭据、Apple 开发者团队、工作区域名需要由部署者提供。
