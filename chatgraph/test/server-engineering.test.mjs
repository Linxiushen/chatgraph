import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { organizeConversation, validateGraph } from '../lib/conversations.mjs';
import { createGraphStore } from '../lib/store.mjs';
import { extractConversation } from '../lib/ai.mjs';
import { semanticSearch } from '../lib/semantic.mjs';
import { MAX_PROVIDER_BYTES, MAX_GRAPH_BYTES } from '../lib/limits.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-engineering-'));
  const server = createAppServer({ dataDir, env: {}, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, body, method = body === undefined ? 'GET' : 'POST') => fetch(base + route, {
    method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { dataDir, server, base, request };
}

test('large valid Chinese graphs save and reload, while stale or unversioned deletes preserve newer work', async t => {
  const { request } = await fixture(t);
  const graph = organizeConversation({ text: '用户：保留完整原文' });
  graph.messages = Array.from({ length: 10 }, (_, index) => ({ id: index ? `source-${index}` : 'm-1', role: 'user', content: '中'.repeat(100000) }));
  assert.ok(Buffer.byteLength(JSON.stringify(graph)) > 2 * 1024 * 1024);
  const response = await request('/api/graphs', graph);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal((await (await request(`/api/graphs/${saved.id}`)).json()).messages[9].content, graph.messages[9].content);
  const changed = await (await request('/api/graphs', { ...saved, title: '另一设备的新版本' })).json();
  assert.equal((await request(`/api/graphs/${saved.id}`, undefined, 'DELETE')).status, 428);
  assert.equal((await request(`/api/graphs/${saved.id}`, { expectedRevision: saved.revision }, 'DELETE')).status, 409);
  assert.equal((await (await request(`/api/graphs/${saved.id}`)).json()).title, changed.title);
  assert.equal((await request(`/api/graphs/${saved.id}`, { expectedRevision: changed.revision }, 'DELETE')).status, 200);
});

test('oversized graph metadata is rejected without replacing or discarding the stored source', async t => {
  const { dataDir } = await fixture(t);
  const graph = organizeConversation({ text: '用户：超大元数据' });
  graph.messages = Array.from({ length: 20 }, (_, index) => ({ id: index ? `source-${index}` : 'm-1', role: 'user', content: '中'.repeat(100000) }));
  graph.nodes.push(...Array.from({ length: 100 }, (_, index) => ({ ...graph.nodes[1], id: `extra-${index}`, note: '注'.repeat(10000) })));
  assert.throws(() => validateGraph(graph), /超过 8 MiB.*拆分.*未修改/);
  const file = path.join(dataDir, `${graph.id}.json`);
  const original = JSON.stringify(graph);
  await writeFile(file, original);
  const store = createGraphStore({ dataDir });
  await assert.rejects(store.load(graph.id), error => error.status === 422);
  assert.equal((await store.list())[0].recoveryRequired, true);
  assert.equal(await readFile(file, 'utf8'), original);
});

function graphAtByteLimit() {
  let graph = organizeConversation({ text: '用户：精确容量边界' });
  graph.messages = Array.from({ length: 20 }, (_, index) => ({ id: index ? `source-${index}` : 'm-1', role: 'user', content: '中'.repeat(100000) }));
  graph.nodes.push(...Array.from({ length: 81 }, (_, index) => ({ ...graph.nodes[1], id: `extra-${index}`, note: '' })));
  graph = validateGraph(graph);
  let remaining = MAX_GRAPH_BYTES - Buffer.byteLength(JSON.stringify(graph));
  let lastFilled;
  for (const node of graph.nodes.slice(2)) {
    const bytes = Math.min(30000, remaining);
    node.note = '注'.repeat(Math.floor(bytes / 3)) + 'x'.repeat(bytes % 3);
    remaining -= bytes;
    lastFilled = node;
    if (!remaining) break;
  }
  assert.equal(remaining, 0);
  return { graph, lastFilled };
}

test('the complete normalized graph accepts the exact byte boundary and rejects one extra byte', () => {
  const { graph, lastFilled } = graphAtByteLimit();
  assert.equal(Buffer.byteLength(JSON.stringify(validateGraph(graph))), MAX_GRAPH_BYTES);
  lastFilled.note += 'x';
  assert.throws(() => validateGraph(graph), /超过 8 MiB/);
});

test('revision growth at the graph byte limit fails before replacing current or corrupt originals', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-revision-capacity-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { graph } = graphAtByteLimit();
  graph.revision = 8;
  const file = path.join(dataDir, `${graph.id}.json`);
  await writeFile(file, JSON.stringify(graph));
  const store = createGraphStore({ dataDir });
  const saved = await store.save(graph);
  assert.equal(saved.revision, 9);
  assert.equal(Buffer.byteLength(JSON.stringify(saved)), MAX_GRAPH_BYTES);
  const unchanged = await readFile(file, 'utf8');
  await assert.rejects(store.save(saved), /超过 8 MiB/);
  assert.equal(await readFile(file, 'utf8'), unchanged);
  assert.equal((await store.load(graph.id)).revision, 9);
  const historyDir = path.join(dataDir, '.history', graph.id);
  await mkdir(historyDir, { recursive: true });
  await writeFile(path.join(historyDir, '9.json'), JSON.stringify(saved));
  await writeFile(file, '{broken original');
  await assert.rejects(store.restore(graph.id, 9, null), /超过 8 MiB/);
  assert.equal(await readFile(file, 'utf8'), '{broken original');
});

test('the production entrypoint refuses an incomplete restored data directory before listening', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-incomplete-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(path.join(dataDir, '.incomplete'), 'restore interrupted');
  const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [serverPath], {
    env: { ...process.env, CHATGRAPH_DATA_DIR: dataDir, CHATGRAPH_PORT: '0', CHATGRAPH_HOST: '127.0.0.1' }, timeout: 5000,
  }), error => error.code !== 0 && /恢复尚未完成/.test(error.stderr) && !/ChatGraph →/.test(error.stdout));
});

test('direct model calls have a shared concurrency bound and release it on disconnection', async t => {
  let calls = 0, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { base, request, server } = await fixture(t, { fetchImpl: async (url, init) => {
    calls++; entered();
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  } });
  const input = { text: '用户：需要取消', mode: 'ai', api: { baseUrl: 'https://model.example', apiKey: 'test-only', model: 'test-only' } };
  const controller = new AbortController();
  const pending = fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal }).catch(error => error);
  await started;
  assert.equal((await request('/api/import', input)).status, 429);
  assert.equal((await request('/api/search', { query: '知识' })).status, 429);
  assert.equal(calls, 1);
  controller.abort(); await pending;
  const deadline = Date.now() + 2000;
  let retry;
  do {
    retry = await request('/api/search', { query: '知识' });
    if (retry.status !== 429) break;
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5));
  } while (true);
  assert.equal(retry.status, 200);
  assert.equal(server.headersTimeout, 15000);
  assert.equal(server.requestTimeout, 60000);
});

test('both extraction and semantic analysis stop oversized provider streams without retries', async () => {
  const graph = organizeConversation({ text: '用户：选择方案' });
  const store = { list: async () => [{ id: graph.id }], load: async () => graph };
  const env = { CHATGRAPH_API_KEY: 'test-only', CHATGRAPH_MODEL: 'test', CHATGRAPH_API_BASE_URL: 'https://model.example' };
  for (const operation of ['extract', 'search']) {
    let calls = 0, cancelled = false, pulls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }));
    };
    await assert.rejects(operation === 'extract' ? extractConversation({ text: '用户：选择方案' }, { env, fetchImpl }) : semanticSearch(store, '方案', { env, fetchImpl }), /响应超过 8 MiB/);
    assert.equal(calls, 1); assert.equal(cancelled, true); assert.ok(pulls <= MAX_PROVIDER_BYTES / (1024 * 1024) + 2);
  }
});

test('a stalled provider body is cancelled at the request timeout', async () => {
  let cancelled = false;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(extractConversation({ text: '用户：等待模型', api: { apiKey: 'test', model: 'test' } }, {
      env: {}, timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })),
    }), /模型整理超过/);
    assert.equal(cancelled, true);
  } finally { clearTimeout(keepAlive); }
});

test('semantic search skips a graph deleted after listing and rejects oversized libraries before loading the remainder', async () => {
  const graph = organizeConversation({ text: '用户：完整知识' });
  graph.nodes = Array.from({ length: 200 }, (_, index) => ({ ...graph.nodes[1], id: `node-${index}` }));
  let loaded = 0;
  const store = { list: async () => Array.from({ length: 100 }, (_, index) => ({ id: String(index) })), load: async id => {
    loaded++;
    if (id === '0') throw Object.assign(new Error('removed'), { code: 'ENOENT' });
    return { ...graph, id };
  } };
  await assert.rejects(semanticSearch(store, '知识', { fetchImpl: () => assert.fail('no paid request for oversized candidates') }), /超过本次 AI 检索范围/);
  assert.equal(loaded, 14, 'one removed graph and thirteen bounded graph loads');
});
