import { randomUUID } from 'node:crypto';

const LIMIT = { input: 2_000_000, messages: 500, message: 100_000, nodes: 200, edges: 3_000 };
const ROLES = ['user', 'assistant', 'unknown'];
const TYPES = ['topic', 'claim', 'evidence', 'question', 'action'];
const STANCES = ['user', 'ai', 'shared', 'unknown'];
const STATUSES = ['confirmed', 'proposed', 'rejected', 'revised', 'open'];
const RELATIONS = ['contains', 'supports', 'challenges', 'revises', 'depends'];
const ROLE_LABELS = { user: '用户', assistant: 'AI', unknown: '未标明角色' };
const STATUS_LABELS = { confirmed: '已确认', proposed: '建议', rejected: '已否定', revised: '已修正', open: '待确认' };
const TYPE_LABELS = { topic: '主题', claim: '观点', evidence: '依据', question: '问题', action: '行动' };
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function fail(message) { throw new Error(message); }
function record(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${where} 必须是对象。`);
  return value;
}
function string(value, where, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') fail(`${where} 必须是文字。`);
  if (value.length > max) fail(`${where} 超过 ${max.toLocaleString('en-US')} 字符，请缩短内容。`);
  return value;
}
function identifier(value, where) {
  if (typeof value !== 'string' || !ID.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) fail(`${where} 无效；请使用 1–128 个英文字母、数字、短横线、下划线、点或冒号。`);
  return value;
}
function enumeration(value, values, where) {
  if (!values.includes(value)) fail(`${where} 必须是 ${values.join(' / ')} 之一。`);
  return value;
}
function array(value, where, max) {
  if (!Array.isArray(value)) fail(`${where} 必须是数组。`);
  if (value.length > max) fail(`${where} 最多支持 ${max} 项，请分段导入。`);
  return value;
}
function unique(items, where) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${where} ID 重复：${item.id}。`);
    seen.add(item.id);
  }
  return seen;
}
function role(value) {
  const normalized = String(value || '').toLowerCase();
  if (['user', 'human', '用户', '我', '人类'].includes(normalized)) return 'user';
  if (['assistant', 'ai', 'chatgpt', 'deepseek', 'claude', 'gemini', '助手', '模型', '回答'].includes(normalized)) return 'assistant';
  return 'unknown';
}
function textContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => typeof part === 'string' ? part : part?.type === 'text' || part?.type === 'input_text' || part?.type === 'output_text' ? String(part.text || '') : '').filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.parts)) return textContent(value.parts);
  }
  return '';
}
function normalizeMessages(raw) {
  if (raw.length > LIMIT.messages) fail(`一次最多导入 ${LIMIT.messages} 条文字消息，请选择较短的对话。`);
  const messages = [];
  const ids = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') fail('消息必须是包含 role 和 content 的对象。');
    const originalRole = entry.role ?? entry.author?.role;
    if (['system', 'tool', 'developer', 'function'].includes(String(originalRole).toLowerCase())) continue;
    const content = textContent(entry.content);
    if (!content.trim()) continue;
    string(content, '单条消息', LIMIT.message);
    const requestedId = entry.id;
    let id = typeof requestedId === 'string' && ID.test(requestedId) && !['__proto__', 'prototype', 'constructor'].includes(requestedId) ? requestedId : `m-${messages.length + 1}`;
    if (ids.has(id)) fail(`消息 ID 重复：${id}，请检查导出文件。`);
    ids.add(id);
    messages.push({ id, role: role(originalRole), content });
  }
  if (!messages.length) fail('没有找到可导入的文字消息。当前版本只读取文字，不解析图片、音频或附件。');
  return messages;
}
function fromMapping(conversation) {
  const mapping = record(conversation.mapping, 'ChatGPT mapping');
  if (typeof conversation.current_node !== 'string' || !conversation.current_node) fail('ChatGPT 导出缺少 current_node，无法确定当前对话分支。请导出单个会话，或复制当前分支的文字。');
  const chain = [];
  const visited = new Set();
  let cursor = conversation.current_node;
  while (cursor !== null && cursor !== undefined) {
    if (typeof cursor !== 'string' || visited.has(cursor)) fail('ChatGPT 对话分支存在循环或无效节点，请重新导出。');
    visited.add(cursor);
    const node = mapping[cursor];
    if (!node || typeof node !== 'object') fail(`ChatGPT 当前分支缺少节点 ${cursor}，请导入完整的单个会话文件。`);
    if (node.message) chain.push({ ...node.message, id: node.message.id || cursor });
    cursor = node.parent;
    if (visited.size > 2_000) fail('ChatGPT 分支过长，请选择部分对话导入。');
  }
  return normalizeMessages(chain.reverse());
}
function fromJson(value) {
  if (Array.isArray(value)) {
    if (value.every(item => item && typeof item === 'object' && ('role' in item || 'author' in item) && 'content' in item)) return normalizeMessages(value);
    if (value.length !== 1) fail('此文件包含多个会话。请先选择并导出一个会话；为避免遗漏，不会自动选择第一段。');
    return fromJson(value[0]);
  }
  record(value, '导入的 JSON');
  if (value.mapping) return fromMapping(value);
  if (Array.isArray(value.messages)) return normalizeMessages(value.messages);
  if (Array.isArray(value.conversations)) return fromJson(value.conversations);
  fail('不支持这个 JSON 结构。请提供单个 ChatGPT mapping 会话，或 { "messages": [{ "role": "user", "content": "…" }] }。');
}

/** Parse only the supplied text/current ChatGPT branch; never infer a speaker. */
export function parseConversation(text) {
  string(text, '对话内容', LIMIT.input);
  if (!text.trim()) fail('请粘贴对话内容，或选择文字 / JSON 文件。');
  const withoutBom = text.replace(/^\uFEFF/, '');
  const trimmed = withoutBom.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value;
    try { value = JSON.parse(trimmed); } catch { fail('JSON 格式不完整或有语法错误。请使用完整导出文件，或以普通对话文字导入。'); }
    return fromJson(value);
  }
  const lines = withoutBom.split(/\r?\n/);
  const raw = [];
  let current = { role: 'unknown', lines: [] };
  let fence = null;
  let hasRoleLabel = false;
  // Explicit role labels only. A Markdown heading without a colon is also a label.
  const roleNames = 'user|human|assistant|ai|chatgpt|deepseek|claude|gemini|用户|人类|我|助手|模型';
  const colon = new RegExp(`^\\s*(?:#{1,6}\\s+)?(?:\\*\\*)?(${roleNames})(?:\\*\\*)?\\s*[:：](?:\\*\\*)?\\s?(.*)$`, 'i');
  const heading = new RegExp(`^\\s*(?:#{1,6}\\s+|\\*\\*)(${roleNames})(?:\\*\\*)?\\s*$`, 'i');
  function flush() {
    const content = current.lines.join('\n');
    if (content.trim()) raw.push({ role: current.role, content });
  }
  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const mark = fenceMatch[1];
      if (!fence) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      current.lines.push(line);
      continue;
    }
    const match = !fence && (line.match(colon) || line.match(heading));
    if (match) {
      hasRoleLabel = true;
      flush();
      current = { role: role(match[1]), lines: match[2] ? [match[2]] : [] };
    } else current.lines.push(line);
  }
  flush();
  if (!hasRoleLabel) return normalizeMessages([{ role: 'unknown', content: withoutBom }]);
  return normalizeMessages(raw);
}

function excerpt(value, length) {
  const chars = Array.from(value);
  return chars.length > length ? `${chars.slice(0, length).join('')}…` : value;
}
function sourceUrl(value) {
  const result = string(value, '来源链接', 4_096, '').trim();
  if (!result) return '';
  let parsed;
  try { parsed = new URL(result); } catch { fail('来源链接必须是完整的 http:// 或 https:// 链接；也可以留空。'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('来源链接仅支持 http:// 或 https://。');
  return result;
}

function cleanSource(value) {
  const source = record(value, '来源');
  return { platform: string(source.platform, '来源平台', 100, ''), url: sourceUrl(source.url), complete: enumeration(source.complete, ['unknown', 'provided', 'partial'], '导入范围状态') };
}

function integer(value, name, min, max, fallback) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < min || result > max) fail(`${name} 必须是 ${min}–${max} 的整数。`);
  return result;
}

function cleanAnalysis(value, timestamp) {
  const analysis = record(value, '模型调用记录');
  return {
    model: string(analysis.model, '模型名称', 200),
    generatedAt: timestamp(analysis.generatedAt, '生成时间'),
    durationMs: integer(analysis.durationMs, '生成耗时', 0, Number.MAX_SAFE_INTEGER, 0),
    inputTokens: integer(analysis.inputTokens, '输入 token 数', 0, Number.MAX_SAFE_INTEGER, 0),
    outputTokens: integer(analysis.outputTokens, '输出 token 数', 0, Number.MAX_SAFE_INTEGER, 0),
    calls: integer(analysis.calls, '模型调用次数', 1, 10_000, 1),
    chunkCount: integer(analysis.chunkCount, '对话分段数', 1, 500, 1),
    warnings: array(analysis.warnings ?? [], '分析提示', 100).map(value => string(value, '分析提示', 1_000)),
  };
}

export function organizeConversation({ text, title, platform, url } = {}) {
  const messages = parseConversation(text);
  if (messages.length >= LIMIT.nodes) fail('原文组织一次最多展示 199 条消息，请选择一段对话或拆分导入；不会自动省略其余消息。');
  const now = new Date().toISOString();
  const graphTitle = typeof title === 'string' && title.trim() ? title.trim() : '未命名对话';
  const nodes = [{ id: 'root', label: graphTitle, summary: '以下内容按发言顺序展示原文片段，尚未进行 AI 语义分析。', type: 'topic', stance: 'unknown', status: 'open', sourceIds: [], parentId: null, note: '' }];
  const edges = [];
  for (const [index, message] of messages.entries()) {
    const id = `excerpt-${index + 1}`;
    const firstLine = message.content.split('\n').find(line => line.trim()) || message.content;
    nodes.push({ id, label: excerpt(firstLine.trim(), 54), summary: excerpt(message.content, 640), type: 'claim', stance: message.role === 'assistant' ? 'ai' : message.role === 'user' ? 'user' : 'unknown', status: 'open', sourceIds: [message.id], parentId: 'root', note: '原文组织模式：标签最多展示 54 字，预览最多展示 640 字；完整正文保留在来源消息。这里只按发言角色标注，未判断观点是否被采纳或否定。' });
    edges.push({ id: `contains-${index + 1}`, source: 'root', target: id, type: 'contains', label: '原文片段' });
  }
  return validateGraph({ id: `graph-${randomUUID()}`, title: graphTitle, description: '原文组织 · 未调用 AI。按发言顺序保留内容；节点预览可截断，完整正文可追溯。导入范围仅限所提供的文字。', createdAt: now, updatedAt: now, mode: 'outline', source: { platform: platform || '粘贴导入', url: sourceUrl(url), complete: 'unknown' }, messages, nodes, edges });
}

/** Return a detached, allowlisted data object. Graph text is never interpreted. */
export function validateGraph(value) {
  const input = record(value, '图谱');
  if (input.schemaVersion !== undefined && ![1, 2].includes(input.schemaVersion)) fail('此图谱使用尚不支持的数据版本，请更新 ChatGraph 后再打开。');
  const now = new Date().toISOString();
  const timestamp = (value, name) => {
    const text = string(value, name, 64, now);
    if (!Number.isFinite(Date.parse(text))) fail(`${name} 不是有效日期。`);
    return text;
  };
  const graph = {
    schemaVersion: 2,
    revision: integer(input.revision, '保存版本', 0, Number.MAX_SAFE_INTEGER, 0),
    id: identifier(input.id, '图谱 ID'),
    title: string(input.title, '图谱标题', 240),
    description: string(input.description, '图谱描述', 5_000, ''),
    createdAt: timestamp(input.createdAt, '创建时间'),
    updatedAt: timestamp(input.updatedAt, '更新时间'),
    mode: enumeration(input.mode, ['demo', 'outline', 'ai'], '图谱模式'),
    source: cleanSource(input.source),
    messages: array(input.messages, '原文消息', LIMIT.messages).map((item, index) => {
      const message = record(item, `消息 ${index + 1}`);
      return { id: identifier(message.id, '消息 ID'), role: enumeration(message.role, ROLES, '消息角色'), content: string(message.content, '消息正文', LIMIT.message) };
    }),
    nodes: [], edges: [],
  };
  if (!graph.title.trim()) fail('图谱标题不能为空。');
  if (graph.messages.reduce((sum, message) => sum + message.content.length, 0) > LIMIT.input) fail('原文总长度超过 2,000,000 字符，请拆分图谱。');
  const messageIds = unique(graph.messages, '消息');
  graph.nodes = array(input.nodes, '节点', LIMIT.nodes).map((item, index) => {
    const node = record(item, `节点 ${index + 1}`);
    const clean = {
      id: identifier(node.id, '节点 ID'),
      label: string(node.label, '节点标题', 500),
      summary: string(node.summary, '节点摘要', 10_000, ''),
      type: enumeration(node.type, TYPES, '节点类型'),
      stance: enumeration(node.stance, STANCES, '观点归属'),
      status: enumeration(node.status, STATUSES, '节点状态'),
      sourceIds: array(node.sourceIds, '节点原文引用', LIMIT.messages).map(id => identifier(id, '原文引用 ID')),
      parentId: node.parentId === null || node.parentId === undefined ? null : identifier(node.parentId, '父节点 ID'),
      note: string(node.note, '节点备注', 10_000, ''),
      importance: integer(node.importance, '节点重要程度', 1, 5, 3),
    };
    if (!clean.label.trim()) fail(`节点 ${clean.id} 的标题不能为空。`);
    if (new Set(clean.sourceIds).size !== clean.sourceIds.length) fail(`节点 ${clean.id} 有重复的原文引用。`);
    for (const id of clean.sourceIds) if (!messageIds.has(id)) fail(`节点 ${clean.id} 引用了不存在的原文 ${id}。`);
    for (const axis of ['x', 'y']) if (node[axis] !== undefined) {
      if (typeof node[axis] !== 'number' || !Number.isFinite(node[axis]) || Math.abs(node[axis]) > 1_000_000) fail(`节点 ${clean.id} 的 ${axis} 坐标无效。`);
      clean[axis] = node[axis];
    }
    return clean;
  });
  if (!graph.nodes.length) fail('图谱至少需要一个节点。');
  const nodeIds = unique(graph.nodes, '节点');
  const parent = new Map(graph.nodes.map(node => [node.id, node.parentId]));
  for (const node of graph.nodes) {
    if (node.parentId !== null && !nodeIds.has(node.parentId)) fail(`节点 ${node.id} 的父节点 ${node.parentId} 已不存在，请重新选择父节点。`);
    const visited = new Set([node.id]);
    let cursor = node.parentId;
    while (cursor !== null) {
      if (visited.has(cursor)) fail(`节点 ${node.id} 的父子关系形成循环，请移除循环关系。`);
      visited.add(cursor);
      cursor = parent.get(cursor) ?? null;
    }
  }
  graph.edges = array(input.edges, '关系', LIMIT.edges).map((item, index) => {
    const edge = record(item, `关系 ${index + 1}`);
    const clean = { id: identifier(edge.id, '关系 ID'), source: identifier(edge.source, '关系起点'), target: identifier(edge.target, '关系终点'), type: enumeration(edge.type, RELATIONS, '关系类型'), label: string(edge.label, '关系标签', 500, '') };
    if (!nodeIds.has(clean.source) || !nodeIds.has(clean.target)) fail(`关系 ${clean.id} 连接了已不存在的节点，请删除或重新连接该关系。`);
    if (clean.source === clean.target) fail(`关系 ${clean.id} 不能连接节点自身。`);
    return clean;
  });
  unique(graph.edges, '关系');
  if (input.sessions !== undefined) {
    graph.sessions = array(input.sessions, '对话批次', 500).map((item, index) => {
      const session = record(item, `对话批次 ${index + 1}`);
      const clean = {
        id: identifier(session.id, '对话批次 ID'),
        title: string(session.title, '对话批次标题', 240),
        createdAt: timestamp(session.createdAt, '对话批次时间'),
        mode: enumeration(session.mode, ['demo', 'outline', 'ai'], '对话批次模式'),
        source: cleanSource(session.source),
        messageIds: array(session.messageIds, '批次原文引用', LIMIT.messages).map(id => identifier(id, '批次原文 ID')),
        nodeIds: array(session.nodeIds, '批次节点引用', LIMIT.nodes).map(id => identifier(id, '批次节点 ID')),
      };
      if (session.sourceGraphId !== undefined) clean.sourceGraphId = identifier(session.sourceGraphId, '原图谱 ID');
      if (session.analysis !== undefined) clean.analysis = cleanAnalysis(session.analysis, timestamp);
      if (new Set(clean.messageIds).size !== clean.messageIds.length || new Set(clean.nodeIds).size !== clean.nodeIds.length) fail(`对话批次 ${clean.id} 含有重复引用。`);
      for (const id of clean.messageIds) if (!messageIds.has(id)) fail(`对话批次 ${clean.id} 引用了不存在的原文 ${id}。`);
      for (const id of clean.nodeIds) if (!nodeIds.has(id)) fail(`对话批次 ${clean.id} 引用了不存在的节点 ${id}。`);
      return clean;
    });
    unique(graph.sessions, '对话批次');
  }
  if (input.analysis !== undefined) graph.analysis = cleanAnalysis(input.analysis, timestamp);
  return graph;
}

function markdownText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/([\\`*_{}[\]()#+.!|])/g, '\\$1');
}
function codeBlock(content) {
  const runs = content.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${fence}text\n${content}\n${fence}`;
}

export function toMarkdown(value) {
  const graph = validateGraph(value);
  const references = new Map(graph.messages.map((message, index) => [message.id, `source-${index + 1}`]));
  const modeLabel = { demo: '演示样例（虚构对话，用于说明产品）', outline: '原文组织（未进行 AI 语义分析）', ai: 'AI 结构化（请核查原文）' }[graph.mode];
  const lines = [`# ${markdownText(graph.title)}`, '', `> ${modeLabel}`, '', markdownText(graph.description), '', `来源平台：${markdownText(graph.source.platform || '未注明')}`, `导入范围：${graph.source.complete === 'provided' ? '所提供的内容' : graph.source.complete === 'partial' ? '已知为部分对话' : '完整性未确认，仅包含所提供内容'}`, ...(graph.source.url ? [`来源链接：${markdownText(graph.source.url)}`] : []), ''];
  if (graph.sessions?.length) {
    lines.push('## 对话批次', '', '以下批次保留各次导入的来源；追加导入不会自动推断观点被接受、否定或修正。', '');
    for (const session of graph.sessions) lines.push(`- ${markdownText(session.title)} · ${markdownText(session.createdAt)} · ${markdownText(session.source.platform || '未注明平台')} · ${session.messageIds.length} 条原文${session.analysis ? ` · 模型：${markdownText(session.analysis.model)}` : ''}${session.source.url ? ` · 来源：${markdownText(session.source.url)}` : ''}`);
    lines.push('');
  }
  lines.push('## 观点与结构', '');
  for (const node of graph.nodes) {
    const citations = node.sourceIds.map(id => `[^${references.get(id)}]`).join('');
    lines.push(`### ${markdownText(node.label)}${citations}`, '', `类型：${TYPE_LABELS[node.type]} · 归属：${{ user: '用户', ai: 'AI', shared: '共同', unknown: '未确认' }[node.stance]} · 状态：${STATUS_LABELS[node.status]} · 重要程度：${node.importance}/5`, '');
    if (node.summary) lines.push(markdownText(node.summary), '');
    if (node.note) lines.push(`备注：${markdownText(node.note)}`, '');
    if (!node.sourceIds.length) lines.push('原文依据：未关联（主题或手动节点）。', '');
    if (node.parentId) lines.push(`上级：${markdownText(graph.nodes.find(parent => parent.id === node.parentId).label)}`, '');
  }
  if (graph.edges.length) {
    lines.push('## 关系', '');
    const labels = new Map(graph.nodes.map(node => [node.id, node.label]));
    for (const edge of graph.edges) lines.push(`- ${markdownText(labels.get(edge.source))} → ${markdownText(labels.get(edge.target))}：${markdownText(edge.label || { contains: '包含', supports: '支持', challenges: '质疑', revises: '修正', depends: '依赖' }[edge.type])}`);
    lines.push('');
  }
  lines.push('## 引用', '');
  for (const message of graph.messages) lines.push(`[^${references.get(message.id)}]: ${ROLE_LABELS[message.role]}；原文编号 ${markdownText(message.id)}，完整内容见下文。`);
  lines.push('', '## 原始对话', '', '以下为实际导入或演示数据中的完整文字；标签、脚本和指令均作为原文展示。', '');
  for (const message of graph.messages) lines.push(`### ${markdownText(message.id)} · ${ROLE_LABELS[message.role]}`, '', codeBlock(message.content), '');
  return lines.join('\n');
}
