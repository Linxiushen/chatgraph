# ChatGraph 官方 MCP 接入适配器

此目录是可独立启动和协议测试的可选适配器。使用官方 MCP Node SDK、MCP Apps 元数据和标准 iframe 桥接，主程序继续保持独立运行。它尚未连接用户的真实 ChatGPT 账号，也没有上线或通过官方审核。

2026-09-20 查阅的 OpenAI 官方文档已将原 Apps SDK 路径转到 Plugins 文档。按当前文档实现：Streamable HTTP `/mcp`、`_meta.ui.resourceUri`、`text/html;profile=mcp-app`、`ui/initialize`（`2026-01-26`）和 `ui/notifications/tool-result`。使用 SDK 处理 MCP 生命周期/传输，不手写替代协议。

## 本机启动

在仓库根目录运行：

```sh
npm --prefix chatgraph/integrations/chatgpt ci --ignore-scripts
node chatgraph/integrations/chatgpt/server.mjs
```

地址为 `http://127.0.0.1:4318/mcp`。默认只提供原文整理与图谱查看，不加载主程序 `.env`、不调用模型，也不读取主程序的图谱库。

需要本机模型整理时，显式加载主程序的私有配置并启用工具：

```sh
CHATGRAPH_MCP_ENABLE_AI=1 node --env-file=chatgraph/.env chatgraph/integrations/chatgpt/server.mjs
```

配置读取 `CHATGRAPH_API_BASE_URL`、`CHATGRAPH_API_KEY`、`CHATGRAPH_MODEL`。密钥只在服务端使用，不进入工具参数、组件、图谱导出或日志。主程序的 `.env` 必须继续忽略提交。`CHATGRAPH_MCP_PORT` 可修改本机端口。

支持本地 MCP 客户端的 stdio 模式：

```sh
node chatgraph/integrations/chatgpt/server.mjs --stdio
```

stdio 只输出 MCP 协议消息。客户端需使用本仓库的实际绝对路径配置命令；该模式不等同于 ChatGPT 网页完成连接。

## 工具与来源边界

| 工具 | 行为 |
| --- | --- |
| `organize_conversation` | 按提供的原文及角色生成图谱；不调用模型，所有判断状态待确认，最多 199 条 |
| `analyze_conversation` | 仅在显式启用时出现；把参数中的对话发送给部署者配置的模型服务，可能产生费用 |
| `render_conversation_graph` | 校验图谱及引用，显示可折叠大纲、观点关系、原文依据和完整 JSON 导出 |

整理工具返回可继续调用的 `structuredContent.graph`；只有展示工具关联 UI 资源。匿名工具标注 `noauth`；配置 OAuth 后全部工具声明 `oauth2` 与 `chatgraph:use`。调用模型的工具声明 `openWorldHint: true`。

插件接收的是模型实际传入工具的消息参数，不会自动获得完整聊天历史。默认 `source_scope: provided_excerpt` 在图谱中保留为 `source.complete: partial`；`user_supplied_export` 标记 `provided`，只表示本次提供的文件内容，不表示完整账号历史。工具描述明确要求保留原话、角色和 ID，无法提供完整原文时必须说明范围。结构/引用检查能发现不存在的 ID、不合理角色引用或把仍有效的观点作为已修正旧观点的关系，不能证明模型转述忠于原话，也不能证明观点判断在语义上正确。需在真实宿主中验证这一边界。

所有工具无业务持久化状态：不写入用户图谱库，不发布链接，不在不同请求之间保存已完成的对话。需继续编辑时，下载图谱 JSON 并导入主程序。组件不会从浏览器直接连接模型服务；无外部资源、无外部连接 CSP。

HTTP 使用 SDK 协议会话，以便 `notifications/cancelled` 到达正在运行的工具，并将 AbortSignal 传给模型请求。会话只在内存中保存，最多 30 个，空闲 30 分钟后回收；客户端主动 DELETE 也可结束会话。OAuth 模式下协议会话绑定令牌 subject，每次请求重新验签，其他账号即使持有会话 ID 也不能接管。服务重启后需重新初始化连接。

## 与 ChatGPT 连接

本机先使用 MCP Inspector 验证：

```sh
npx @modelcontextprotocol/inspector
```

选择 Streamable HTTP，连接 `http://127.0.0.1:4318/mcp`，检查工具、资源和输入输出。

按当前官方 quickstart，ChatGPT 开发连接需要可达的 HTTPS `/mcp` URL，然后在账号设置中开启 Developer mode，在 Plugins 中添加该连接并在新对话里选用。该账号入口的实际可见性需在用户账号确认；这里不声称自动获得了权限。

本适配器仅绑定本机回环地址。可由你自己的 HTTPS 反向代理转发，配置：

```sh
CHATGRAPH_MCP_PUBLIC_URL=https://your-domain.example/mcp node chatgraph/integrations/chatgpt/server.mjs
```

这是配置示例，不是已经拥有或部署的域名。服务校验 Host / Origin，限制 2 MB 请求体、每来源地址每分钟 60 次请求、一次一个模型整理；不会把对话和令牌写入访问日志。若代理改写 Host，需保持本机 Host 或配置的公开域名。

未配置 OAuth 时可提供只处理本次参数的匿名原文工具；**公开端点启用付费模型整理会拒绝启动，直到配置 OAuth**。开发阶段可以使用安全隧道连接私人端点；临时隧道或纯本机地址不满足官方公开发布对稳定 HTTPS 服务的要求。

## OAuth 资源服务

已实现 JWT/JWKS 资源服务校验和 `/.well-known/oauth-protected-resource` 发现接口；登录页面、授权码、PKCE、refresh token 与客户端注册由你配置的身份提供商负责。没有伪造一个可用的 OAuth 登录账号。

配置以下非秘密环境变量，令身份提供商签发的令牌与配置完全一致：

```dotenv
CHATGRAPH_MCP_PUBLIC_URL=https://your-domain.example/mcp
CHATGRAPH_MCP_AUTH_ISSUER=https://your-identity-provider.example/
CHATGRAPH_MCP_AUTH_JWKS_URL=https://your-identity-provider.example/.well-known/jwks.json
CHATGRAPH_MCP_AUTH_AUDIENCE=https://your-domain.example/mcp
CHATGRAPH_MCP_ENABLE_AI=1
```

支持 RS256 / ES256 签名，强制校验 issuer、audience、expiry、iat、sub 与 `chatgraph:use` scope，拒绝伪造或权限不足的令牌。issuer 与身份提供商的 `iss` 必须逐字匹配（包括末尾斜线）。未授权请求返回 HTTP 401 与 metadata 发现地址。

身份提供商还需按官方 OAuth 2.1/MCP 文档支持 resource 参数、PKCE、CIMD/DCR 或预注册客户端，并配置实际 ChatGPT 回调。现有单元测试使用临时签名密钥验证资源服务，未连接实际身份提供商；不能把该测试报告称为完整 OAuth 登录联调完成。

## 发布仍需完成的外部步骤

1. 配置真实域名、稳定 HTTPS 托管和（需要模型/账号能力时）身份提供商。
2. 在真实 ChatGPT 账号中连接，验证可获得的对话范围、中文原文准确性、UI 加载、下载和授权。
3. 基于实际部署填写隐私政策、服务信息、域名验证和测试说明，再按官方 Plugins 提交流程审核；此仓库没有替用户创建主体、接受协议或提交审核。
4. 多租户保存/检索需要另接用户隔离存储和逐请求授权；当前适配器不会直接暴露本机所有图谱给远端账号。

## 测试

```sh
npm --prefix chatgraph/integrations/chatgpt test
```

测试使用官方 SDK 客户端完成 HTTP 初始化、工具调用和 UI 资源读取，并覆盖原文/角色/导入范围保留、状态隔离、引用拒绝、错误输入、外部模型启用边界、客户端取消到模型请求、会话结束、Origin/大小校验以及 OAuth JWT 与会话身份绑定。平台页面和组件浏览器测试见上一级 `browser-check.mjs`。

2026-09-20 针对此可选适配器运行 `npm audit --omit=dev`，报告 0 个已知依赖漏洞。此结果是依赖审计当时的快照，不等于应用或部署已通过安全认证。

依赖锁定于本目录 `package-lock.json`，不进入主程序运行依赖。第三方包沿用各自许可证：MCP SDK、MCP Apps、Zod 为 MIT，jose 为 MIT。ChatGraph 代码使用仓库中的 MIT 许可证。

## OpenAI 官方来源

- [MCP server and UI quickstart](https://developers.openai.com/apps-sdk/quickstart)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Authentication](https://developers.openai.com/plugins/build/auth)
- [Plugin UI reference](https://developers.openai.com/plugins/reference)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
