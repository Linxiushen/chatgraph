import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConversation, organizeConversation, validateGraph, toMarkdown } from '../lib/conversations.mjs';
import { createDemoGraph } from '../lib/demo.mjs';

test('ChatGPT import follows only current_node ancestors and excludes system/tool messages', () => {
  const conversation = { current_node: 'chosen', mapping: {
    root: { parent: null, message: { id: 'sys', author: { role: 'system' }, content: { parts: ['system'] } } },
    prompt: { parent: 'root', message: { id: 'u1', author: { role: 'user' }, content: { parts: ['选择哪条路线？'] } } },
    old: { parent: 'prompt', message: { id: 'a-old', author: { role: 'assistant' }, content: { parts: ['被替换的回答'] } } },
    tool: { parent: 'prompt', message: { id: 'tool-1', author: { role: 'tool' }, content: { parts: ['工具结果'] } } },
    chosen: { parent: 'tool', message: { id: 'a-chosen', author: { role: 'assistant' }, content: { parts: ['当前回答'] } } },
  } };
  assert.deepEqual(parseConversation(JSON.stringify(conversation)).map(item => item.content), ['选择哪条路线？', '当前回答']);
  assert.throws(() => parseConversation(JSON.stringify({ ...conversation, current_node: null })), /current_node/);
  assert.throws(() => parseConversation(JSON.stringify([conversation, conversation])), /多个会话/);
  conversation.mapping.prompt.parent = 'chosen';
  assert.throws(() => parseConversation(JSON.stringify(conversation)), /循环/);
});

test('plain text preserves unknown role and role labels inside code are not speakers', () => {
  const plain = '一段没有标记角色的原文。\n保留第二行。';
  assert.deepEqual(parseConversation(plain), [{ id: 'm-1', role: 'unknown', content: plain }]);
  assert.equal(parseConversation('  原文\r\n保留换行\r\n')[0].content, '  原文\r\n保留换行\r\n');
  const marked = '## 用户\n我有个问题\n## Assistant\n```text\nUser: 这是代码中的文字\n```\n用户：继续';
  const messages = parseConversation(marked);
  assert.deepEqual(messages.map(item => item.role), ['user', 'assistant', 'user']);
  assert.match(messages[1].content, /User: 这是代码/);
  assert.equal(parseConversation('**User:** Hello\n**Assistant:** Hi')[0].content, 'Hello');
});

test('JSON accepts messages arrays and keeps text, while malformed input has useful errors', () => {
  assert.equal(parseConversation(JSON.stringify({ messages: [{ role: 'human', content: '正文' }] }))[0].role, 'user');
  assert.equal(parseConversation('[{"role":"assistant","content":[{"type":"text","text":"正文"}]}]')[0].content, '正文');
  assert.throws(() => parseConversation('{broken'), /JSON 格式/);
  assert.throws(() => parseConversation(''), /粘贴对话/);
  assert.throws(() => parseConversation('a'.repeat(100_001)), /单条消息/);
});

test('offline organization stores all source text and never infers acceptance or rejection', () => {
  const text = 'User: 我不接受这个建议。\nAssistant: 那我建议选择 A。';
  const graph = organizeConversation({ text });
  assert.equal(graph.mode, 'outline');
  assert.ok(graph.nodes.every(item => item.status === 'open'));
  assert.ok(graph.nodes.filter(item => item.parentId).every(item => item.sourceIds.length === 1));
  const long = '内容'.repeat(1_000);
  const organized = organizeConversation({ text: long });
  assert.equal(organized.messages[0].content, long);
  assert.ok(organized.nodes[1].summary.endsWith('…'));
  assert.match(organized.nodes[1].note, /截断|最多展示/);
  assert.equal(organized.nodes[1].stance, 'unknown');
});

test('validator rejects broken evidence, duplicate IDs, invalid enums and parent cycles', () => {
  const graph = createDemoGraph();
  const corrupt = structuredClone(graph);
  corrupt.nodes[1].sourceIds = ['missing'];
  assert.throws(() => validateGraph(corrupt), /不存在的原文/);
  corrupt.nodes[1].sourceIds = [];
  corrupt.nodes[0].parentId = corrupt.nodes[1].id;
  assert.throws(() => validateGraph(corrupt), /循环/);
  const duplicate = structuredClone(graph);
  duplicate.nodes.push({ ...duplicate.nodes[1] });
  assert.throws(() => validateGraph(duplicate), /重复/);
  const enumeration = structuredClone(graph);
  enumeration.nodes[1].status = 'fact';
  assert.throws(() => validateGraph(enumeration), /节点状态/);
});

test('validator accepts source-free manual nodes and positions, returns detached allowlisted data', () => {
  const graph = createDemoGraph();
  graph.nodes.push({ id: 'manual', label: '我的手动节点', summary: '', type: 'claim', stance: 'user', status: 'open', sourceIds: [], parentId: null, note: '需要补充依据', x: -42, y: 300, unsafeExtra: 'drop' });
  const validated = validateGraph(graph);
  assert.equal(validated.nodes.at(-1).note, '需要补充依据');
  assert.equal(validated.nodes.at(-1).x, -42);
  assert.equal(validated.nodes.at(-1).unsafeExtra, undefined);
  validated.nodes[1].sourceIds.push('another');
  assert.notDeepEqual(validated.nodes[1].sourceIds, graph.nodes[1].sourceIds);
  graph.source.url = 'javascript:alert(1)';
  assert.throws(() => validateGraph(graph), /http/);
});

test('deleting a node is valid when its edges and parent references are cleaned', () => {
  const graph = createDemoGraph();
  const removed = 'demo-entry';
  graph.nodes = graph.nodes.filter(node => node.id !== removed).map(node => node.parentId === removed ? { ...node, parentId: 'demo-root' } : node);
  assert.throws(() => validateGraph(graph), /不存在的节点/);
  graph.edges = graph.edges.filter(edge => edge.source !== removed && edge.target !== removed);
  assert.doesNotThrow(() => validateGraph(graph));
});

test('Markdown includes footnotes, full original text and safe fences for injected content', () => {
  const text = '<script>alert("x")</script>\n```\n# 原文里的标题\n```';
  const graph = organizeConversation({ text, title: '<img src=x onerror=alert(1)>' });
  assert.equal(graph.messages[0].content, text);
  const markdown = toMarkdown(graph);
  assert.match(markdown, /\[\^source-1\]/);
  assert.match(markdown, /\[\^source-1\]:/);
  assert.ok(markdown.includes(`\`\`\`\`text\n${text}\n\`\`\`\``));
  assert.match(markdown, /&lt;img/);
  assert.match(markdown, /未进行 AI 语义分析/);
});

test('demo is explicitly labeled and every curated non-root claim cites actual sample messages', () => {
  const graph = createDemoGraph();
  assert.equal(graph.mode, 'demo');
  assert.match(graph.description, /虚构对话/);
  assert.ok(graph.nodes.length >= 8 && graph.nodes.length <= 12);
  assert.ok(graph.nodes.filter(node => node.parentId).every(node => node.sourceIds.length));
  assert.ok(graph.nodes.some(node => node.status === 'rejected'));
  assert.ok(graph.nodes.some(node => node.status === 'revised'));
});

test('own graph JSON exposes its source messages; oversized offline graphs fail without truncation', () => {
  const graph = createDemoGraph();
  assert.deepEqual(parseConversation(JSON.stringify(graph)), graph.messages);
  const text = JSON.stringify({ messages: Array.from({ length: 200 }, (_, index) => ({ role: 'user', content: `消息 ${index + 1}` })) });
  assert.equal(parseConversation(text).length, 200);
  assert.throws(() => organizeConversation({ text }), /199 条消息/);
  graph.id = '../outside';
  assert.throws(() => validateGraph(graph), /图谱 ID 无效/);
});
