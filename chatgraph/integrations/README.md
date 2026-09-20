# ChatGraph 平台接入

当前提供两个独立入口，都复用主程序的对话/图谱格式：

| 入口 | 已完成 | 尚需外部环境验收 |
| --- | --- | --- |
| 浏览器扩展 | ChatGPT / DeepSeek DOM 采集、角色和范围预览、JSON 下载、本机导入交接 | 用户加载扩展；真实登录页面与平台变更兼容性；扩展商店发布 |
| ChatGPT MCP + MCP Apps UI | Streamable HTTP / stdio、原文整理、可选模型整理、交互大纲、来源查看、完整 JSON 导出；OAuth 资源服务验签和发现 | ChatGPT 账号中的实际连接、真实宿主上下文范围、身份提供商登录流程、稳定 HTTPS 域名、审核/上架 |

公开分享链接采用浏览器路径：打开用户提供的链接，在可见分享页中采集。没有实现服务器凭借 URL 读取登录态或自动抓取任意网页；不要求用户把私人会话改成公开链接。本入口的完整性仍取决于页面已加载范围。

安装扩展见 [`../extension/README.md`](../extension/README.md)。官方接入和部署见 [`chatgpt/README.md`](chatgpt/README.md)。

## 自动验证

在仓库根目录：

```sh
node --test chatgraph/extension/test/*.test.mjs
npm --prefix chatgraph/integrations/chatgpt ci --ignore-scripts
npm --prefix chatgraph/integrations/chatgpt test
```

可选真实 Chromium 检查（需要预先安装 Playwright）：

```sh
node chatgraph/integrations/browser-check.mjs
```

如果 Playwright 位于独立开发环境，可用 `CHATGRAPH_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs` 指定。浏览器脚本覆盖消息角色/顺序、隐藏内容、混合角色标记、错误页面、数量边界、弹窗选择/角色修改与实际下载、MCP Apps 初始化/原文查看/折叠/宿主下载协议。结果和截图输出到 `chatgraph/test-output/`。

本轮 2 项扩展单元测试、7 项 MCP/OAuth 测试、6 组 Chromium 场景均通过。MCP 测试包含客户端取消向模型请求传播、会话隔离与身份绑定。Chromium 场景使用平台 DOM 样本、模拟 Chrome 传输接口和模拟 MCP Apps 宿主；它们不代表已通过真实 ChatGPT / DeepSeek 登录环境验收。
