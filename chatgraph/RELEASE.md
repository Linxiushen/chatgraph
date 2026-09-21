# ChatGraph 本地发布包

需要 Node.js 20 或更新版本。核心网页、存储和五种导出格式不依赖 npm 包。

```sh
node chatgraph/scripts/package-release.mjs
```

脚本读取 `chatgraph/package.json` 的版本号，在 `chatgraph/test-output/releases/` 生成主程序 ZIP、独立浏览器扩展 ZIP 和各自的 SHA-256 文件。第二个命令行参数可指定输出目录。相同源文件会生成相同字节的 ZIP。主包内 `SHA256SUMS` 记录每个源文件的校验值。扩展 ZIP 的根目录即为 `manifest.json` 所在目录，解压后可作为未打包的扩展加载。

解压后进入 `chatgraph-<版本号>` 目录：

```sh
node chatgraph/server.mjs
```

浏览器打开 `http://127.0.0.1:4317`。模型配置按 `chatgraph/README.md` 操作。发布包不携带任何已有密钥、账号配置、对话或知识库。

## 发布内容

包含 ChatGraph 服务端、网页与 PWA 资源、手机收件箱、iPhone Safari 快捷指令脚本、浏览器扩展、ChatGPT 集成源码、部署模板、测试和说明文档，以及运行 HTML 导出需要的 Archify 模板、国际化工具与许可文件。Archify 模板已经内嵌阅读器和字体，包中保留对应字体许可。

手机安装需要可访问的 HTTPS 工作区。PWA 从 `/mobile-inbox.html` 添加到主屏幕；iPhone 快捷指令按 `chatgraph/mobile/README.md` 设置。原生版本另外提供 Android 和 iOS 两个 ZIP，Android 内含 debug 测试签名 APK，iOS 内含未签名 IPA 与 Xcode 工程；它们不代表应用商店或真实设备验收通过。

## Android / iOS 独立包

Android 工程位于 `chatgraph/mobile/android`，iOS 工程位于 `chatgraph/mobile/ios`。原生 CI 编译 APK、检查 Android lint、验证 APK 签名，并在 macOS Xcode 上编译主 App 和分享扩展，将无分发签名的 App 放入 IPA。不能把未签名 IPA 当作可直接安装到普通 iPhone 的包。

下载对应 CI 产物后执行：

```sh
node chatgraph/scripts/package-native.mjs \
  --android-apk /实际路径/app-debug.apk \
  --ios-ipa /实际路径/ChatGraph-iOS-unsigned.ipa
```

脚本生成 `ChatGraph-Android-<版本>.zip` 和 `ChatGraph-iOS-<版本>.zip`，各自包含真实编译产物、完整原生源码、中文使用说明、许可证和文件校验值。不会包含本机 SDK、Gradle 缓存、构建中间文件、签名私钥、个人导出配置或服务器密钥。源码包内的脚本可用 `bash` 执行，无需依赖 ZIP 保留可执行标记。

发布脚本只读取明确列出的文件和源代码目录。它排除 `.env`、`.data`、`.git`、`node_modules`、历史快照、分享数据、任务数据、测试输出和构建目录。`.env.example` 是唯一允许打包的环境变量示例。符号链接会使打包失败。

ChatGPT MCP 集成是独立的可选服务，需在 `chatgraph/integrations/chatgpt` 执行 `npm ci` 安装该目录公开声明且锁定的依赖。它不影响核心网页离线启动。官方应用上架和浏览器商店发布仍需使用相应开发者账号完成。

## PowerPoint 导出

PPTX 导出使用原生可编辑文本框。文稿包含封面、讨论说明、主题总览、逐个节点、图谱中已经标注的修正/质疑关系、对话批次和原文索引。长节点内容自动分页，未另行生成事实或改写结论。

节点页备注保留完整节点数据、相关关系、原文编号和对应的原文索引页码。索引页只展示明确标注的预览，完整消息保存在该页备注中。每条消息正文只在原文索引备注中保留一份，避免长对话反复膨胀。

幻灯片采用 16:9，拉丁字体为 Arial，中文字体为 Heiti SC。接收电脑缺少字体时 Office/LibreOffice 会回退到本机字体。源码没有内嵌或分发这些系统字体。超过 1,200 页或解压内容超过 64 MB 时导出明确失败，建议分段或使用 Markdown。

## 数据升级与备份

旧图谱读取时迁移为 schema v2，首次保存才写回。备份 JSON 包含当前版本图谱，导入同 ID 图谱会创建副本。若需同时保留历史快照、任务和分享记录，请备份整个 `chatgraph/.data` 目录。

升级前保留自己的数据目录及环境变量文件，把新包解压到新目录验证，再按需指定 `CHATGRAPH_DATA_DIR`。不要把个人数据或真实密钥加入发布包。


## 0.4.2 升级注意

先停止应用并使用 `scripts/data-snapshot.mjs` 备份全部数据，校验通过后再升级；[部署手册](deploy/README.md) 提供完整命令。新图谱规范 JSON 上限为 8 MiB，HTTP 请求为 32 MiB，网页备份为 50 MiB。旧有超大图谱不会被删除，但会提示需要恢复，先保留原文件再拆分。删除接口要求 `expectedRevision`，旧页面刷新后再操作。

这一版加强 Android/iOS 原生收件保护，Android versionCode 4002，iOS build 6。原生队列兼容旧数据格式，但 debug APK 的 CI 签名可能与旧包不同；不能覆盖安装时，先通过原入口转存原文再卸载。正式升级应使用固定发行密钥。iOS 未签名 IPA 仍需要 Apple 签名。旧 0.4.1 发布资产不覆盖。

完整工程验收、单进程限制、外部上线条件见 [工程验收矩阵](docs/engineering-readiness.md)。
