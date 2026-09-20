// Shared import parser: browser preview and server extraction use identical rules.
// This module has no network, storage or Node-specific dependencies.
const LIMIT = { input: 2_000_000, messages: 500, message: 100_000 };
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
function fail(message) { throw new Error(message); }
function record(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${where} 必须是对象。`);
  return value;
}
function string(value, where, max) {
  if (typeof value !== 'string') fail(`${where} 必须是文字。`);
  if (value.length > max) fail(`${where} 超过 ${max.toLocaleString('en-US')} 字符，请缩短内容。`);
  return value;
}
function role(value) {
  const normalized = String(value || '').toLowerCase();
  if (['user', 'human', '用户', '我', '人类'].includes(normalized)) return 'user';
  if (['assistant', 'ai', 'chatgpt', 'deepseek', 'claude', 'gemini', '助手', '模型', '回答'].includes(normalized)) return 'assistant';
  return 'unknown';
}
function textContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => typeof part === 'string' ? part : ['text', 'input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.parts)) return textContent(value.parts);
  }
  return '';
}
function normalizeMessages(raw, { maxMessages = LIMIT.messages, maxMessage = LIMIT.message } = {}) {
  const messages = [];
  const ids = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') fail('消息必须是包含 role 和 content 的对象。');
    const originalRole = entry.role ?? entry.author?.role;
    if (['system', 'tool', 'developer', 'function'].includes(String(originalRole).toLowerCase())) continue;
    const content = textContent(entry.content);
    if (!content.trim()) continue;
    string(content, '单条消息', maxMessage);
    const requestedId = entry.id;
    let id = typeof requestedId === 'string' && ID.test(requestedId) && !['__proto__', 'prototype', 'constructor'].includes(requestedId) ? requestedId : `m-${messages.length + 1}`;
    if (ids.has(id)) fail(`消息 ID 重复：${id}，请检查导出文件。`);
    ids.add(id);
    messages.push({ id, role: role(originalRole), content });
    if (messages.length > maxMessages) fail(`一次最多导入 ${maxMessages} 条文字消息，请选择较短的对话。`);
  }
  if (!messages.length) fail('没有找到可导入的文字消息。当前版本只读取文字，不解析图片、音频或附件。');
  return messages;
}
function mappingMessages(conversation) {
  const mapping = record(conversation.mapping, 'ChatGPT mapping');
  if (typeof conversation.current_node !== 'string' || !conversation.current_node) fail('ChatGPT 导出缺少 current_node，无法确定当前对话分支。请导出单个会话，或复制当前分支的文字。');
  const chain = [];
  const visited = new Set();
  let cursor = conversation.current_node;
  while (cursor !== null && cursor !== undefined) {
    if (typeof cursor !== 'string' || visited.has(cursor)) fail('ChatGPT 对话分支存在循环或无效节点，请重新导出。');
    visited.add(cursor);
    const node = Object.hasOwn(mapping, cursor) ? mapping[cursor] : null;
    if (!node || typeof node !== 'object') fail(`ChatGPT 当前分支缺少节点 ${cursor}，请导入完整的单个会话文件。`);
    if (node.message) chain.push({ ...node.message, id: node.message.id || cursor });
    cursor = node.parent;
    if (visited.size > 2_000) fail('ChatGPT 分支过长，请选择部分对话导入。');
  }
  return chain.reverse();
}
function fromJson(value, options) {
  if (Array.isArray(value)) {
    if (isMessageArray(value)) return normalizeMessages(value, options);
    if (value.length !== 1) fail('此文件包含多个会话。请先选择并导出一个会话；为避免遗漏，不会自动选择第一段。');
    return fromJson(value[0], options);
  }
  record(value, '导入的 JSON');
  if (value.mapping) return normalizeMessages(mappingMessages(value), options);
  if (Array.isArray(value.messages)) return normalizeMessages(value.messages, options);
  if (Array.isArray(value.conversations)) return fromJson(value.conversations, options);
  fail('不支持这个 JSON 结构。请提供单个 ChatGPT mapping 会话，或 { "messages": [{ "role": "user", "content": "…" }] }。');
}

/** Parse only the supplied text/current ChatGPT branch; never infer a speaker. */
function parseText(text, options) {
  if (!text.trim()) fail('请粘贴对话内容，或选择文字 / JSON 文件。');
  const withoutBom = text.replace(/^\uFEFF/, '');
  const trimmed = withoutBom.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value;
    try { value = JSON.parse(trimmed); } catch { fail('JSON 格式不完整或有语法错误。请使用完整导出文件，或以普通对话文字导入。'); }
    return fromJson(value, options);
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
  if (!hasRoleLabel) return normalizeMessages([{ role: 'unknown', content: withoutBom }], options);
  return normalizeMessages(raw, options);
}

export function parseConversation(text) {
  string(text, '对话内容', LIMIT.input);
  return parseText(text);
}

export const IMPORT_FILE_MAX_BYTES = 25 * 1024 * 1024;

function isMessageArray(value) {
  return Array.isArray(value) && value.every(item => item && typeof item === 'object' && ('role' in item || 'author' in item) && 'content' in item);
}
function fileValue(text) {
  string(text, '本地导入文件', IMPORT_FILE_MAX_BYTES);
  if (new TextEncoder().encode(text).byteLength > IMPORT_FILE_MAX_BYTES) fail('本地导入文件超过 25 MB，请先缩小导出范围。');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) fail('请先提供对话内容。');
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try { return JSON.parse(trimmed); }
  catch { fail('JSON 格式不完整或有语法错误，请使用完整的导出文件。'); }
}
function archiveEntries(value) {
  if (Array.isArray(value) && !isMessageArray(value)) return value;
  if (value && Array.isArray(value.conversations)) return value.conversations;
  return null;
}
function graphFile(value) {
  return value && !Array.isArray(value) && Array.isArray(value.nodes) && Array.isArray(value.edges) && Array.isArray(value.messages);
}
function metadata(value, index = 0) {
  const date = value?.update_time ?? value?.updatedAt ?? value?.create_time;
  const parsed = typeof date === 'number' ? new Date(date * 1000) : typeof date === 'string' ? new Date(date) : null;
  const platform = value?.mapping ? 'ChatGPT' : value?.source?.platform || value?.capture?.platform || value?.platform || '其他';
  return { index, title: typeof value?.title === 'string' ? value.title.slice(0, 200) : '',
    platform: typeof platform === 'string' ? platform.slice(0, 100) : '其他',
    updatedAt: parsed && Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null };
}

/** Catalog only. Account-export contents stay in the importing browser. */
export function inspectConversationFile(text) {
  const value = fileValue(text), entries = archiveEntries(value);
  if (entries) {
    if (!entries.length || entries.length > 10_000) fail('账号导出须包含 1–10,000 个会话，请缩小导出范围。');
    return { kind: 'archive', conversations: entries.map((entry, index) => metadata(entry, index)) };
  }
  return { kind: graphFile(value) ? 'graph' : 'conversation', conversations: [metadata(value)] };
}

function omittedContent(value, inArray = false) {
  if (value === undefined || value === null || typeof value === 'string') return 0;
  if (Array.isArray(value)) return value.reduce((sum, part) => sum + omittedContent(part, true), 0);
  if (inArray) return ['text', 'input_text', 'output_text'].includes(value?.type) && typeof value.text === 'string' ? 0 : 1;
  if (typeof value === 'object' && typeof value.text === 'string') return 0;
  if (Array.isArray(value?.parts)) return omittedContent(value.parts);
  return 1;
}
function sourceMetadata(value) {
  const source = value?.source || value?.capture || {};
  const raw = source.url || value?.url || '';
  let url = '';
  try { const parsed = new URL(raw); if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href; } catch { /* Optional source URL. */ }
  return { platform: metadata(value).platform, url,
    complete: ['provided', 'partial', 'unknown'].includes(source.complete) ? source.complete : 'provided' };
}

/** Select one current branch/range and materialize only that text for import. */
export function previewConversation(text, { conversationIndex, from = 1, to, roles = {} } = {}) {
  let value = fileValue(text);
  const plainText = value === null;
  const entries = archiveEntries(value);
  if (entries) {
    if (!entries.length || entries.length > 10_000) fail('账号导出须包含 1–10,000 个会话，请缩小导出范围。');
    if (conversationIndex === undefined && entries.length === 1) conversationIndex = 0;
    if (!Number.isInteger(conversationIndex) || conversationIndex < 0 || conversationIndex >= entries.length) fail('请先选择一个会话，不会自动导入账号内的全部聊天。');
    value = record(entries[conversationIndex], '所选会话');
  }
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) fail('角色修正格式无效。');
  const isGraph = graphFile(value);
  if (isGraph && (from !== 1 || to !== undefined || Object.keys(roles).length)) fail('图谱文件应完整恢复，不能在对话预览中修改范围或角色。');
  const previewLimits = { maxMessages: 20_000, maxMessage: IMPORT_FILE_MAX_BYTES };
  const all = isGraph ? value.messages : plainText ? parseText(text, previewLimits) : fromJson(value, previewLimits);
  if (isGraph && all.some(message => !message || typeof message.id !== 'string' || !['user', 'assistant', 'unknown'].includes(message.role) || typeof message.content !== 'string')) fail('图谱中的原文格式无效。');
  const warnings = [];
  const raw = value?.mapping ? mappingMessages(value) : isMessageArray(value) ? value : value?.messages || [];
  const systemCount = raw.filter(item => ['system', 'tool', 'developer', 'function'].includes(String(item?.role ?? item?.author?.role).toLowerCase())).length;
  const attachments = raw.reduce((sum, item) => sum + omittedContent(item?.content), 0);
  const alternateBranches = value?.mapping && Object.values(value.mapping).filter(item => item?.message).length > raw.length;
  if (systemCount) warnings.push(`已跳过 ${systemCount} 条系统或工具消息，仅整理对话文字。`);
  if (attachments) warnings.push(`包含 ${attachments} 处图片、音频或其他非文字内容；当前仅导入可读取的文字。`);
  if (alternateBranches) warnings.push('此会话存在其他分支，仅选取导出时的当前分支。');
  let end = isGraph ? all.length : to ?? Math.min(all.length, from + LIMIT.messages - 1);
  if (!isGraph && to === undefined && Number.isInteger(from) && from >= 1 && from <= all.length) {
    // Account files may be much larger than an import request. Leave room for
    // metadata and JSON-within-JSON escaping, and state the selected range below.
    let characters = 0, bytes = 0;
    const encoder = new TextEncoder();
    for (let index = from - 1; index < end; index++) {
      characters += all[index].content.length;
      bytes += encoder.encode(JSON.stringify(JSON.stringify(all[index]))).byteLength + 4;
      if (characters > LIMIT.input || bytes > 2 * 1024 * 1024 - 32768) { end = Math.max(from, index); break; }
    }
  }
  if (!(isGraph && all.length === 0) && (!Number.isInteger(from) || !Number.isInteger(end) || from < 1 || end < from || end > all.length)) fail(`消息范围须为 1–${all.length} 内的连续区间。`);
  if (end - from + 1 > LIMIT.messages) fail('一次最多整理 500 条文字消息，请缩小消息范围。');
  const ids = new Set(all.map(message => message.id));
  for (const [id, correctedRole] of Object.entries(roles)) if (!ids.has(id) || !['user', 'assistant', 'unknown'].includes(correctedRole)) fail('角色修正引用了不存在的消息或无效角色。');
  const messages = all.slice(from - 1, end).map(message => ({ ...message, role: Object.hasOwn(roles, message.id) ? roles[message.id] : message.role }));
  const tooLong = messages.findIndex(message => message.content.length > LIMIT.message);
  if (tooLong !== -1) throw Object.assign(new Error(`第 ${from + tooLong} 条消息超过 100,000 字符，请选择其他消息范围，或先拆分这条长消息。`), { totalMessages: all.length, from, to: end });
  const unknownRoles = messages.filter(message => message.role === 'unknown').length;
  if (unknownRoles) warnings.push(`${unknownRoles} 条消息尚未标明发言者，请核对角色，避免把 AI 建议当作个人判断。`);
  const partial = from !== 1 || end !== all.length;
  if (partial) warnings.push(`仅选择第 ${from}–${end} 条，共 ${messages.length} / ${all.length} 条文字消息；其余内容不发送、不保存。`);
  if (messages.reduce((sum, message) => sum + message.content.length, 0) > LIMIT.input) fail('所选原文超过 2,000,000 字符，请缩小消息范围。');
  const source = sourceMetadata(value);
  if (!isGraph && (partial || attachments || alternateBranches)) source.complete = 'partial';
  return { kind: isGraph ? 'graph' : 'conversation', title: metadata(value).title, ...source, messages,
    text: isGraph ? JSON.stringify(value) : JSON.stringify({ messages, source }),
    totalMessages: all.length, selectedCount: messages.length, unknownRoles, warnings, from, to: end };
}
