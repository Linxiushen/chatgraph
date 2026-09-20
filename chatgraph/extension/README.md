# ChatGraph 对话采集扩展

这是可加载的 Chromium Manifest V3 扩展，支持在 ChatGPT / DeepSeek 对话页及采用同样消息结构的公开分享页中，预览并导出当前页面已加载的文字对话。

## 安装和使用

1. 启动本机 ChatGraph：在仓库根目录运行 `node chatgraph/server.mjs`。
2. Chrome 打开 `chrome://extensions`（Edge 使用 `edge://extensions`），打开开发者模式。
3. 选择「加载已解压的扩展程序」，选中此 `chatgraph/extension` 文件夹；若使用 ZIP，先解压到一个文件夹。
4. 在 ChatGPT 或 DeepSeek 中打开具体对话，向上滚动加载需要的历史内容，等待回答结束。
5. 点击扩展 →「采集当前对话」，核对首尾消息、轮数与发言角色。可以修改角色、取消选择不需要的消息。
6. 「发送到本机 ChatGraph」会请求本机页面权限，并在 `http://127.0.0.1:4317/` 打开导入预览。接下来由你选择原文整理或 AI 整理。也可以复制 JSON 或下载 JSON 后导入。

扩展没有在 Chrome / Edge 商店发布。加载扩展需要用户操作浏览器的开发者模式。

## 实际采集边界

- 仅用户点击时读取当前标签页的渲染 DOM，不读取 Cookie、登录令牌、浏览器其他标签页或平台内部 API。
- ChatGPT 优先使用 `data-message-author-role` 等语义属性识别角色，保留页面消息顺序。
- DeepSeek 同时保留 `.ds-message` 等消息容器。没有可靠角色属性的消息显示为「未确认角色」，不按奇偶轮次、左右位置或 Markdown 样式猜测。
- 只采集当前页面已经加载且非隐藏的分支；不声称完整账号历史、其他分支或滚动前尚未加载的内容已经获取。
- 不采集隐藏思考过程、图片/音频/附件正文。检测到媒体或正在生成的回答时会提示。
- 页面更新可能使选择器失效。识别不到消息时明确报错；可复制带角色的文字或使用平台导出文件继续。
- 500 条消息与约 2 MB 的边界会明确报错，不会默默截断。
- 当前已验证静态平台 DOM 样本、弹窗预览及 JSON 下载，尚未在真实登录的 ChatGPT / DeepSeek 会话里端到端验收。因此不承诺兼容平台所有当前页面版本。

## 权限和数据

默认仅请求 `activeTab`、`scripting` 和 `clipboardWrite`，没有全站常驻访问权。「发送到本机」才请求 `http://127.0.0.1/*` 的可选权限。该权限用于把预览资料送到用户启动的 ChatGraph 页面，不用于访问模型服务。

采集内容只留在弹窗内存，关闭弹窗后不恢复；扩展不保存 API Key、不调用模型、不上传对话到开发者服务器。下载文件或复制到剪贴板是用户主动操作。调用 AI 整理由 ChatGraph 主程序的模型设置控制。

导出格式：

```json
{
  "schema": "chatgraph.conversation.v1",
  "title": "对话标题",
  "platform": "ChatGPT",
  "url": "https://chatgpt.com/c/…",
  "messages": [{ "id": "capture-1", "role": "user", "content": "原文" }],
  "capture": {
    "scope": "rendered-current-branch",
    "complete": "unknown",
    "capturedAt": "ISO 时间",
    "messageCount": 1,
    "warnings": ["本次导入范围说明"]
  }
}
```

## 本机交接协议

扩展在本机页面加载后发送同窗口、同源消息：

```js
window.postMessage({
  type: 'chatgraph:import', version: 1, requestId,
  capture: { title, platform, url, messages, capture: { scope, complete, warnings } }
}, location.origin);
```

主程序只打开预览，不自动调用模型或保存，返回 `chatgraph:import:ack`，并回传相同的 `requestId` 和 `ok`。7 秒内没有确认时，弹窗显示复制/下载备用路径。

## 验证与打包

在仓库根目录：

```sh
node --test chatgraph/extension/test/*.test.mjs
node chatgraph/extension/package.mjs
```

打包脚本需要系统 `zip`，输出在 `chatgraph/test-output/chatgraph-extension-0.2.0.zip`。只包含运行文件、此说明和 MIT 许可证，不包含对话、测试输出、模型密钥或依赖。

浏览器 DOM 和弹窗验证参见 `chatgraph/integrations/browser-check.mjs`。
