import test from 'node:test';
import assert from 'node:assert/strict';
import { organizeConversation, validateGraph } from '../lib/conversations.mjs';
import { appendGraphs } from '../lib/knowledge.mjs';

const graph = (text, title = '讨论') => organizeConversation({ text, title });

test('append remaps colliding IDs, preserves both sources and leaves manual data unchanged', () => {
  const existing = graph('User: 我倾向 A。', '最初讨论');
  existing.nodes[1].note = '人工备注';
  existing.nodes[1].x = 80;
  existing.nodes[1].importance = 5;
  const incoming = graph('User: 我现在改成 B。\nAssistant: 可以先验证假设。', '后续讨论');
  incoming.edges.push({ id: 'challenge', source: incoming.nodes[2].id, target: incoming.nodes[1].id, type: 'challenges', label: '需验证' });
  const before = structuredClone(existing);
  const merged = appendGraphs(existing, incoming);
  assert.deepEqual(existing, before);
  assert.deepEqual(merged.nodes.find(node => node.id === existing.nodes[1].id), existing.nodes[1]);
  assert.equal(merged.messages.length, 3);
  assert.deepEqual(merged.messages.map(message => message.content), [...existing.messages, ...incoming.messages].map(message => message.content));
  assert.equal(new Set(merged.messages.map(message => message.id)).size, 3);
  assert.equal(merged.sessions.length, 2);
  assert.equal(merged.sessions[1].sourceGraphId, incoming.id);
  const challenge = merged.edges.find(edge => edge.type === 'challenges');
  assert.ok(challenge.source.startsWith('append-'));
  assert.ok(challenge.target.startsWith('append-'));
  assert.ok(merged.nodes.every(node => node.status === 'open'));
  assert.doesNotThrow(() => validateGraph(merged));
});

test('only exact claims with identical evidence deduplicate, while all new source messages remain', () => {
  const original = graph('User: 我倾向 A。');
  const identical = graph('User: 我倾向 A。');
  const result = appendGraphs(original, identical);
  assert.equal(result.nodes.length, 3);
  assert.equal(result.messages.length, 2);
  const leaf = result.nodes.find(node => node.id === original.nodes[1].id);
  assert.equal(leaf.sourceIds.length, 2);
  assert.ok(result.sessions[1].nodeIds.includes(leaf.id));
  const repeated = appendGraphs(result, identical);
  assert.equal(repeated.nodes.length, 4);
  assert.equal(repeated.nodes.find(node => node.id === leaf.id).sourceIds.length, 3);
  const changed = structuredClone(identical);
  changed.nodes[1].status = 'rejected';
  const separate = appendGraphs(original, changed);
  assert.equal(separate.nodes.length, 4);
  assert.equal(separate.nodes.filter(node => node.status === 'rejected').length, 1);
  const differentSource = structuredClone(identical);
  differentSource.messages[0].content = '我不倾向 A。';
  assert.equal(appendGraphs(original, differentSource).nodes.length, 4);
});

test('nested accumulated graphs retain every session reference after another append', () => {
  const first = appendGraphs(graph('User: 先验证需求。'), graph('Assistant: 可以访谈。'));
  const combined = appendGraphs(graph('User: 我的项目。'), first);
  assert.equal(combined.sessions.length, 3);
  assert.equal(combined.messages.length, 3);
  for (const session of combined.sessions) {
    assert.ok(session.messageIds.every(id => combined.messages.some(message => message.id === id)));
    assert.ok(session.nodeIds.every(id => combined.nodes.some(node => node.id === id)));
  }
  assert.doesNotThrow(() => validateGraph(combined));
});

test('appended AI receipts remain associated with their own source session', () => {
  const first = graph('User: 初始想法。');
  const second = graph('User: 后续结论。');
  second.mode = 'ai';
  second.analysis = { model: 'test-model', generatedAt: second.createdAt, durationMs: 120, inputTokens: 30, outputTokens: 40, calls: 1, chunkCount: 1, warnings: [] };
  const merged = appendGraphs(first, second);
  assert.equal(merged.sessions[0].analysis, undefined);
  assert.equal(merged.sessions[1].analysis.model, 'test-model');
  assert.equal(merged.sessions[1].mode, 'ai');
});

test('append refuses an oversized result without dropping text or mutating either graph', () => {
  const text = JSON.stringify({ messages: Array.from({ length: 110 }, (_, index) => ({ role: 'user', content: `正文 ${index}` })) });
  const first = graph(text, '第一段');
  const second = graph(text.replaceAll('正文', '另一段'), '第二段');
  const snapshot = structuredClone(first);
  assert.throws(() => appendGraphs(first, second), /200 项/);
  assert.deepEqual(first, snapshot);
});
