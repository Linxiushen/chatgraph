import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectConversationFile, previewConversation, parseConversation } from '../public/import-model.js';
import { organizeConversation } from '../lib/conversations.mjs';
import { createDemoGraph } from '../lib/demo.mjs';

test('account export requires a choice and materializes only the selected current branch', () => {
  const selected = { title: '第二场讨论', current_node: 'last', mapping: {
    root: { parent: null, message: { author: { role: 'system' }, content: 'internal instructions' } },
    user: { parent: 'root', message: { id: 'original-user', author: { role: 'user' }, content: { parts: ['最终选择第二个方案。'] } } },
    other: { parent: 'user', message: { author: { role: 'assistant' }, content: { parts: ['未选中的分支内容'] } } },
    last: { parent: 'user', message: { id: 'original-ai', author: { role: 'assistant' }, content: { parts: ['记下这个决定。'] } } },
  } };
  const archive = JSON.stringify([{ title: '第一场私密讨论', messages: [{ role: 'user', content: '不相关的账号聊天' }] }, selected]);
  const catalog = inspectConversationFile(archive);
  assert.equal(catalog.kind, 'archive');
  assert.deepEqual(catalog.conversations.map(item => item.title), ['第一场私密讨论', '第二场讨论']);
  assert.ok(!JSON.stringify(catalog).includes('不相关的账号聊天'));
  assert.throws(() => previewConversation(archive), /先选择一个会话/);
  const preview = previewConversation(archive, { conversationIndex: 1 });
  assert.deepEqual(preview.messages.map(message => message.id), ['original-user', 'original-ai']);
  assert.equal(preview.title, '第二场讨论');
  assert.equal(preview.platform, 'ChatGPT');
  assert.equal(preview.complete, 'partial');
  assert.match(preview.warnings.join(' '), /其他分支/);
  assert.match(preview.warnings.join(' '), /系统或工具/);
  for (const excluded of ['不相关的账号聊天', '未选中的分支内容', 'internal instructions']) assert.ok(!preview.text.includes(excluded));
  assert.deepEqual(parseConversation(preview.text), preview.messages);
});

test('preview retains exact text, permits explicit role correction and reports missing media', () => {
  const input = JSON.stringify({ source: { platform: 'DeepSeek', complete: 'partial' }, messages: [
    { id: 'a', role: 'unknown', content: '  是不是应该换方案？\n先别决定。  ' },
    { id: 'b', role: 'assistant', content: [{ type: 'text', text: '这是一个建议。' }, { type: 'image', url: 'https://example.test/picture' }] },
    { id: 'c', role: 'user', content: '待下一轮再决定。' },
  ] });
  const unknown = previewConversation(input);
  assert.equal(unknown.unknownRoles, 1);
  const preview = previewConversation(input, { from: 1, to: 2, roles: { a: 'user' } });
  assert.equal(preview.messages[0].role, 'user');
  assert.equal(preview.messages[0].content, '  是不是应该换方案？\n先别决定。  ');
  assert.equal(preview.unknownRoles, 0);
  assert.equal(preview.selectedCount, 2);
  assert.equal(preview.totalMessages, 3);
  assert.match(preview.warnings.join(' '), /非文字内容/);
  assert.match(preview.warnings.join(' '), /2 \/ 3/);
  assert.equal(preview.complete, 'partial');
  const organized = organizeConversation({ text: preview.text });
  assert.deepEqual(organized.messages, preview.messages);
  assert.ok(organized.nodes.every(node => node.status === 'open'));
  assert.throws(() => previewConversation(input, { roles: { absent: 'user' } }), /不存在的消息/);
});

test('long local conversation can select a valid bounded range without losing source IDs', () => {
  const input = JSON.stringify({ conversations: [{ title: '长讨论', messages: Array.from({ length: 601 }, (_, index) => ({ id: `message-${index + 1}`, role: 'user', content: `原文第 ${index + 1} 条` })) }] });
  const first = previewConversation(input);
  assert.equal(first.selectedCount, 500);
  assert.equal(first.totalMessages, 601);
  assert.equal(first.complete, 'partial');
  assert.match(first.warnings.join(' '), /500 \/ 601/);
  const selected = previewConversation(input, { from: 550, to: 601 });
  assert.equal(selected.selectedCount, 52);
  assert.equal(selected.messages[0].id, 'message-550');
  assert.equal(selected.messages.at(-1).id, 'message-601');
  assert.deepEqual(parseConversation(selected.text), selected.messages);
  assert.throws(() => previewConversation(input, { from: 1, to: 601 }), /最多整理 500/);
  assert.throws(() => previewConversation(input, { from: 0, to: 10 }), /连续区间/);
});

test('graph file preview preserves authored data, including a graph with no source messages', () => {
  const graph = createDemoGraph();
  graph.messages = [];
  for (const node of graph.nodes) node.sourceIds = [];
  graph.nodes[0].note = '保留人工备注';
  const input = '\uFEFF' + JSON.stringify(graph);
  assert.equal(inspectConversationFile(input).kind, 'graph');
  const preview = previewConversation(input);
  assert.equal(preview.kind, 'graph');
  assert.equal(preview.totalMessages, 0);
  assert.deepEqual(JSON.parse(preview.text), graph);
  assert.throws(() => previewConversation(input, { from: 2 }), /应完整恢复/);
});

test('preview refuses malformed input and inherited mapping keys, and preserves fenced role labels', () => {
  assert.throws(() => inspectConversationFile('{broken'), /JSON 格式/);
  assert.throws(() => previewConversation(JSON.stringify([{ title: 'good', messages: [{ role: 'user', content: 'good' }] }, null]), { conversationIndex: 1 }), /所选会话/);
  assert.throws(() => previewConversation(JSON.stringify({ mapping: {}, current_node: 'constructor' })), /缺少节点/);
  const text = '用户：请核对代码\n```text\nAI: 这行仍属于用户代码\n```\nAI：已收到';
  const preview = previewConversation(text);
  assert.equal(preview.messages.length, 2);
  assert.ok(preview.messages[0].content.includes('AI: 这行仍属于用户代码'));
  assert.deepEqual(preview.messages, parseConversation(text));
});

test('unselected oversized messages do not block a valid range, and excessive defaults expose range metadata', () => {
  const text = JSON.stringify({ messages: [{ id: 'long', role: 'user', content: '长'.repeat(100001) }, { id: 'short', role: 'assistant', content: '只整理这一条。' }] });
  const preview = previewConversation(text, { from: 2, to: 2 });
  assert.deepEqual(preview.messages.map(message => message.id), ['short']);
  assert.deepEqual(parseConversation(preview.text), preview.messages);
  assert.throws(() => previewConversation(text), error => error.totalMessages === 2 && /第 1 条消息/.test(error.message));
});

test('omission warnings exactly follow accepted text parts and capture-only source metadata', () => {
  const text = JSON.stringify({ capture: { platform: 'DeepSeek', complete: 'provided' }, messages: [{ role: 'assistant', content: [
    { type: 'text', text: '保留文字' }, { type: 'image', text: '未理解的图片标记' }, { parts: ['未支持的嵌套文本'] },
  ] }] });
  const preview = previewConversation(text);
  assert.equal(preview.messages[0].content, '保留文字');
  assert.equal(preview.platform, 'DeepSeek');
  assert.equal(preview.complete, 'partial');
  assert.match(preview.warnings.join(' '), /2 处/);
});

test('large UTF-8 local files default to an explicitly bounded request and can select a later range', () => {
  const text = JSON.stringify({ messages: Array.from({ length: 30 }, (_, index) => ({ id: `large-${index}`, role: 'user', content: '中'.repeat(90000) })) });
  const preview = previewConversation(text);
  assert.equal(preview.totalMessages, 30);
  assert.ok(preview.selectedCount < 30);
  assert.equal(preview.complete, 'partial');
  assert.ok(new TextEncoder().encode(JSON.stringify({ text: preview.text })).byteLength < 2 * 1024 * 1024);
  const later = previewConversation(text, { from: 29, to: 30 });
  assert.deepEqual(later.messages.map(message => message.id), ['large-28', 'large-29']);
});
