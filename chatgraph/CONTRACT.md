# ChatGraph 0.3 接口与数据契约

Node.js 20+，浏览器 ES Modules。核心服务不依赖 npm 包；可选 ChatGPT MCP 服务在独立目录安装依赖。公开字段均经白名单验证，凭据不属于图谱模型。

## 图谱

`{schemaVersion:2,revision,id,title,description,createdAt,updatedAt,mode,source,messages,nodes,edges,sessions,analysis?}`。

- `mode`: `demo` 为明确标注的虚构样例；`outline` 仅按原文组织；`ai` 为真实模型结果。
- `source`: `{platform,url,complete}`；complete 为 unknown/provided/partial，仅描述提供的范围，不保证整段账号会话完整。
- `messages`: `[{id,role,content}]`，role 为 user/assistant/unknown，保存实际文本。
- `nodes`: `[{id,label,summary,type,stance,status,sourceIds,parentId,note,importance,x?,y?}]`。
- type: topic/claim/evidence/question/action；stance: user/ai/shared/unknown；status: confirmed/proposed/rejected/revised/open；importance 为 1–5，默认 3。
- `edges`: `[{id,source,target,type,label}]`，type 为 contains/supports/challenges/revises/depends。父子层级以 parentId 为准，排序使用节点数组内同级顺序。
- `sessions`: `[{id,title,createdAt,mode,source,sourceGraphId,messageIds,nodeIds,analysis?}]`；追加时保留各批次原文及提取记录。
- `analysis`: `{model,generatedAt,durationMs,inputTokens,outputTokens,calls,chunkCount,warnings}`。只记录用量和校验信息，不保存密钥或模型私有推理内容。

旧文件读取时迁移，revision 默认 0。新图谱首次保存以 revision 0 提交；服务返回递增 revision。继续保存必须基于最新 revision，否则 HTTP 409。恢复历史也创建新 revision。手动节点允许没有引用，AI 非根节点必须关联实际原文；用户、AI、共同观点必须有对应角色依据。AI 的 revises 目标必须为 revised/rejected，并有用户改变判断的消息。

节点删除须清理 edges、子节点 parentId 和 sessions[].nodeIds。追加保留现有图谱 id/revision 和人工修改，新的 ID 重映射；仅对语义字段及引用文本完全相同的叶节点去重。自动追加不推断新旧观点互相替代。

## HTTP

错误格式 `{error:string}`。默认 localhost:4317；普通 JSON 请求上限 2 MB，备份请求 50 MB。处理文字最多 500 条消息/200 节点。API 响应不缓存。

| 方法 | 路径 | 请求或结果 |
|---|---|---|
| GET | /api/config | aiConfigured/model/baseUrl/reasoningEffort/hosted/version，不返回密钥 |
| GET | /api/health | `{ok:true}` |
| GET | /api/demo | 虚构演示图谱 |
| GET | /api/graphs | 图谱摘要数组，损坏项含 recoveryRequired:true |
| POST | /api/graphs | 请求图谱，返回保存后的图谱与 revision |
| GET/DELETE | /api/graphs/:id | 读取/可恢复删除 |
| GET | /api/graphs/:id/history | `[{version,createdAt,title,nodeCount}]` |
| POST | /api/graphs/:id/restore | `{version,expectedRevision}`，也兼容 revision；损坏文件恢复 expectedRevision:null |
| POST | /api/import | `{text,title?,platform?,url?,complete?,mode,api?}`，生成但不保存 |
| POST | /api/append | 同上加 graph，返回合并但未保存的图谱 |
| POST | /api/jobs | `{id?:客户端UUID,kind:import或append,input}`，202 返回任务，相同 id 幂等返回原任务 |
| GET/DELETE | /api/jobs/:id | 状态/取消 |
| GET | /api/search?q= | 全文检索结果数组 |
| POST | /api/search | `{query,api?}`，AI 关联检索结果数组，matchType:semantic |
| POST | /api/relations/suggest | `{graph,api?}`，返回 `{relations,analysis}`，不修改图谱 |
| GET | /api/backup | 当前图谱的 JSON 备份下载 |
| POST | /api/backup | `{backup}`，先验证全部内容，再逐份保存，已有 ID 创建副本；返回 `{count,restored}` |
| GET | /api/diagnostics | 损坏文件及未完成临时文件数量 |
| POST | /api/export | `{graph,format}`，markdown/json/svg/html/pptx 下载 |
| POST | /api/shares | `{graph,includeSources:false,expiresInDays:7}`，返回令牌、URL、有效期及 local/public 范围 |
| GET | /api/shares | 分享快照摘要列表 |
| DELETE | /api/shares/:token | 撤回 |
| GET | /s/:token | 无登录只读 HTML 快照，过期/撤回不可用 |
| POST | /api/login | 托管工作区密码登录 `{password}` |
| POST | /api/logout | 清除登录会话 |

任务为 `{id,kind,status,progress,message,createdAt,updatedAt,result?,error?}`；status 为 queued/running/completed/failed/cancelled；progress 为 0–100。队列单并发，最多五个待运行任务。客户端在请求前保留 UUID，相同 UUID 的并发/重复提交及服务重启后的查询不会启动第二次模型调用。只持久化状态和结果，不持久化请求中的模型配置；中断任务在重启后明确失败，未自动重新收费。任务记录真正不存在才返回 404；损坏返回 422，无法读取返回 503，后两者阻止相同 UUID 新建。任务状态写入经 fsync 后原子替换。取消不能退还已由模型服务消耗的 token。

AI 设置可由服务器 `.env` 或当前页面内存提供。网页 api 结构 `{baseUrl,model,apiKey,reasoningEffort?}`。自定义地址不得获取其他端点的服务器密钥。原始对话是资料，不是系统指令。

## 浏览器与托管

账号导出的 JSON（最多 25 MB）只在浏览器本地解析；用户选择会话、连续消息范围和角色后，转换为标准 messages/source JSON。解析器由浏览器与服务端共享。只保存应用后的选定内容；账号原文件不写入导入草稿，也不发送到服务端。导入消息、节点与普通请求体的原有上限保持不变。

草稿放在当前来源的 IndexedDB，只包含图谱/原文编辑数据，不包含 API 设置。自动保存保留服务器 revision，409 显示复制草稿或载入新版本的选择。移动端默认大纲。

扩展使用用户点击后的页面 DOM 采集，并展示范围和角色预览。向所选本机或 HTTPS 工作区传递 `chatgraph:import` postMessage；按需请求目标站点权限，注入前再次核对含端口的 origin。页面核对自身来源、消息类型和负载后打开导入预览，不自动调用模型。接口也能读取标准 messages JSON 中的 capture/source 元数据。

## 手机接收协议

`/manifest.webmanifest` 定义独立启动入口 `/mobile-inbox.html` 和 POST multipart `/mobile-share`，接收 `title/text/url/files`。此 POST 由已安装 PWA 的 Service Worker 处理，验证后只写设备 IndexedDB，再以 303 导航到带不透明 UUID 的收件箱。它不是服务器上传 API；未被拦截的同源请求返回 405，不解析、保存或反射正文。真实系统分享可用性由移动浏览器决定。

`mobile.js` 对文字限 2 MB、单文件限 25 MB，仅接收 UTF-8 TXT/Markdown/JSON；拒绝二进制、多个文件、不安全来源链接。纯 URL 表示链接，无对话原文。收件箱最多 5 份、合计 50 MB，24 小时后下次访问时清理，可主动删除。收件箱可暂存完整账号导出，只有在工作台选择的会话/范围进入导入草稿及后续请求；图谱成功保存到工作区后才移除收件原件。

收件箱以 sessionStorage 和 `#mobile-import=<UUID>` 传递记录 ID，URL 不包含对话。刷新后沿用已保留的导入任务，避免重复调用模型。0.4.1 手机任务还可跨浏览器会话 owner 恢复同一任务编号；普通图谱编辑和非手机导入仍按标签页隔离。图谱保存成功才清理同一 operationId / mobileShareId 的收件与任务副本。公共安装和收件界面使用精确静态资源白名单；知识库/API 的身份和来源校验保持有效。Service Worker 只缓存公共收件界面、图标和离线说明，不缓存编辑器、API 或私有图谱。离线暂存需先在线打开入口，联网后才能生成/保存图谱。

原生 Android / iOS 接收用户主动分享的数据，先写设备私有目录或 App Group。用户点击导入后，在配置的 HTTPS WebView 来源执行 `mobile.js` 交接；等待 IndexedDB 保存并核对记录内容后才清除原生副本。iOS 共享扩展不强制拉起主 App。原生 App 不包含 Node 服务或模型 Key，工作区仍独立部署。

托管模式由 CHATGRAPH_PUBLIC_ORIGIN 启用，需要 HTTPS 根域名和至少 16 字符的 CHATGRAPH_AUTH_PASSWORD。单一拥有者的会话 Cookie 保护工作区，分享令牌只开放对应快照。托管不等于多租户服务，不支持多个 Node 进程写同一目录。MCP OAuth 与此登录独立。
