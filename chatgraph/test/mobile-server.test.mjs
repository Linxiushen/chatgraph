import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server.mjs';

test('mobile installation assets work before login while workspace data stays protected', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chatgraph-mobile-hosted-'));
  const server = createAppServer({ dataDir, env: { CHATGRAPH_PUBLIC_ORIGIN: 'https://phone.example', CHATGRAPH_AUTH_PASSWORD: 'mobile-test-password-long' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method: options.method || 'GET', headers: { Host: 'phone.example', ...options.headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(options.body);
  });
  for (const route of ['/manifest.webmanifest', '/service-worker.js', '/mobile.js', '/mobile-inbox.html', '/mobile-inbox.js', '/mobile-inbox.css', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/mobile-assets/safari-shortcut.js']) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.notEqual(response.headers['cache-control'], 'public', route);
  }
  const manifest = await request('/manifest.webmanifest');
  assert.match(manifest.headers['content-type'], /application\/manifest\+json/);
  assert.equal(JSON.parse(manifest.body).share_target.method, 'POST');
  assert.match((await request('/service-worker.js')).headers['content-security-policy'], /worker-src 'self'/);
  assert.match((await request('/mobile-assets/safari-shortcut.js')).headers['content-disposition'], /attachment/);
  for (const route of ['/', '/app.js', '/import-model.js']) assert.equal((await request(route)).status, 302, route);
  for (const route of ['/api/config', '/api/graphs', '/api/backup']) assert.equal((await request(route)).status, 401, route);
  const login = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://phone.example' }, body: JSON.stringify({ password: 'mobile-test-password-long' }) });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
  assert.equal((await request('/api/graphs', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await request('/api/graphs', { headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status, 403);
  const missedShare = await request('/mobile-share', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'PRIVATE_SHARE_MUST_NOT_BE_REFLECTED' });
  assert.equal(missedShare.status, 405);
  assert.ok(!missedShare.body.includes('PRIVATE_SHARE_MUST_NOT_BE_REFLECTED'));
  assert.equal((await request('/mobile-assets/../.env')).status, 302);
});
