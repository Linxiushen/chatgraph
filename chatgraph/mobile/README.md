# ChatGraph 手机采集入口

目标是在手机上把一段对话交给 ChatGraph，核对原文和角色后生成知识图谱。iOS、Android 的应用隔离并不提供“安装一次就读取所有 AI App 聊天记录”的通用权限。当前采用用户主动分享、Safari 页面采集和文件导入。

0.4.3 提供 [Android 原生 App](android/README.md) 与 [iOS 主 App / 分享扩展工程](ios/README.md)。发布者可以在构建时预置已验证的 HTTPS 工作区，用户打开 App 后直接点“打开工作区”；未预置的开源构建仍可手动连接。已有地址与忘记工作区的选择会保留。Android 使用 debug 签名 APK；iOS 未签名 IPA 仍需维护者配置 Apple 签名与 App Group 才能安装。下面保留 PWA、快捷指令和浏览器扩展入口。所有入口都需要手机可访问的 HTTPS 工作区。

## 先准备手机可访问的工作区

部署自己的 HTTPS ChatGraph，参见 [`../deploy/README.md`](../deploy/README.md)。在手机浏览器打开并登录，再进入 `/mobile-inbox.html`。可通过浏览器的“添加到主屏幕”使用移动入口；Android 上系统是否显示安装按钮取决于浏览器和安装条件。

`http://127.0.0.1:4317` 指当前设备。电脑上的这个地址不能直接作为手机工作区；请使用真实的 HTTPS 部署地址。DeepSeek Key 仍由服务端管理，下面的脚本、扩展和快捷指令都不需要 Key。

## iPhone：Safari 直接采集对话正文

这一入口使用 Apple 原生的“在网页上运行 JavaScript”快捷指令动作。交付文件 [`safari-shortcut.js`](safari-shortcut.js) 与扩展共用采集适配器，输出标准对话 JSON；不是可一键安装的、已签名的 `.shortcut` 或 IPA。

首次配置：

1. 在“快捷指令”中新建“对话存入 ChatGraph”。打开详细信息，启用“在共享表单中显示”，接收类型只选“Safari 网页”。在快捷指令高级设置中启用“允许运行脚本”（具体设置位置随系统版本变化）。
2. 添加“在网页上运行 JavaScript”（Run JavaScript on Web Page），输入为“快捷指令输入”，把动作内默认脚本全部替换为 `safari-shortcut.js` 的完整内容。也可从自己的工作区 `/mobile-assets/safari-shortcut.js` 下载脚本。
3. 添加“拷贝到剪贴板”，内容选择上一步 JavaScript 的结果。
4. 添加“URL”，填自己的 `https://你的域名/mobile-inbox.html`；再添加“打开 URL”。URL 只包含入口地址，不放对话正文或 API Key。

日常使用：

1. 在 **Safari** 打开并登录 ChatGPT 或 DeepSeek 的具体对话页，等待回答结束，向上滚动加载需要的历史消息。
2. Safari → 分享 → “对话存入 ChatGraph”。首次运行时，系统会要求允许快捷指令读取当前网页。
3. 脚本从当前页面提取正文并复制 JSON，随后打开 ChatGraph 移动收件箱。
4. 点击粘贴或使用系统粘贴菜单，进入导入预览；核对首尾范围和角色后，选择整理方式。

支持 `chatgpt.com`、`chat.openai.com`、`chat.deepseek.com` 的已渲染消息结构。脚本遇到不支持的网站或无法识别消息时会停止并报错，不会返回伪造的完整对话。只返回当前已加载、可见的分支；不访问登录令牌、内部 API、其他标签页、账号全部历史、隐藏推理或附件正文。DeepSeek 无可靠角色标记时保留“未确认”，请在导入预览修正。

**从原生 ChatGPT / DeepSeek App 分享链接时**，快捷指令得到的往往只是 URL，而不是 Safari 网页对象或聊天正文。不能把 URL 直接当成此 JavaScript 动作的输入。先在 Safari 打开该链接或自己的原始对话，并确认页面实际显示了需要的消息；如果分享页结构不受支持，使用复制正文或导出文件入口。分享链接也不意味着自动拥有读取私有会话的权限。

## iPhone：从原生 AI App 分享文字

可另建一个简单的“文字存入 ChatGraph”快捷指令，无需 JavaScript：

1. 在共享表单显示，接收“文本”和“URL”。
2. “获取输入中的文本” → “拷贝到剪贴板”。
3. “URL”（自己的 `https://你的域名/mobile-inbox.html`）→“打开 URL”。
4. 在 ChatGraph 粘贴并预览。若来源 App 仅分享链接，入口会提示仍需正文；继续使用 Safari 采集、复制文字或导出文件。

这一路径只处理用户分享出来的内容，不会在后台监听其他 App。粘贴多轮正文时建议保留“用户：”“AI：”角色标签；只有单条回答时，导入预览仍需正确标记角色。

## Android：安装网页应用并使用系统分享

1. 在 Chrome 等支持安装的浏览器打开 HTTPS ChatGraph 并登录，通过浏览器菜单安装或添加到主屏幕。
2. 在其他 App 中分享文字或受支持的文本文件；若系统分享面板列出了 ChatGraph，可选择它进入移动收件箱，再预览导入。
3. 未出现分享目标时，打开主屏幕 ChatGraph，粘贴正文或从“文件”选择导出的 TXT、Markdown、JSON。

系统分享目标的可用性依赖浏览器对 Web Share Target 的支持以及 PWA 的实际安装状态。仅在浏览器里打开网页不等于注册了原生分享目标。分享出来只有链接时仍须补充正文。

Google 的 Chrome 手机端商店“Add to Desktop”是远程安装到电脑，不能据此承诺此扩展可直接装到 Android Chrome。其他支持扩展的手机浏览器须逐一验证其 Manifest V3、`scripting`、权限和下载能力；当前未作兼容承诺。

## Safari 扩展的后续发布路径

[`../extension/`](../extension/) 已支持手机宽度、保存自己的 HTTPS 工作区地址、按发送请求单个目标站点权限。可作为 Safari Web Extension 的输入源。Apple 官方工具会生成承载扩展的 iOS App 和 Xcode 项目：

```sh
xcrun safari-web-extension-packager chatgraph/extension \
  --project-location chatgraph/test-output/safari-ios \
  --app-name ChatGraph \
  --bundle-identifier com.example.chatgraph.capture \
  --swift --ios-only --copy-resources --no-open
```

旧版 Xcode 工具名是 `safari-web-extension-converter`。请把示例 Bundle ID 换成开发者账号实际使用的唯一标识，然后检查工具输出的 manifest 兼容警告、在 Xcode 选择签名团队、进行真机测试。分发仍需对应的 Apple 开发者签名/审核流程。本次环境没有可用的 Safari 打包工具，因此没有产出或声称已经签名安装的 iOS App。

## 开发验证

```sh
node chatgraph/mobile/build-shortcut.mjs --check
node --test chatgraph/extension/test/*.test.mjs
CHATGRAPH_PLAYWRIGHT_PATH=/你的/playwright/index.mjs node chatgraph/mobile/browser-check.mjs
```

采集适配器有变化时运行 `node chatgraph/mobile/build-shortcut.mjs` 更新交付脚本。当前验证覆盖 Chromium 手机视口、静态平台 DOM、Shortcut `completion` 输出和模拟扩展 API 的地址权限/跳转防护；不等于 iPhone 快捷指令真机、Safari 扩展、Android 系统分享或真实平台账号验收。

## 官方依据（2026-09-21 核对）

- [Apple：在 iPhone / iPad 的快捷指令中使用“在网页上运行 JavaScript”](https://support.apple.com/guide/shortcuts/use-the-run-javascript-on-webpage-action-apdb71a01d93/ios)：Safari 网页输入、脚本权限、从共享表单执行。
- [Apple：将 Web Extension 打包为 Safari 扩展](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)：iOS 宿主 App、Xcode 打包参数及兼容警告。
- [Google：安装和管理 Chrome 扩展](https://support.google.com/chrome_webstore/answer/2664769?hl=en)：手机上的“Add to Desktop”是把扩展装到电脑。
- [Chrome：Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)：安装后注册系统分享入口，浏览器支持和分享内容类型决定实际能力。
