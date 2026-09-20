import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod/v4';
import { readFile } from 'node:fs/promises';
import { organizeConversation, validateGraph } from '../../lib/conversations.mjs';
import { extractConversation } from '../../lib/ai.mjs';

export const RESOURCE_URI = 'ui://chatgraph/graph-v2.html';
export const SOURCE_NOTICE = '仅整理本次工具参数实际提供的消息；插件不能自动读取 ChatGPT 账号历史或保证当前对话完整。观点归属和判断状态仍需对照原文核对。';
const message = z.object({ id: z.string().min(1).max(128), role: z.enum(['user', 'assistant', 'unknown']), content: z.string().min(1).max(100_000) }).strict();
const conversationInput = z.object({
  title: z.string().min(1).max(240),
  messages: z.array(message).min(1).max(500),
  source_url: z.string().max(4096).optional(),
  source_scope: z.enum(['provided_excerpt', 'user_supplied_export']).default('provided_excerpt'),
}).strict();
const renderInput = z.object({ graph: z.record(z.string(), z.unknown()) }).strict();
const outputSchema = z.object({ graph: z.record(z.string(), z.unknown()), sourceNotice: z.string() });

export function validateCitations(value) {
  const graph = validateGraph(value);
  const roots = graph.nodes.filter(node => node.parentId === null);
  if (roots.length !== 1 || roots[0].type !== 'topic') throw new Error('图谱必须只有一个主题根节点。');
  const byId = new Map(graph.messages.map(item => [item.id, item]));
  for (const node of graph.nodes) {
    if (node.id === roots[0].id) continue;
    if (!node.sourceIds.length) throw new Error(`节点 ${node.id} 缺少原文引用。`);
    const roles = new Set(node.sourceIds.map(id => byId.get(id)?.role));
    if (['confirmed', 'rejected', 'revised'].includes(node.status) && !roles.has('user')) throw new Error('确认、否定或修正必须引用用户原文。');
    if (node.stance === 'user' && !roles.has('user')) throw new Error('用户观点必须引用用户原文。');
    if (node.stance === 'ai' && !roles.has('assistant')) throw new Error('AI 观点必须引用 AI 原文。');
    if (node.stance === 'shared' && (!roles.has('user') || !roles.has('assistant'))) throw new Error('共同观点必须引用双方原文。');
  }
  for (const edge of graph.edges.filter(edge => edge.type === 'revises')) {
    const target = graph.nodes.find(node => node.id === edge.target);
    if (!['revised', 'rejected'].includes(target.status)) throw new Error('revises 指向的旧观点必须标记 revised 或 rejected。');
  }
  return graph;
}

export function createToolKit({ env = process.env, analyze = extractConversation, auth = false } = {}) {
  const aiEnabled = env.CHATGRAPH_MCP_ENABLE_AI === '1';
  const securitySchemes = auth ? [{ type: 'oauth2', scopes: ['chatgraph:use'] }] : [{ type: 'noauth' }];
  const entries = [
    {
      name: 'organize_conversation', title: '按原文整理对话', schema: conversationInput,
      description: '将用户明确提供的原始对话按角色与顺序整理为可溯源图谱；不调用外部模型、不推测观点是否被采纳。不具备读取当前聊天或账号历史的权限。只传实际可见且获用户要求处理的原话，保留角色和 ID，范围不完整时说明。随后调用 render_conversation_graph 展示结果。',
      openWorldHint: false,
      async run(args) {
        if (args.messages.length > 199) throw new Error('原文整理最多支持 199 条消息，请选择较短片段。');
        const graph = organizeConversation({ text: JSON.stringify({ messages: args.messages }), title: args.title, platform: 'ChatGPT 插件 · 用户提供内容', url: args.source_url || '' });
        graph.source.complete = args.source_scope === 'user_supplied_export' ? 'provided' : 'partial';
        return graph;
      },
    },
    {
      name: 'render_conversation_graph', title: '展示对话知识图谱', schema: renderInput,
      description: '以可折叠大纲和可点击原文显示 ChatGraph 图谱。优先传 organize_conversation 或 analyze_conversation 的完整 graph。若整理观点，应保留原始 messages 和真实 sourceIds，区分用户判断、AI 建议及待确认项；不得把 AI 建议标为用户采纳。只渲染工具参数，不保存或发布。',
      openWorldHint: false, ui: true,
      async run(args) { return validateCitations(args.graph); },
    },
  ];
  if (aiEnabled) entries.splice(1, 0, {
    name: 'analyze_conversation', title: 'AI 提取观点与判断变化', schema: conversationInput,
    description: '在用户明确要求 AI 整理时，将本次提供的对话发送给部署者配置的模型服务提取观点、归属、修正与原文引用，可能产生模型费用。此工具不读取账号聊天历史，不保存图谱。不向参数传递任何 API Key。随后调用 render_conversation_graph 展示 graph。',
    openWorldHint: true,
    async run(args, context) {
      return analyze({ text: JSON.stringify({ messages: args.messages }), title: args.title, platform: 'ChatGPT 插件 · 用户提供内容', url: args.source_url || '', complete: args.source_scope === 'user_supplied_export' ? 'provided' : 'partial' }, { env, signal: context.signal });
    },
  });
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  const tools = entries.map(entry => ({
    name: entry.name, title: entry.title, description: entry.description,
    inputSchema: z.toJSONSchema(entry.schema), outputSchema: z.toJSONSchema(outputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: entry.openWorldHint },
    securitySchemes,
    _meta: { securitySchemes, ...(entry.ui ? { ui: { resourceUri: RESOURCE_URI, visibility: ['model', 'app'] } } : {}) },
  }));
  async function call(name, args, context = {}) {
    const entry = byName.get(name);
    if (!entry) return { isError: true, content: [{ type: 'text', text: '未知工具。请先读取 tools/list。' }] };
    try {
      if (context.signal?.aborted) throw new Error('整理已取消。');
      if (Buffer.byteLength(JSON.stringify(args ?? {})) > 2_000_000) throw new Error('输入超过 2 MB，请分段处理。');
      const parsed = entry.schema.parse(args);
      const graph = await entry.run(parsed, context);
      if (context.signal?.aborted) throw new Error('整理已取消。');
      const sourceNotice = `${SOURCE_NOTICE}${parsed.source_scope === 'user_supplied_export' ? ' 本次范围声明为用户提供的导出文件，服务端未核验账号完整历史。' : ''}`;
      return { content: [{ type: 'text', text: `${graph.title}：${graph.nodes.length} 个节点、${graph.messages.length} 条原文。${sourceNotice}` }], structuredContent: { graph, sourceNotice } };
    } catch (error) {
      const text = error instanceof z.ZodError ? '工具参数不符合格式。请检查消息 ID、发言角色、文字长度，以及是否只传入所声明的字段。' : error.message;
      return { isError: true, content: [{ type: 'text', text: text || '处理失败。请检查输入后重试。' }] };
    }
  }
  return { tools, call };
}

export async function createChatGraphMcp(options = {}) {
  const kit = createToolKit(options);
  const html = await readFile(new URL('./widget.html', import.meta.url), 'utf8');
  const server = new Server({ name: 'chatgraph', version: '0.2.0' }, {
    capabilities: { tools: {}, resources: {} },
    instructions: 'ChatGraph 只处理工具参数提供的消息，不能读取用户完整聊天历史。不得把重述内容冒充逐字原文。说明本次来源范围，保留角色与引用。先 organize_conversation（原文）或 analyze_conversation（外部模型），再 render_conversation_graph。输出不等于保存或发布。',
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: kit.tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => kit.call(request.params.name, request.params.arguments, { signal: extra.signal }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: RESOURCE_URI, name: 'ChatGraph 交互图谱', mimeType: RESOURCE_MIME_TYPE }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== RESOURCE_URI) throw new Error('资源不存在。');
    return { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } } } }] };
  });
  return server;
}
