import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { createDemoGraph } from '../lib/demo.mjs';
import { createAccessControl } from '../lib/access.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chatgraph-v2-'));
  const server = createAppServer({ dataDir, env: {}, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, body, method) => fetch(base + route, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { dataDir, base, request };
}

test('history restore, stale writes, append and backup endpoints preserve authored work', async t => {
  const { request } = await fixture(t);
  const original = await (await request('/api/graphs', createDemoGraph())).json();
  const changed = structuredClone(original); changed.nodes[1].note = '保留我的人工修改';
  const saved = await (await request('/api/graphs', changed)).json();
  assert.equal((await request('/api/graphs', original)).status, 409);
  const history = await (await request(`/api/graphs/${saved.id}/history`)).json();
  assert.deepEqual(history.map(row => row.version), [2, 1]);
  const restored = await (await request(`/api/graphs/${saved.id}/restore`, { version: 1, expectedRevision: 2 })).json();
  assert.equal(restored.revision, 3);
  const appended = await (await request('/api/append', { graph: saved, text: '用户：新增独立判断。', mode: 'outline' })).json();
  assert.equal(appended.nodes[1].note, '保留我的人工修改');
  assert.equal(appended.messages.length, saved.messages.length + 1); assert.equal(appended.sessions.length, 2);
  const backup = await (await request('/api/backup')).json();
  const imported = await (await request('/api/backup', { backup })).json();
  assert.equal(imported.count, 1); assert.notEqual(imported.restored[0].id, saved.id);
});

test('share snapshots omit sources by default and revoke without modifying saved graphs', async t => {
  const { request } = await fixture(t);
  const graph = createDemoGraph(); graph.messages[0].content = 'PRIVATE-SOURCE-UNIQUE'; graph.nodes[1].note = 'PRIVATE-NOTE-UNIQUE';
  const shared = await (await request('/api/shares', { graph, expiresInDays: 1 })).json();
  assert.equal(shared.scope, 'local');
  const html = await (await fetch(shared.url)).text();
  assert.ok(!html.includes('PRIVATE-SOURCE-UNIQUE')); assert.ok(!html.includes('PRIVATE-NOTE-UNIQUE'));
  const withSource = await (await request('/api/shares', { graph, includeSources: true })).json();
  assert.ok((await (await fetch(withSource.url)).text()).includes('PRIVATE-SOURCE-UNIQUE'));
  assert.equal((await (await request('/api/shares')).json()).length, 2);
  await request(`/api/shares/${shared.token}`, undefined, 'DELETE');
  assert.equal((await fetch(shared.url)).status, 404);
});

test('background jobs return actual results and persist no API key', async t => {
  const { request, dataDir } = await fixture(t, { fetchImpl: async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    title: '测试', nodes: [{ id: 'root', label: '测试', type: 'topic', stance: 'unknown', status: 'open', sourceIds: [], parentId: null }], edges: [],
  }) }, finish_reason: 'stop' }] }) });
  const created = await (await request('/api/jobs', { kind: 'import', input: { text: '用户：测试', mode: 'ai', api: { baseUrl: 'https://example.test', apiKey: 'PRIVATE-KEY-ONLY-IN-MEMORY', model: 'test' } } })).json();
  let job;
  for (let i = 0; i < 50; i++) {
    job = await (await request(`/api/jobs/${created.id}`)).json();
    if (['completed', 'failed'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(job.status, 'completed'); assert.equal(job.result.mode, 'ai');
  for (const name of (await readdir(path.join(dataDir, '.jobs'))).filter(name => name.endsWith('.json'))) assert.ok(!(await readFile(path.join(dataDir, '.jobs', name), 'utf8')).includes('PRIVATE-KEY-ONLY-IN-MEMORY'));
});

test('cancellation prevents a late model result from becoming a successful job', async t => {
  const { request } = await fixture(t, { fetchImpl: async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })) });
  const job = await (await request('/api/jobs', { kind: 'import', input: { text: '用户：测试', mode: 'ai', api: { baseUrl: 'https://example.test', apiKey: 'test', model: 'test' } } })).json();
  const cancelled = await (await request(`/api/jobs/${job.id}`, undefined, 'DELETE')).json();
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.result, undefined);
});

test('hosted mode requires HTTPS/password and sessions expire on logout', () => {
  assert.throws(() => createAccessControl({ CHATGRAPH_PUBLIC_ORIGIN: 'http://example.test' }), /HTTPS/);
  assert.throws(() => createAccessControl({ CHATGRAPH_PUBLIC_ORIGIN: 'https://example.test' }), /16/);
  const control = createAccessControl({ CHATGRAPH_PUBLIC_ORIGIN: 'https://example.test', CHATGRAPH_AUTH_PASSWORD: 'long-test-password-only' });
  assert.equal(control.authenticated({ headers: {} }), false);
  assert.throws(() => control.login('wrong'), /密码/);
  const cookie = control.login('long-test-password-only');
  const req = { headers: { cookie } };
  assert.equal(control.authenticated(req), true); assert.equal(control.validOrigin('https://evil.test', 'example.test'), false);
  assert.equal(control.validHost('example.test', 4317), true); assert.equal(control.validHost('evil.test', 4317), false);
  control.logout(req); assert.equal(control.authenticated(req), false);
});
