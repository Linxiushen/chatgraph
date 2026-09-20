import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkMessages, extractConversation } from '../lib/ai.mjs';

const input = { text: '用户：最终选 A。', api: { apiKey: 'test-only', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com' } };
function result(source = 'm-1') {
  return { title: '选择', nodes: [
    { id: 'root', label: '选择', type: 'topic', stance: 'unknown', status: 'open', parentId: null, sourceIds: [] },
    { id: 'a', label: '选 A', type: 'claim', stance: 'user', status: 'confirmed', parentId: 'root', sourceIds: [source] },
  ], edges: [] };
}
const response = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });

test('provider uses requested V4 Pro maximum effort and records usage without secrets', async () => {
  const graph = await extractConversation(input, { env: {}, fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'deepseek-v4-pro'); assert.equal(body.reasoning_effort, 'max');
    assert.deepEqual(body.thinking, { type: 'enabled' }); assert.equal(body.max_tokens, 24000);
    return response(result());
  } });
  assert.equal(graph.analysis.inputTokens, 10); assert.equal(graph.analysis.outputTokens, 20);
  assert.ok(!JSON.stringify(graph).includes('test-only'));
});

test('429 retries, bad references repair once, authorization failures never retry', async () => {
  let calls = 0;
  const graph = await extractConversation(input, { env: {}, retryDelayMs: 1, fetchImpl: async () => {
    calls++; return calls === 1 ? new Response('', { status: 429 }) : calls === 2 ? response(result('invented')) : response(result());
  } });
  assert.equal(calls, 3); assert.equal(graph.analysis.calls, 3); assert.equal(graph.analysis.warnings.length, 1);
  calls = 0;
  await assert.rejects(extractConversation(input, { env: {}, fetchImpl: async () => { calls++; return new Response('', { status: 401 }); } }), /401/);
  assert.equal(calls, 1);
});

test('chunking keeps every source character including oversized single messages', () => {
  const messages = [{ id: 'm-1', role: 'user', content: 'a'.repeat(251) }, { id: 'm-2', role: 'assistant', content: '末尾' }];
  const chunks = chunkMessages(messages, 100);
  assert.equal(chunks.flat().filter(m => m.id === 'm-1').map(m => m.content).join(''), messages[0].content);
  assert.ok(chunks.flat().some(m => m.id === 'm-2'));
});

test('chunk merge retains original message text and cancels before making requests', async () => {
  const long = { ...input, text: JSON.stringify({ messages: [{ role: 'user', content: '甲'.repeat(250) }] }) };
  const graph = await extractConversation(long, { env: {}, chunkChars: 100, fetchImpl: async () => response(result()) });
  assert.equal(graph.messages.length, 1); assert.equal(graph.messages[0].content, '甲'.repeat(250));
  assert.equal(graph.analysis.chunkCount, 3); assert.equal(graph.analysis.calls, 4);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(extractConversation(input, { env: {}, signal: abort.signal, fetchImpl: () => assert.fail('no call after cancel') }), /取消/);
});
