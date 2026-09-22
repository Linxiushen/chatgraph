# 手机临时 HTTPS 工作区

已安装的 Android App 可以直接连接真实 HTTPS 工作区，无需为了填地址重新安装 APK。地址栏填写根地址；打开后用**工作区密码**登录。DeepSeek Key 只配置在服务器，不填写在手机地址栏或密码框。

## 临时运行

没有常驻服务器时，可用官方 `cloudflared` Quick Tunnel 进行联通验证。先从 Cloudflare 官方发行渠道安装并核对 cloudflared；脚本不会下载或执行未经验证的二进制。在仓库根目录运行：

```sh
node chatgraph/scripts/phone-preview.mjs \
  --cloudflared /absolute/path/to/cloudflared \
  --state-dir "$HOME/Library/Application Support/ChatGraph/mobile-preview" \
  --port 4321
```

脚本输出本次 `https://…trycloudflare.com` 地址。私有目录中 `credentials.json` 存放工作区密码，`status.json` 存放当前地址与进程状态。不要上传凭据文件。保持进程运行，按 Ctrl+C 停止。

可用 `--private-config /absolute/path/private.env` 指定仓库外的模型配置。重复启动会检查原进程并拒绝共用同一目录；异常退出遗留的 `preview.lock` 不会被自动抢占，必须核对其中 PID 已停止后才能手动移除。正常停止会等待自己的 cloudflared 退出，必要时终止子进程。

服务绑定本机回环地址，通过隧道提供 HTTPS。它采用独立端口和独立持久数据目录，不会公开已有桌面工作区。它只复用 `chatgraph/.env` 或环境中的模型配置，启动必须通过服务端现有 Host/Origin、密码和会话检查；模型 Key 不会注入 App、URL 或隧道进程。公网访客经本机 Cloudflare 隧道进入时，登录限流按经验证的客户端 IP 区分。

连接后应确认：未登录不能读取图谱或模型配置；登录后导入少量非敏感样例，完成生成、保存、重载和导出。手机可打开网页不等于已验证原生系统分享、真机后台恢复或蜂窝网络兼容性。

## 临时入口的边界

- 电脑必须开机、联网且服务运行。Quick Tunnel 没有可用性保证，不是长期云部署。
- 隧道重启会更换地址；服务端图谱仍在私有数据目录，但旧网页地址的草稿、登录和收件箱不会自动迁移到新域名。
- 迁移前先把待整理内容保存成图谱或导出原文。0.4.2 Android 切换工作区会清网页数据，不能在未转存原文时切换；0.4.3 已保留网页存储，但跨域数据仍需要原域名才能访问。
- 不把临时个人入口写入通用公开安装包。0.4.3 支持在专用构建时设置 `CHATGRAPH_DEFAULT_WORKSPACE_URL`，其中只允许 HTTPS 根地址，不允许凭据。
- 不为临时入口配置自动重启并声称地址不变。长期使用需固定域名、常驻云主机或命名隧道、持久存储和备份，见 [部署说明](../deploy/README.md)。

## 本次实际验证（2026-09-22）

通过真实公网 HTTPS 验证了健康端点与手机页面、未登录 API 拒绝、登录 Secure/HttpOnly Cookie、错误 Origin 拒绝和配置不包含密钥。用已配置的 `deepseek-v4-pro` 完成一次虚构样例的异步生成，得到 12 个节点，随后保存、重新读取并导出 Markdown。凭据与实时临时地址仅保存在本机私有目录，不随仓库发布。

390×844 浏览器通过真实公网完成登录、粘贴、检查范围、原文整理、保存、刷新恢复与收件清理；页面无 JS 错误或横向溢出，截图已复核。

这项验证不等于已完成手机蜂窝网络实测、Android/iOS 真机系统分享验收或长期部署。
