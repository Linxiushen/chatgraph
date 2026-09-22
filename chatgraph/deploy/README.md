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

若使用本机 `cloudflared` 提供 Cloudflare Tunnel 入口，可以显式设置 `CHATGRAPH_TRUST_PROXY=loopback-cloudflare`，让登录限流按 Cloudflare 提供的真实客户端 IP 计算，避免多个访客共用隧道地址而互相锁定。此选项只在连接服务的 TCP 对端是 loopback 时读取合法、单个 `CF-Connecting-IP`；缺失或非法时退回 socket 地址。默认不信任此头，也不读取 `X-Forwarded-For`。只应在服务绑定 loopback、入口确实来自受控本机 Cloudflare Tunnel 时启用；不要套用于可直连的普通代理或容器网络对端。它不改变 Host、Origin 或工作区密码校验。

## 数据与分享

`chatgraph_data` 保存图谱、历史、任务结果和分享快照。升级前备份整个数据卷。网页里的 JSON 备份用于迁移当前图谱，不包括历史快照。模型任务被进程重启打断时显示失败，重新提交前可恢复原文草稿，服务不会自动重复收费请求。

分享链接是随机令牌快照，可以过期或撤回。默认不附原文与节点备注。任何拿到有效公开分享链接的人都能查看对应内容。分享不会跟随之后的图谱编辑自动更新。

浏览器草稿存于当前站点的 IndexedDB，不能代替服务端备份。请勿对共享电脑的登录浏览器授予他人访问。跨设备的版本冲突会明确提示，避免旧草稿覆盖新版本。

## ChatGPT 官方入口

ChatGPT 组件/MCP 服务是可选的独立服务，见 `../integrations/README.md`。公开启用付费 AI 功能需要配置 OAuth 身份验证、资源权限和可达 HTTPS 服务。主工作区的密码登录不等于 MCP OAuth。

本仓库提供部署配置，不包含服务器、域名、已申请的开发者账号或应用商店审核结果。Docker 本地验证不代表外网 HTTPS 部署已经完成。

## 健康、容量与运行边界

容器使用非 root 用户、只读根文件系统、无额外 Linux capability、1 GiB 内存、2 CPU 与 128 进程上限；只有数据卷和临时目录可写。Docker 每 30 秒调用不含私人数据的健康端点，Caddy 等待应用健康后启动。日志轮转最多 3 份、每份 10 MB。部署者应监测容器状态、数据卷剩余空间、备份年龄和 TLS 续期。健康端点只证明 HTTP 服务活着，不代表模型余额、磁盘写权限、备份或外网 TLS 正常；Docker 将 unhealthy 标出来但不会仅凭 unhealthy 自动重启。

当前是单拥有者、单进程文件存储。**不得配置 replicas > 1，也不得在宿主机另开 Node 进程写同一卷。** 多租户、分布式队列和水平扩容需要另一套数据/权限设计。手机和多个浏览器可访问同一个进程，版本冲突保护继续生效。

## 可执行的全量备份与恢复

网页 JSON 备份适合图谱迁移；`data-snapshot.mjs` 保留整个数据目录，包括历史、付费任务回执、分享和损坏原件。快照是一个含 `manifest.json` 与 `data/` 的私密目录，逐文件 SHA-256 校验，文件权限 0600、目录 0700；它没有自带加密，应放在受控/加密备份存储，不加入源码或公开发行包。

先停止**所有**使用该数据目录的服务。`--stopped` 是操作员确认，不会替你停机，也不是在线一致性快照。以下命令不覆盖已有目录：

```sh
node chatgraph/scripts/data-snapshot.mjs backup --data-dir /private/chatgraph-data --output /private/backups/before-upgrade --stopped
node chatgraph/scripts/data-snapshot.mjs verify --snapshot /private/backups/before-upgrade
node chatgraph/scripts/data-snapshot.mjs restore --snapshot /private/backups/before-upgrade --data-dir /private/chatgraph-restored --stopped
```

恢复前先验证全部文件；任何文件缺失、额外文件、校验不符、符号链接或路径逃逸都中止操作。复制中断时保留 `.incomplete`，不能当作成功快照或启用的数据目录。即使原图谱已损坏，也保留其字节用于人工恢复。快照不会包含数据目录外的 `.env`，部署环境和正式签名密钥必须另外安全备份。

Docker 部署可以按同样步骤操作。先准备仅管理员和容器 UID 1000 可写的宿主机目录 `/secure/chatgraph-backups`，然后在仓库根目录执行：

```sh
docker compose --env-file /secure/chatgraph-deploy.env -f chatgraph/deploy/compose.yaml stop app
docker compose --env-file /secure/chatgraph-deploy.env -f chatgraph/deploy/compose.yaml run --rm --no-deps -v /secure/chatgraph-backups:/backups app node chatgraph/scripts/data-snapshot.mjs backup --data-dir /data --output /backups/before-upgrade --stopped
docker compose --env-file /secure/chatgraph-deploy.env -f chatgraph/deploy/compose.yaml run --rm --no-deps -v /secure/chatgraph-backups:/backups:ro app node chatgraph/scripts/data-snapshot.mjs verify --snapshot /backups/before-upgrade
docker compose --env-file /secure/chatgraph-deploy.env -f chatgraph/deploy/compose.yaml up -d --build
```

需要回滚数据时先停 `app`，将快照恢复到卷中的一个新子目录，例如 `--data-dir /data/restored-20260921`。在私密环境文件设置 `CHATGRAPH_DATA_DIR=/data/restored-20260921` 后重新创建应用，旧数据保留不动。此后备份命令的 `--data-dir` 也必须使用该配置值。不要覆盖现存目录来“强制恢复”。只回滚程序时使用上一版源码和既有数据；涉及未来 schema 变更时须按版本迁移文档操作，不能假设旧版一定能读新版数据。

至少每天和升级前执行备份，保留一份不同机器/存储账户上的副本；先验证新备份成功再执行保留周期清理。每月在新目录演练恢复并检查历史与任务回执。这里提供命令与演练测试，没有擅自为你的机器配置定时任务或删除旧备份。

## 部署回归

```sh
node chatgraph/scripts/deploy-check.mjs
```

需要可用 Docker。脚本建立独立测试镜像、卷和临时密码，验证非 root/只读运行、健康、登录、保存、容器重启后的图谱和任务回执、导出及停机备份恢复，最后清理自己的资源。没有真实模型调用，不访问用户已有知识库。CI 同样执行这项检查；真实公网 HTTPS、域名续期、设备访问和实际磁盘容量仍应在上线环境验收。
