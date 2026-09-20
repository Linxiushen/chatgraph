# 部署单人工作区

本地启动不需要 Docker。在线部署使用同一套服务，把文件存储映射到持久数据卷，并通过 HTTPS 访问。当前账号模型是单一拥有者密码登录，可多设备编辑，分享访客只读；不提供多人组织、实时协作或多租户隔离。

## Docker Compose + HTTPS

前提：一台运行 Docker Compose 的服务器、指向该服务器的域名、开放的 80/443 端口。TLS 由 Caddy 申请和续期。

把实际参数放入自己的私密环境文件，例如 `/secure/chatgraph-deploy.env`（权限 `0600`）：

```dotenv
CHATGRAPH_DOMAIN=graph.example.com
CHATGRAPH_AUTH_PASSWORD=replace-with-at-least-16-private-characters
CHATGRAPH_API_KEY=your-provider-key
```

在仓库根目录执行：

```sh
docker compose --env-file /secure/chatgraph-deploy.env -f chatgraph/deploy/compose.yaml up -d --build
```

访问 `https://graph.example.com`，输入工作区密码。密钥在服务端传给 DeepSeek，不出现在浏览器配置接口。修改环境文件后用同一命令重新创建容器。不要通过聊天消息或公开问题报告提交部署文件。

工作区登录使用 Secure、HttpOnly、SameSite=Strict 会话 Cookie；会话保留一天，服务重启后需重新登录。失败登录受到限流保护。服务检查配置的 Host 和 Origin，不信任任意转发头。反向代理须保留公开 Host。单进程服务串行写入文件，不要把多个应用副本同时指向同一数据卷。

## 数据与分享

`chatgraph_data` 保存图谱、历史、任务结果和分享快照。升级前备份整个数据卷。网页里的 JSON 备份用于迁移当前图谱，不包括历史快照。模型任务被进程重启打断时显示失败，重新提交前可恢复原文草稿，服务不会自动重复收费请求。

分享链接是随机令牌快照，可以过期或撤回。默认不附原文与节点备注。任何拿到有效公开分享链接的人都能查看对应内容。分享不会跟随之后的图谱编辑自动更新。

浏览器草稿存于当前站点的 IndexedDB，不能代替服务端备份。请勿对共享电脑的登录浏览器授予他人访问。跨设备的版本冲突会明确提示，避免旧草稿覆盖新版本。

## ChatGPT 官方入口

ChatGPT 组件/MCP 服务是可选的独立服务，见 `../integrations/README.md`。公开启用付费 AI 功能需要配置 OAuth 身份验证、资源权限和可达 HTTPS 服务。主工作区的密码登录不等于 MCP OAuth。

本仓库提供部署配置，不包含服务器、域名、已申请的开发者账号或应用商店审核结果。Docker 本地验证不代表外网 HTTPS 部署已经完成。
