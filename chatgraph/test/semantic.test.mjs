import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticSearch, suggestRelations } from '../lib/semantic.mjs';
import { organizeConversation } from '../lib/conversations.mjs';
import { appendGraphs } from '../lib/knowledge.mjs';

const env = { CHATGRAPH_API_KEY: 'only-test', CHATGRAPH_MODEL: 'test', CHATGRAPH_API_BASE_URL: 'https://example.test' };
const respond = value => async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const first = () => organizeConversation({ text: '用户：选 A 方案。', title: '第一次讨论' });

test('semantic retrieval returns existing nodes only and rejects invented citations', async () => {
  const graph = first(), node = graph.nodes[1];
  const store = { list: async () => [{ id: graph.id }], load: async () => graph };
  const hits = await semanticSearch(store, '我的方案选择', { env, fetchImpl: respond({ matches: [{ graphId: graph.id, nodeId: node.id, score: 0.9 }] }) });
  assert.equal(hits[0].matchType, 'semantic'); assert.equal(hits[0].nodes[0].label, node.label);
  await assert.rejects(semanticSearch(store, '选择', { env, fetchImpl: respond({ matches: [{ graphId: graph.id, nodeId: 'made-up', score: 1 }] }) }), /不存在/);
});

test('cross-conversation suggestions preserve manual graph and require both sources', async () => {
  const old = first(), next = organizeConversation({ text: '用户：我改成 B，放弃 A。', title: '第二次讨论' });
  const graph = appendGraphs(old, next);
  const before = JSON.stringify(graph);
  const source = graph.nodes.at(-1), target = graph.nodes[1];
  const relation = { source: source.id, target: target.id, type: 'revises', label: '更换方案', explanation: '后续用户改变了选择。', evidenceIds: [...source.sourceIds, ...target.sourceIds] };
  const output = await suggestRelations(graph, { env, fetchImpl: respond({ relations: [relation] }) });
  assert.equal(output.relations.length, 1); assert.equal(JSON.stringify(graph), before);
  await assert.rejects(suggestRelations(graph, { env, fetchImpl: respond({ relations: [{ ...relation, evidenceIds: target.sourceIds }] }) }), /两端/);
  await assert.rejects(suggestRelations(graph, { env, fetchImpl: respond({ relations: [{ ...relation, source: target.id, target: source.id }] }) }), /后续用户/);
});

test('single imported conversation explains that a second conversation is required', async () => {
  await assert.rejects(suggestRelations(first(), { env, fetchImpl: () => assert.fail('must not call model') }), /请先追加/);
});

test('invalid semantic JSON is repaired once and never retried without a bound', async () => {
  const graph = first();
  const store = { list: async () => [{ id: graph.id }], load: async () => graph };
  let calls = 0;
  const malformed = () => Response.json({ choices: [{ message: { content: '{"matches":[' }, finish_reason: 'stop' }] });
  const hits = await semanticSearch(store, '选择', { env, fetchImpl: async () => {
    calls++;
    return calls === 1 ? malformed() : respond({ matches: [{ graphId: graph.id, nodeId: graph.nodes[1].id, score: 1 }] })();
  } });
  assert.equal(calls, 2); assert.equal(hits.length, 1);
  calls = 0;
  await assert.rejects(semanticSearch(store, '选择', { env, fetchImpl: async () => { calls++; return malformed(); } }), /有效 JSON/);
  assert.equal(calls, 2);
});
