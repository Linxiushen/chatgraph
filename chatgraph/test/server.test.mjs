import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createAppServer } from '../server.mjs';
import { createDemoGraph } from '../lib/demo.mjs';
import { extractConversation, resolveAIConfig } from '../lib/ai.mjs';
import { renderGraphHtml, renderGraphSvg, layoutGraph } from '../lib/render.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chatgraph-test-'));
  const server = createAppServer({ dataDir, env: {}, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, body, options = {}) => fetch(base + route, {
    ...options, method: options.method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { dataDir, server, base, request };
}

test('save, reload, export, JSON reimport and delete preserve authored graph and sources', async t => {
  const { request, dataDir } = await fixture(t);
  const graph = createDemoGraph();
  graph.id = 'valid.graph:1';
  graph.nodes[1].label = '修改后的判断';
  const savedResponse = await request('/api/graphs', graph);
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.nodes[1].label, '修改后的判断');
  assert.equal(JSON.parse(await readFile(path.join(dataDir, `${graph.id}.json`), 'utf8')).nodes[1].label, '修改后的判断');
  assert.equal((await (await request(`/api/graphs/${graph.id}`)).json()).messages[0].content, graph.messages[0].content);
  assert.equal((await (await request('/api/graphs')).json()).length, 1);
  for (const format of ['json', 'markdown', 'html', 'svg']) {
    const response = await request('/api/export', { graph: saved, format });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /attachment/);
    assert.ok((await response.text()).includes('修改后的判断'));
  }
  const reimport = await request('/api/import', { text: JSON.stringify(saved), mode: 'outline' });
  const imported = await reimport.json();
  assert.notEqual(imported.id, saved.id);
  assert.deepEqual(imported.edges, saved.edges);
  assert.deepEqual(imported.nodes, saved.nodes);
  assert.equal((await request(`/api/graphs/${graph.id}`, undefined, { method: 'DELETE' })).status, 200);
  assert.equal((await (await request('/api/graphs')).json()).length, 0);
});

test('local service blocks cross-origin access, unexpected hosts and traversal', async t => {
  const { request, base } = await fixture(t);
  assert.equal((await request('/api/graphs', createDemoGraph(), { headers: { Origin: 'https://example.com' } })).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(base + '/api/graphs', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await request('/%2e%2e%2fLICENSE')).status, 404);
  assert.equal((await request('/api/graphs', { ...createDemoGraph(), id: '../outside' })).status, 400);
  assert.equal((await request('/api/graphs/unknown')).status, 404);
});

test('offline import never calls a model, and missing credentials fail without silent fallback', async t => {
  const { request } = await fixture(t, { fetchImpl: () => { throw new Error('must not call'); } });
  const input = { text: '用户：我考虑先试试。\nAI：可以先做导图。', title: '真实导入', platform: 'DeepSeek', mode: 'outline' };
  const result = await (await request('/api/import', input)).json();
  assert.equal(result.mode, 'outline');
  assert.equal(result.messages.length, 2);
  assert.ok(result.nodes.every(node => node.status === 'open'));
  const response = await request('/api/import', { ...input, mode: 'ai' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /API/);
});

test('server-held keys never leak in config or follow a changed API endpoint', async t => {
  const env = { CHATGRAPH_API_KEY: 'test-only-secret', CHATGRAPH_MODEL: 'configured-model', CHATGRAPH_API_BASE_URL: 'https://api.example.com/v1' };
  const { request } = await fixture(t, { env });
  const content = await (await request('/api/config')).text();
  assert.ok(!content.includes('test-only-secret'));
  assert.equal(JSON.parse(content).aiConfigured, true);
  assert.throws(() => resolveAIConfig({ baseUrl: 'https://different.example/v1', model: 'other' }, env), /API/);
  assert.throws(() => resolveAIConfig({ baseUrl: 'http://different.example/v1', apiKey: 'own', model: 'other' }, env), /HTTPS/);
  assert.equal(resolveAIConfig({ baseUrl: 'https://different.example/v1', apiKey: 'own', model: 'other' }, env).apiKey, 'own');
});

test('AI extraction validates actual source references and preserves exact supplied messages', async () => {
  const input = { text: '用户：先选 A。\nAI：还可以考虑 B。', title: '选择', platform: '粘贴', mode: 'ai', api: { baseUrl: 'https://model.example/v1', apiKey: 'test-key', model: 'test-model' } };
  const result = {
    title: '选择', description: '待核查', nodes: [
      { id: 'root', label: '选择', type: 'topic', stance: 'unknown', status: 'open', sourceIds: [], parentId: null },
      { id: 'a', label: '先选 A', type: 'claim', stance: 'user', status: 'confirmed', sourceIds: ['m-1'], parentId: 'root' },
    ], edges: [{ id: 'r1', source: 'root', target: 'a', type: 'contains' }],
  };
  const mock = async (url, init) => {
    assert.equal(url, 'https://model.example/v1/chat/completions');
    const body = JSON.parse(init.body);
    assert.equal(body.messages[0].role, 'system');
    assert.deepEqual(JSON.parse(body.messages[1].content).messages.map(m => m.role), ['user', 'assistant']);
    assert.equal(init.redirect, 'error');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
  };
  const graph = await extractConversation(input, { fetchImpl: mock, env: {} });
  assert.equal(graph.mode, 'ai');
  assert.equal(graph.messages[0].content, '先选 A。');
  result.nodes[1].sourceIds = ['invented'];
  await assert.rejects(() => extractConversation(input, { fetchImpl: mock, env: {} }), /引用校验/);
  result.nodes[1].sourceIds = ['m-2'];
  result.nodes[1].status = 'proposed';
  await assert.rejects(() => extractConversation(input, { fetchImpl: mock, env: {} }), /用户观点没有用户原文/);
  result.nodes[1].stance = 'ai';
  result.nodes[1].status = 'confirmed';
  await assert.rejects(() => extractConversation(input, { fetchImpl: mock, env: {} }), /缺少用户原文/);
});

test('model truncation and malformed output are surfaced without pretending success', async () => {
  const input = { text: '用户：测试', api: { apiKey: 'test', model: 'test', baseUrl: 'https://model.example/v1' } };
  await assert.rejects(() => extractConversation(input, { env: {}, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'length' }] }) }), /截断/);
  await assert.rejects(() => extractConversation(input, { env: {}, fetchImpl: async () => Response.json({ choices: [{ message: { content: 'not-json' } }] }) }), /有效 JSON/);
});

test('Archify HTML exports retain semantic nodes, full source, attribution and escaped user text', async () => {
  const graph = createDemoGraph();
  const attack = '<script>alert("x")</script> $&';
  graph.title = attack;
  graph.nodes[1].label = attack;
  graph.messages[0].content = attack;
  const html = await renderGraphHtml(graph);
  assert.ok(html.includes('archify-i18n-data'));
  assert.ok(html.includes('data-node-id="demo-pain"'));
  assert.ok(html.includes('cg-source-demo-m1'));
  assert.ok(html.includes('Copyright (c) 2026 tt-a1i'));
  assert.ok(html.includes('SIL OPEN FONT LICENSE'));
  assert.ok(!html.includes(attack));
  assert.ok(html.includes('&lt;script&gt;'));
  const svg = renderGraphSvg(graph);
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('data-edge-from='));
  const layout = layoutGraph(graph);
  assert.equal(new Set(layout.nodes.map(node => `${node.x},${node.y}`)).size, graph.nodes.length);
});
