import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkMessages, extractConversation } from '../lib/ai.mjs';
import { semanticSearch, suggestRelations } from '../lib/semantic.mjs';
import { organizeConversation } from '../lib/conversations.mjs';
import { appendGraphs } from '../lib/knowledge.mjs';

const env = { CHATGRAPH_API_KEY: 'fixture-key', CHATGRAPH_MODEL: 'fixture-model', CHATGRAPH_API_BASE_URL: 'https://example.test' };
const response = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
function extraction(messages, count = 1, bulky = false) {
  return { title: '测试讨论', nodes: [
    { id: 'root', label: '讨论', type: 'topic', stance: 'unknown', status: 'open', parentId: null, sourceIds: [] },
    ...Array.from({ length: count }, (_, index) => ({ id: `claim-${index}`, label: `判断 ${index}`, summary: bulky ? '证'.repeat(8900) + '最终决定保留' : '最终决定保留',
      type: 'claim', stance: 'user', status: 'confirmed', parentId: 'root', sourceIds: messages.map(message => message.id) })),
  ], edges: [] };
}
function appended(text = '我改变判断，选择 B。') {
  return appendGraphs(organizeConversation({ text: '用户：选择 A。' }), organizeConversation({ text: `用户：${text}` }));
}

test('chunk overlap respects the hard character limit and preserves Unicode characters', () => {
  const messages = [
    { id: 'large', role: 'user', content: '甲'.repeat(88) },
    { id: 'context', role: 'assistant', content: '乙'.repeat(10) },
    { id: 'next', role: 'user', content: '丙'.repeat(100) },
  ];
  const chunks = chunkMessages(messages, 100);
  assert.ok(chunks.every(chunk => chunk.reduce((sum, message) => sum + message.content.length, 0) <= 100));
  assert.equal(chunks.at(-1)[0].id, 'next');
  const unicode = '甲😀乙𠮷丙😀丁';
  const pieces = chunkMessages([{ id: 'unicode', role: 'user', content: unicode }], 3).flat();
  assert.equal(pieces.map(piece => piece.content).join(''), unicode);
  assert.ok(pieces.every(piece => piece.content.length <= 3 && piece.content.isWellFormed()));
  for (const limit of [0, 1, -1, 2.5, Infinity, NaN]) assert.throws(() => chunkMessages(messages, limit), /分段大小/);
});

test('large merge candidates are combined in bounded chronological groups without truncating viewpoints', async () => {
  const messages = Array.from({ length: 6 }, (_, index) => ({ id: `source-${index}`, role: 'user', content: `第${index}段` + '甲'.repeat(297) }));
  const requests = [];
  const graph = await extractConversation({ text: JSON.stringify({ messages }) }, { env, chunkChars: 300, fetchImpl: async (url, init) => {
    const wire = JSON.parse(init.body).messages[1].content;
    const payload = JSON.parse(wire);
    requests.push(payload);
    assert.ok(wire.length <= 240000, `request length ${wire.length}`);
    if (!payload.candidates) return response(extraction(payload.messages, 11, true));
    assert.ok(payload.candidates.length >= 2);
    assert.ok(payload.candidates.every((candidate, index, all) => !index || candidate.segment > all[index - 1].throughSegment));
    for (const candidate of payload.candidates) for (const node of candidate.nodes.slice(1)) assert.ok(node.summary.endsWith('最终决定保留'));
    return response(extraction(payload.messages));
  } });
  assert.equal(graph.analysis.chunkCount, 6);
  assert.equal(requests.filter(request => request.candidates).length, 4);
  assert.equal(graph.analysis.calls, 10);
  assert.equal(graph.analysis.inputTokens, 100);
  assert.deepEqual(graph.messages, messages);
  assert.deepEqual(graph.nodes[1].sourceIds, messages.map(message => message.id));
  assert.match(graph.analysis.warnings[0], /4 次合并/);
});

test('unmergeable full candidate records fail explicitly instead of making an oversized request', async () => {
  const messages = [0, 1].map(index => ({ id: `source-${index}`, role: 'user', content: '甲'.repeat(300) }));
  let calls = 0;
  await assert.rejects(extractConversation({ text: JSON.stringify({ messages }) }, { env, chunkChars: 300, fetchImpl: async (url, init) => {
    calls++;
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.equal(payload.candidates, undefined);
    return response(extraction(payload.messages, 15, true));
  } }), /完整保留候选观点和来源引用/);
  assert.equal(calls, 2);
});

test('merge excerpts mark omissions, retain the final user decision, and preserve complete stored source', async () => {
  const content = '原始方案。' + '\"\\\n'.repeat(24000) + '最终决定：放弃原始方案，选择 B。';
  let mergePayload;
  const graph = await extractConversation({ text: JSON.stringify({ messages: [{ id: 'long-message', role: 'user', content }] }) }, { env, fetchImpl: async (url, init) => {
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    if (payload.candidates) mergePayload = payload;
    return response(extraction(payload.messages));
  } });
  assert.ok(mergePayload);
  assert.match(mergePayload.messages[0].content, /中间原文省略/);
  assert.ok(mergePayload.messages[0].content.endsWith('最终决定：放弃原始方案，选择 B。'));
  assert.ok(JSON.stringify(mergePayload).length <= 240000);
  assert.equal(graph.messages[0].content, content);
});

test('relation analysis receives complete cited messages including decisions after the first 2000 characters', async () => {
  const text = '背景讨论。'.repeat(600) + '最终决定：放弃 A，选择 B。';
  const graph = appended(text);
  const source = graph.nodes.at(-1), target = graph.nodes[1];
  const relation = { source: source.id, target: target.id, type: 'revises', label: '更改方案', explanation: '末尾用户作出新判断。', evidenceIds: [...source.sourceIds, ...target.sourceIds] };
  const result = await suggestRelations(graph, { env, fetchImpl: async (url, init) => {
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.equal(payload.messages.at(-1).content, text);
    return response({ relations: [relation] });
  } });
  assert.equal(result.relations.length, 1);
});

test('relation analysis rejects oversized evidence before a paid call', async () => {
  const first = organizeConversation({ text: JSON.stringify({ messages: [0, 1].map(index => ({ role: 'user', content: `${index}` + '甲'.repeat(90000) })) }) });
  const graph = appendGraphs(first, organizeConversation({ text: `用户：${'乙'.repeat(90000)}` }));
  await assert.rejects(suggestRelations(graph, { env, fetchImpl: () => assert.fail('must not call model with omitted or oversized evidence') }), /完整引用原文超过 240,000/);
});

test('invalid provider envelopes and body-stream failures use stable errors without blind retries', async () => {
  const input = { text: '用户：选择 A。' };
  for (const [provider, expected] of [
    [() => Response.json(null), /响应格式/],
    [() => ({ ok: true, status: 200, json: async () => { throw Object.assign(new Error('fixture'), { name: 'TimeoutError' }); } }), /超过/],
    [() => ({ ok: true, status: 200, json: async () => { throw new TypeError('fixture'); } }), /传输中断/],
    [() => new Response('not-json'), /无法解析/],
  ]) {
    let calls = 0;
    await assert.rejects(extractConversation(input, { env, fetchImpl: async () => { calls++; return provider(); } }), expected);
    assert.equal(calls, 1);
  }
});

test('semantic null results repair once and malformed result rows never leak TypeErrors', async () => {
  const graph = organizeConversation({ text: '用户：选择 A。' });
  const store = { list: async () => [{ id: graph.id }], load: async () => graph };
  let calls = 0;
  const hits = await semanticSearch(store, '方案', { env, fetchImpl: async () => { calls++; return response(calls === 1 ? null : { matches: [] }); } });
  assert.deepEqual(hits, []); assert.equal(calls, 2);
  await assert.rejects(semanticSearch(store, '方案', { env, fetchImpl: async () => response({ matches: [null] }) }), /模型检索结果格式无效/);
  await assert.rejects(suggestRelations(appended(), { env, fetchImpl: async () => response({ relations: [null] }) }), /模型关联建议格式无效/);
  await assert.rejects(semanticSearch(store, '方案', { env, fetchImpl: async () => Response.json(null) }), /响应格式/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(semanticSearch(store, '方案', { env, signal: controller.signal, fetchImpl: () => assert.fail('no call after cancellation') }), /取消/);
});


test('a revision suggestion must cite its later user decision as evidence', async () => {
  const graph = appended();
  const source = graph.nodes.at(-1), target = graph.nodes[1];
  // A merged viewpoint may cite its original premise and the later change of mind.
  source.sourceIds.unshift(target.sourceIds[0]);
  const relation = { source: source.id, target: target.id, type: 'revises', label: '更改方案', explanation: '新的判断。', evidenceIds: target.sourceIds };
  await assert.rejects(suggestRelations(graph, { env, fetchImpl: async () => response({ relations: [relation] }) }), /后续用户判断依据/);
});

test('cancellation during response reading never becomes a JSON repair or successful result', async () => {
  for (const operation of ['extract', 'search']) {
    const controller = new AbortController();
    let calls = 0;
    const options = { env, signal: controller.signal, fetchImpl: async () => {
      calls++;
      return { ok: true, status: 200, json: async () => { controller.abort(); throw new DOMException('fixture', 'AbortError'); } };
    } };
    const graph = organizeConversation({ text: '用户：选择 A。' });
    const store = { list: async () => [{ id: graph.id }], load: async () => graph };
    await assert.rejects(operation === 'extract' ? extractConversation({ text: '用户：选择 A。' }, options) : semanticSearch(store, '方案', options), /取消/);
    assert.equal(calls, 1);
  }
});
