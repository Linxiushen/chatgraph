# ChatGraph Android 原生测试版

这是可编译安装的 Android App，不是把网页文件改名为 APK。支持 Android 8.0（API 26）及以上版本，建议使用更新后的 Android System WebView。

## 安装与首次使用

1. 打开发布的 Android APK，或解压 Android 包后打开其中的 `ChatGraph-android-0.4.3-beta.1-debug.apk`，按系统提示允许本次安装。
2. 若发布者已预置可用工作区，首页直接点“打开工作区”，无需填写服务器地址。未预置的开源构建显示“连接工作区”；在其中填写手机可访问的 **ChatGraph HTTPS 根地址**。服务器请使用 0.4.1 或更新版，以支持 App 重启后的任务恢复。手机的 `127.0.0.1` 不是电脑上的服务；App 不包含服务器或 API 密钥。
3. 点“打开工作区”，根据服务器要求登录，即可粘贴、选择文件、查看或编辑图谱。
4. 在其他 App 的系统分享菜单中选择 **ChatGraph 对话图谱**。支持文字、URL 或单个 UTF-8 TXT / Markdown / JSON 文件。
5. 回到 ChatGraph 点“导入这份内容”。App 把内容交给当前 HTTPS 工作区的手机收件箱；预览后点击“检查并整理”，再按网页流程确认生成。

来源 App 分享的内容由其决定。若它只给了分享链接，ChatGraph 仍需原文，不能据此自动读取其他 App 的聊天记录。网页和原生分享菜单是否出现、文件提供器兼容性仍需真机验证。

## 本机存储与接入边界

- 原生收件箱最多 5 份、合计 50 MB；文字最多 2 MB，单个文件最多 25 MB。文件先读到 App 私有目录，读取失败时不会保存半份内容。
- 本机副本保留到网页明确确认 IndexedDB 写入成功，或用户手动删除。退出、重启 App 后仍可继续；原生目录不进入 Android 云备份或设备迁移备份。
- 写入先同步原文，再原子提交收件元数据。若进程在两步之间终止，下次打开会重建元数据；读取失败会明确报错并保留原件。多个 Activity 使用同一进程锁检查容量，仍在队列中的相同分享不会因 Intent 重放而重复保存。
- 返回本机收件箱后再打开同一工作区，会保留当前网页会话；不会因为切换界面而销毁正在整理的页面。系统终止 App 后的任务恢复由工作区的草稿恢复流程处理。
- 网页收件箱有独立的 24 小时清理规则。不要把尚未完成整理的网页收件箱当作永久知识库。
- 本机副本导入成功后会删除；不会自动触发 AI，也不会上传到未配置的工作区。
- “更换工作区 / 设置”中可以修改入口，或“忘记工作区并退出登录”。忘记后重启或升级都不会自动恢复预置入口；可自行重新连接。已有地址优先于新版本预置值。更换或忘记只退出网页登录、清缓存，保留网站 IndexedDB / localStorage 中已保存的原文及本机收件箱，避免误删已确认导入的内容。
- App 仅在配置的精确 HTTPS 源内打开网页；无 `addJavascriptInterface`、无明文 HTTP、无 SSL 证书绕过，不申请读取通知、无障碍、录屏或全盘存储权限。
- 外部 HTTPS 链接交给系统浏览器；不转发 App Cookie。原生 WebView 暂不保存 Blob 导出，导出 Markdown / PPTX 等请在系统浏览器打开同一工作区操作。
- 这是供自行安装和测试的 **debug 签名 APK**，不是 Google Play 正式版。CI 的 debug 密钥可能在不同构建间变化；即使包名相同、版本更高，也不保证能够覆盖安装。正式发布须由维护者保管并持续使用自己的发行签名。不要为解决签名冲突直接卸载：卸载会删除原生收件箱及 App 网页数据，请先完成整理、保存或导出。

## 从源码构建

需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0 和 Gradle 8.9。无 AndroidX 或其他运行时依赖；首次 Gradle 构建需联网获取官方构建插件。

```sh
export ANDROID_HOME=/你的/Android/sdk
export JAVA_HOME=/你的/jdk-17
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

标准产物：`app/build/outputs/apk/debug/app-debug.apk`。

### 给安装包预置工作区

先在手机浏览器验证真实 HTTPS 根地址可以打开、登录，且 `GET /api/health` 返回 `{"ok":true}`。然后以 Gradle 参数或环境变量注入；默认留空，不会内置示例域名：

```sh
# WORKSPACE_URL 是已验证的真实根地址，不含密码或 token。
./gradlew -PchatgraphDefaultWorkspaceUrl="$WORKSPACE_URL" :app:assembleDebug
# 或：
CHATGRAPH_DEFAULT_WORKSPACE_URL="$WORKSPACE_URL" ./package-debug.sh
```

Gradle 属性优先于环境变量。非 HTTPS、凭据、路径、查询、片段、非法端口或 localhost 将直接令构建失败。默认值只是公开地址，运行时仍须在工作区登录；不要把账号、密码或模型 Key 加入构建参数。首次采用默认值会保存到原有偏好设置；更新安装包不会覆盖用户当前选择，也不会删除历史存储。点“打开工作区”才发起页面请求，不会自动上传收件箱或调用模型。临时隧道域名变化时，用户仍可在设置更换入口。

JVM 单测使用临时目录验证原文/元数据恢复、旧版备份兼容、并发容量限制、Intent 重放去重、工作区 URL 校验、已有地址优先和忘记后不自动恢复。它不替代真实 Android 的分享面板、文件提供器、进程回收和磁盘断电验收。

若源码环境缺少 `gradle/wrapper/gradle-wrapper.jar`，先用已安装的 Gradle 8.9 运行 `gradle wrapper --gradle-version 8.9`；发布源码包应包含 wrapper。禁止将 `local.properties`、私有签名密钥、服务端 `.env` 或 API Key 放入源码包。

本地打包 APK 可使用：

```sh
./package-debug.sh
```

## 建议真机验收

- 初次配置 HTTPS、登录、正常收件、仅 URL 提示、单个文件和错误编码提示。
- 断网收件后杀进程，重新打开并恢复；多个待导入内容互不覆盖。
- 工作区无法连接、收件箱已满、拒绝网站存储时，本机副本仍存在。
- 证书错误、非 HTTPS 配置、外部链接、新窗口链接和文件选择边界。
- Android 8 与 Android 15 的分享菜单、屏幕旋转、键盘和系统导航。

实际构建检查和真机测试情况以发布说明为准。
