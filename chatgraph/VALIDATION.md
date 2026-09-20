# ChatGraph 验证记录

日期：2026-09-20。上游基线：`72c750bb070d95171dbb2244e5b62b1b7da69c12`。以下区分代码回归、真实模型、浏览器模拟与外部尚未完成的验收。

## 0.2.0-beta.2 品牌更新

统一产品介绍、演示图谱和导出页的 ChatGraph 品牌。开源署名保留于技术说明、许可证及导出页折叠说明。10 项服务端/发布包回归与 10 组现有浏览器场景通过，首页截图已更新。以下完整功能验证最初完成于 0.2.0-beta.1。

## 核心回归

`node --test chatgraph/test/*.test.mjs`：54 项通过，0 失败，0 跳过。

覆盖当前会话分支/角色解析、节点及来源校验、DeepSeek V4 Pro max 请求参数、限流重试、结构修复、长消息分段合并、取消、用量记录、密钥隔离、后台任务、并发队列上限、父子关系/排序、多窗口 revision 冲突、历史恢复、损坏原文件保留、备份副本恢复、追加引用完整性、语义结果 ID 验证、分享内容剥离、登录会话、PPTX XML/分页/原文备注、可复现打包和解压后启动。

`node scripts/generate-viewer.mjs --check` 与 `git diff --check` 通过。上游渲染器、schema 和阅读器源代码未修改，因此没有重新生成上游产物或把上游全套测试冒充本次新增功能证据。

## 浏览器

`npm run test:browser --prefix chatgraph`：原有 10 组与新增 14 组 Chromium 场景，合计 24 组通过，无页面 JavaScript 错误。使用独立临时服务器、临时数据目录、明确的模拟模型响应，不消耗用户模型额度。

原有场景覆盖桌面图谱、折叠恢复、原文与大纲、节点编辑/拖动/删除/撤销、保存刷新、四种原有导出、输入设置、手机布局以及独立 Archify HTML 的坐标与来源。新增场景覆盖自动保存与重做、父级/权重/批量编辑、轨迹、未失焦输入的草稿恢复、追加会话、历史/搜索/备份/分享、扩展交接、AI 检索/关系建议确认、真实 409 冲突处理、任务 ID 返回前取消、多窗口草稿隔离、导入弹窗聚焦，以及后台任务运行期间刷新后的原文恢复和同一 UUID 续接；续接验证模型仅调用一次。

扩展/组件：`node chatgraph/integrations/browser-check.mjs` 为 6 组 DOM 样本及模拟 MCP 宿主浏览器检查。没有在用户登录的真实 ChatGPT/DeepSeek 网页读取完整历史，也没有把模拟宿主称为已经上架的 ChatGPT App。

主要截图保存在忽略的 `test-output/workspace.png`、`mobile.png`、`reasoning-timeline.png`、`extension-preview.png`、`mcp-widget.png`、`archify-export.png`。公开 README 仅使用明确标注的虚构样例截图。

## 真实 DeepSeek API

官方 `/models` 实际返回 `deepseek-flash` 和 `deepseek-v4-pro`。本机已选 `deepseek-v4-pro`，启用 thinking 和 `reasoning_effort:max`。依据：[模型文档](https://api-docs.deepseek.com/quick_start/pricing)、[思考档位](https://api-docs.deepseek.com/guides/thinking_mode)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode)。

本次产品讨论的文字节选真实生成 10 个节点，耗时约 67 秒，调用收据为 1,004 输入 token、5,687 输出 token。该私人图谱只保存本机，不进入开源代码、发布包或 CI。

最终受控虚构样本结果：

| 样本 | 覆盖 | 结果 | 调用记录 |
|---|---|---|---|
| 优先级反转 | 最终导图决定、旧 PPT 优先级修正、拒绝协作、收费未决、接受试用 | 5 个限定检查通过 | 强制分为 3 段并合并，4 次调用，约 193 秒，4,264 输入 / 15,747 输出 token |
| 假设与注入文本 | 不把价格假设当事实、明确接受访谈、拒绝试卖 | 3 个限定检查通过 | 2 次调用（含一次结构修复），约 151 秒，1,608 输入 / 11,541 输出 token |

还实测了 AI 关联检索与跨对话修正建议，返回的节点和两端原文 ID 均实际存在；关系建议不会自动修改节点。输出 JSON 不稳定时最多修复一次。

这些是小规模、可复现的开发评估，不能推导总体准确率、优于原生总结的比例、留存或付费意愿。`scripts/evaluate-model.mjs --live --force-chunk` 可再次验证，但结果非确定且会产生模型费用。原始用量收据在本机 `test-output/model-evaluation/report.json`，不含密钥或模型私有推理。

## 可选 MCP 与扩展

MCP/OAuth 测试 7 项通过，覆盖官方 SDK HTTP 初始化、工具/资源、引用规则、输入范围、身份签名/过期/权限、会话隔离，以及 SDK 客户端真实取消传播。扩展另有 2 项适配器单元检查。`npm audit --omit=dev` 检查时 0 个已知漏洞；这不构成安全认证。

参考文档、安装命令与账号/HTTPS 前提见 `integrations/README.md`。

## PowerPoint 与部署

可编辑 PPTX 的 25 页演示经过 LibreOffice 渲染与逐页检查，结构及几何检查无问题。完整原文位于来源索引页备注，节点页备注含引用页码。产物在本机 `test-output/pptx/sample-final.pptx` 与对应 PDF/PNG。验证使用独立临时字体配置解决本机 LibreOffice 缺少系统字体路径的问题，没有更改用户全局配置；其他电脑的字体回退仍取决于安装字体。

Docker 镜像成功构建。本机容器验证：未登录 API 返回 401，登录后可读配置并保存数据，非 root 用户可写持久目录，镜像不含私密 `.env`。此验证未配置实际公网域名，也未申请线上 TLS 证书。

## 尚需外部验收

- 在真实登录的 ChatGPT/DeepSeek 页面测试采集范围和动态站点适配。
- 配置公网服务器/域名和 OAuth 身份提供商，在实际 ChatGPT 账号启用并完成平台审核。
- 执行 `research/README.md` 的真实用户对照与一周复用测试，未联系或虚构测试用户。
- 产品当前为单一拥有者工作区；团队多租户和实时共同编辑、附件理解、完整账号多会话选择器不在此测试版中。
