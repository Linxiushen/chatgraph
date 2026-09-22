# ChatGraph 手机端接入

ChatGraph 的手机入口是可添加到主屏幕的 Web App（PWA），配合系统分享、粘贴、文件导入和 Safari 快捷指令。打开 ChatGraph 不会自动获得其他 AI App 的聊天记录。手机系统允许接收用户主动交出的内容；浏览器采集需要用户在相应网页中运行。

0.4.3 提供 Android 原生 App 和 iOS 主 App / 分享扩展。Android 提供测试签名 APK，iOS 提供未签名 IPA 与 Xcode 工程；iOS 安装需要配置自己的 Apple 签名和 App Group。已预置工作区的安装包，首页直接点“打开工作区”；未预置的开源构建仍可手动连接已部署的 HTTPS 工作区。详见 [Android](../mobile/android/README.md) 与 [iOS](../mobile/ios/README.md)；以下 PWA 接入方式仍然保留。

## 本轮交付与平台边界

| 入口 | 能获得什么 | 平台与条件 |
| --- | --- | --- |
| 手机工作区 / 主屏幕 Web App | 已导入的对话、图谱、大纲与编辑功能 | iPhone、Android；手机可访问的 HTTPS 工作区 |
| 手机收件箱：粘贴 / TXT、Markdown、JSON 文件 | 用户选择的文本或文件；账号导出仍需选择会话和消息范围 | iPhone、Android；打开 `/mobile-inbox.html` |
| 系统分享至 ChatGraph | 分享方实际提供的标题、文本、链接或支持的文件 | 支持 Web Share Target 的 Android 浏览器；先安装 PWA，系统面板是否出现以设备为准 |
| Safari 快捷指令采集 | 当前 Safari 页面已渲染的对话；角色无法识别时标为未知 | iPhone / iPad；启用脚本、配置快捷指令后从 Safari 分享菜单运行 |
| Safari Web Extension | 获准访问的 Safari 网页内容 | 原理可行；需打包、兼容性验证、用户安装授权及真机测试，本仓库不附已签名 iOS 安装包 |
| Android 原生分享接收器 | 其他 App 通过 `ACTION_SEND` / `ACTION_SEND_MULTIPLE` 主动分享的文字或单个文件 | 0.4.3 提供测试签名 APK；可预置工作区，也可手动连接，仍需真机验证 |
| iOS 原生分享扩展 | 宿主主动提供的文本、链接或单个文件，先保存到 App Group | 0.4.3 提供未签名 IPA / Xcode 工程；可预置工作区，需开发者签名和 App Group 能力后真机安装 |

桌面 Chrome 扩展不能当成 Android Chrome 扩展安装。Google 的“在手机上安装扩展”帮助实际指 **Add to Desktop**，最后在电脑 Chrome 使用。其他 Android 浏览器的扩展支持各不相同，本轮不据此声称已经适配。

iPhone 的“添加到主屏幕”不等于注册了系统分享接收器。核对当日的 MDN 兼容性数据中，Safari / iOS Safari 不支持 `share_target`，Android Chrome 从 76 起支持。iPhone 的 PWA 当前应使用收件箱粘贴/文件，或 Safari 快捷指令。

## 原生 App 首次连接

有预设入口时，首页点“打开工作区”，再按页面要求登录。没有预设时，点“连接工作区”，填写部署者提供的真实 HTTPS 根地址；不要填写示例域名、路径、密码或模型 Key。安装包和任何 ZIP 不会自动提供或部署一个可用服务器，预设地址所指向的服务也需要部署者运行维护。

已有工作区地址优先于安装包预设值；第一次采用默认值后会将其保存，升级不会静默换服务器。“更换工作区”可以改地址；“忘记工作区并退出登录”会记住该选择，下次不会自动恢复预设地址。忘记仅清理 App 内网站登录、缓存和历史，保留原生收件箱及网站 IndexedDB / localStorage 已保存的原文。打开 App 不会自动上传分享内容或调用 AI。

已经安装 0.4.2 的 Android 用户，可直接在现有 App 中保存可用工作区地址，无需为了连接服务器重装。不同 debug 签名可能阻止覆盖安装；不要因此直接卸载导致本机原文丢失。

## iPhone 使用

1. 使用 Safari 打开自己的 HTTPS ChatGraph 工作区，登录后进入“手机入口”。
2. Safari 分享菜单 → 添加到主屏幕；系统提供“作为 Web App 打开”选项时启用。系统版本不同，菜单名称可能略有差异。
3. 从 AI App 复制要整理的对话文字，打开 ChatGraph 手机收件箱粘贴；也可选取 `.txt`、`.md`、`.json` 文件。
4. 在收件箱检查内容，再继续到工作区，选择会话、范围和角色后整理。生成知识图谱使用服务端模型配置。

若在 Safari 网页版 ChatGPT / DeepSeek 聊天，可使用仓库随附的 Safari 快捷指令脚本。具体步骤见 [手机采集说明](../mobile/README.md)：把脚本放入“在网页上运行 JavaScript”，输入设置为“Safari 网页”，输出复制到剪贴板，然后打开 ChatGraph 收件箱粘贴。快捷指令不能在原生 ChatGPT / DeepSeek App 内直接读取完整会话，也不会自动翻页或遍历账号历史。

## Android 使用

1. 用支持安装 PWA 的浏览器打开自己的 HTTPS ChatGraph 工作区，进入手机入口，选择安装/添加到主屏幕。
2. 在 AI App 中选择文字或导出文件 → 分享 → ChatGraph。如果系统面板没有 ChatGraph，先确认它已被安装为 Web App；也可以直接使用粘贴/选文件入口。
3. 检查收件箱实际收到的内容。很多 AI App 的“分享对话”只提供一个链接；这种情况下需补充对话正文，不能仅凭链接生成声称基于完整聊天的图谱。
4. 继续到工作区，在预览中确认需要整理的消息，再开始整理。

Android 分享可能把 URL 放在 `text`，而不是 `url` 字段；ChatGraph 对纯链接显示补充正文提示。分享方没有发送的内容，接收器无法凭权限补齐。

## 手机访问服务的要求

电脑上的 `http://127.0.0.1:4317` 只代表电脑自己；手机打开同一地址会访问手机自己。要在手机使用完整功能，需把 ChatGraph 服务部署到手机可访问的 HTTPS 地址，配置 `CHATGRAPH_PUBLIC_ORIGIN` 和工作区密码。部署参考仓库 [部署说明](../deploy/README.md)。

普通 HTTP 局域网 IP 不是完整 PWA 安装和 Service Worker 的可靠交付方式。开发浏览器把 `localhost` 视为安全上下文是测试特例，不能当作手机访问方案。没有实际域名/服务器时，本地代码与浏览器测试就绪也不代表手机已经连通。

DeepSeek API Key 仍保存在服务端私有配置中。手机和分享脚本不需要把 Key 写进 URL、快捷指令或网页设置。

## 接收、存储与生成

- 分享接收使用表单 POST。正常安装且 Service Worker 生效时，分享内容先进入设备上的收件箱；地址栏仅携带本地收件项 ID，不携带正文。
- 收件箱提供检查、修改、删除和继续导入。服务端登录过期时，先登录再继续，收件内容不应因为登录跳转而丢失。
- 离线能力限于已缓存的手机入口和本地收件。生成 AI 图谱、加载服务端知识库和保存到服务端都需要网络。
- Service Worker 不缓存工作区根页面、知识库 API、分享快照或模型响应。收件箱并非加密保险箱；它属于当前设备和浏览器的数据，浏览器清理站点数据后会丢失。
- 账号导出文件需要在工作区明确选择会话和消息范围。只有确认的内容进入后续整理流程，不能把整份账号导出当成一段对话自动发送。
- 原生收件箱与网页收件箱有不同生命周期。Android 原件保留至网页确认保存或用户删除；iOS App Group 原件保留 24 小时。读取错误不会被当成删除授权，用户可在原生界面明确清空损坏记录。Android 0.4.2 会恢复中断写入的元数据并对仍在队列中的 Intent 重放去重；iOS 不再因手机时钟回拨而立即删除记录。

## 为什么不做“启动后自动读取所有 AI App”

iOS 沙箱不允许普通 App 任意读取其他 App 的文件和聊天数据库。Safari 扩展和“在网页上运行 JavaScript”作用于网页，不能扩大为对其他原生 App 的读取权限。

Android 的分享 Intent 也只是接收主动分享的数据。无障碍读取和屏幕录制/OCR是另一类能力，受到授权、前台界面、平台政策、隐藏内容和识别误差等限制，不能可靠地等同于完整会话同步；本轮不依赖这些方式。

0.4.1 实现的 iOS Share Extension、Android 分享接收器让“分享给 ChatGraph”更直接，仍然需要上游 App 实际提供正文；Safari Web Extension 分发及各原生入口真机验证仍待完成。

## 验证范围与原生构建现状

移动浏览器自动化覆盖手机尺寸的收件、预览和整理流程；这类测试不等价于在真实 iPhone / Android 上从系统分享面板启动应用。真实 AI 网页 DOM 变化、系统安装提示、系统分享文件类型和 Safari 快捷指令弹窗仍需要设备验证。

0.4.2 的原生验证增加 JVM 临时目录队列回归和 Swift/Foundation 文件系统检查，覆盖中断写入恢复、旧版本备份、并发容量、重复分享、损坏记录保留及时间边界。Android debug 构建使用测试签名，CI 不同构建的签名可能不同，不能保证覆盖升级；必须先完成整理或导出，再考虑卸载。正式 Android 发行签名、Apple 团队签名及真实设备验收仍需要维护者环境。

0.4.3 增加默认入口、手动选择优先、遗忘后不自动恢复、HTTPS 根地址校验及构建参数校验。Android / iOS 构建脚本都接受 `CHATGRAPH_DEFAULT_WORKSPACE_URL`；普通 push / pull request 的 CI 构建保持空地址。手动运行 `ChatGraph Native Apps` 工作流时，可选填 `default_workspace_url`，经环境变量传给构建脚本；必须先验证地址可访问、能登录，且 `GET /api/health` 返回 `ok: true`。不在源码或通用发布包中写入个人临时隧道 URL，不把登录密码或 API Key 传入该参数。iOS CI 使用 `scripts/build.sh unsigned` 输出 `build/ChatGraph-unsigned.ipa`，仍为未签名产物。

0.4.0 开发时，本机只有 Apple Command Line Tools，没有完整 Xcode 或 Android 工具链。0.4.1 已补齐隔离的 JDK 17、Android SDK 35 和 Gradle 8.9，并在本机及 CI 编译、lint 和验证测试 APK；iOS 使用 GitHub macOS Xcode 编译了主 App 与分享扩展，产出未签名 IPA。仍未进行真实手机验收、Apple 分发签名或商店审核。Apple 另提供 App Store Connect 的 Safari Web Extension Packager，可通过网页上传浏览器扩展并生成 iOS/macOS App；该路径仍需开发者账号、兼容性检查、TestFlight 和审核。

## 官方资料

核对日期：2026-09-21。浏览器支持和系统菜单可能随版本变化。

- Apple：[iOS 运行时安全与沙箱](https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web)：第三方 App 通过系统明确提供的服务访问自身以外的信息。
- Apple：[在快捷指令中使用“在网页上运行 JavaScript”](https://support.apple.com/guide/shortcuts/use-the-run-javascript-on-webpage-action-apdb71a01d93/ios)：从 Safari 分享菜单运行，启用脚本，调用 `completion` 返回结果。
- Apple：[Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)：iOS 15 起支持，作为 App Extension 分发。
- Apple：[通过 App Store Connect 打包与分发 Safari Web Extensions](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)：云端打包、Apple Developer Program、TestFlight 与 App Store 流程。
- Apple：[Share Extension](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)：接收宿主通过分享上下文提供的内容。
- Apple：[将网站加入 iPhone 主屏幕](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios)。
- Chrome：[通过 Web Share Target 接收共享数据](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)：先安装 PWA；通过 POST/Service Worker 接收，Android URL 常在文本字段。
- Google：[安装与管理 Chrome 扩展](https://support.google.com/chrome_webstore/answer/2664769?hl=en)：桌面扩展与手机上的 Add to Desktop 的区别。
- Android：[接收其他 App 的简单数据](https://developer.android.com/training/sharing/receive)（[官方中国镜像](https://developer.android.google.cn/training/sharing/receive?hl=en)）：原生分享 Intent 的接收接口。
- MDN：[Web App Manifest `share_target`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target) 和 [兼容性源数据](https://github.com/mdn/browser-compat-data/blob/main/manifests/webapp/share_target.json)：需要安装，兼容性有限，必须校验分享输入。
