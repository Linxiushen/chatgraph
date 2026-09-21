# ChatGraph · 对话图谱

把 AI 对话变成可编辑、可追溯原文、可继续积累的个人知识图谱。

![ChatGraph 工作区演示](chatgraph/docs/workspace.png)

**0.4.0-beta.1** 新增可安装的手机 PWA、Android 兼容浏览器的系统分享接收、手机粘贴/文件收件箱和 iPhone Safari 快捷指令采集。已有 DeepSeek V4 Pro 结构化、账号导出预览、观点归属与变化、思维导图编辑、自动保存与历史恢复、追加对话、AI 关联检索、五种导出、浏览器扩展和可选 ChatGPT MCP 组件。

手机从已部署的 HTTPS 工作区的 `/mobile-inbox.html` 进入。电脑 `localhost` 不能直接供手机访问；本版是 PWA 与采集脚本，不是已上架的原生 App，也不读取其他 App 的私有聊天记录。见 [手机接入说明](chatgraph/docs/mobile-platforms.md)。

## 本地运行

需要 Node.js 20+，核心程序无需安装 npm 依赖。

```sh
node chatgraph/server.mjs
```

打开 http://127.0.0.1:4317 。复制 `chatgraph/.env.example` 为 `chatgraph/.env` 后填写自己的模型 Key。未配置模型仍可使用原文整理和编辑。截图内容为明确标注的虚构演示，不是用户真实数据。

- [完整使用说明](chatgraph/README.md)
- [浏览器扩展与 ChatGPT 集成](chatgraph/integrations/README.md)
- [Docker / HTTPS 部署](chatgraph/deploy/README.md)
- [发布包与 PowerPoint 导出](chatgraph/RELEASE.md)
- [验证记录与实际限制](chatgraph/VALIDATION.md)
- [产品设计](chatgraph/PRODUCT.md) · [接口契约](chatgraph/CONTRACT.md)

这是个人工作区测试版。ChatGPT 账号中的实际启用、平台商店审核、外网部署和真实用户研究须分别完成。模型结果仍应核对原文。

## 开源与许可

ChatGraph 使用 MIT 许可证。第三方来源、原始版权声明与复用范围见以下说明。

[上游与技术说明](chatgraph/UPSTREAM.md) · [MIT 许可证](chatgraph/LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)
