import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccessControl } from '../lib/access.mjs';
import { createAppServer } from '../server.mjs';

const env = { CHATGRAPH_PUBLIC_ORIGIN: 'https://workspace.example', CHATGRAPH_AUTH_PASSWORD: 'synthetic-workspace-password' };
const requestFor = (peer, forwarded) => ({ socket: { remoteAddress: peer }, headers: { 'cf-connecting-ip': forwarded, 'x-forwarded-for': '203.0.113.200' } });

test('Cloudflare client identity is used only with explicit loopback proxy trust', () => {
  for (const mode of [undefined, '', 'true', 'cloudflare', 'anything']) {
    const control = createAccessControl({ CHATGRAPH_TRUST_PROXY: mode });
    assert.equal(control.loginAddress(requestFor('127.0.0.1', '203.0.113.1')), '127.0.0.1');
  }
  const control = createAccessControl({ CHATGRAPH_TRUST_PROXY: 'loopback-cloudflare' });
  for (const peer of ['192.0.2.1', '10.0.0.1', '172.18.0.2', '::ffff:192.0.2.1', '2001:db8::1']) {
    assert.equal(control.loginAddress(requestFor(peer, '203.0.113.1')), peer);
  }
  for (const peer of ['127.0.0.1', '127.0.0.2', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.equal(control.loginAddress(requestFor(peer, '203.0.113.1')), '203.0.113.1');
  }
});

test('only one valid IPv4 or IPv6 value is trusted and equivalent IPv6 spellings share a rate key', () => {
  const control = createAccessControl({ CHATGRAPH_TRUST_PROXY: 'loopback-cloudflare' });
  for (const value of [undefined, '', 'unknown', '203.0.113.1, 203.0.113.2', ['203.0.113.1'], '203.0.113.1:443', '[2001:db8::1]', 'fe80::1%lo0', '256.1.1.1', '127.1', 'https://203.0.113.1']) {
    assert.equal(control.loginAddress(requestFor('127.0.0.1', value)), '127.0.0.1');
  }
  assert.equal(control.loginAddress(requestFor('::1', ' 203.0.113.7 ')), '203.0.113.7');
  assert.equal(control.loginAddress(requestFor('::1', '2001:0DB8:0000:0000:0000:0000:0000:0001')), '2001:db8::1');
  assert.equal(control.loginAddress(requestFor('::1', '2001:db8::1')), '2001:db8::1');
});

test('failed attempts from one trusted Cloudflare IP cannot lock out another visitor through the login endpoint', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-proxy-login-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const server = createAppServer({ dataDir, env: { ...env, CHATGRAPH_TRUST_PROXY: 'loopback-cloudflare' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const login = (ip, password) => new Promise((resolve, reject) => {
    const call = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/login', method: 'POST',
      headers: { Host: 'workspace.example', Origin: env.CHATGRAPH_PUBLIC_ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    call.on('error', reject); call.end(JSON.stringify({ password }));
  });
  for (let index = 0; index < 5; index++) assert.equal(await login('203.0.113.1', 'wrong'), 401);
  assert.equal(await login('203.0.113.1', env.CHATGRAPH_AUTH_PASSWORD), 429);
  assert.equal(await login('2001:db8::2', env.CHATGRAPH_AUTH_PASSWORD), 200);
  assert.equal(await login('203.0.113.2', env.CHATGRAPH_AUTH_PASSWORD), 200);
});

test('without proxy trust spoofing a forwarded header cannot bypass the socket rate limit', () => {
  const control = createAccessControl(env);
  for (let index = 0; index < 5; index++) {
    const address = control.loginAddress(requestFor('127.0.0.1', `203.0.113.${index + 1}`));
    assert.throws(() => control.login('wrong', address), error => error.status === 401);
  }
  assert.throws(() => control.login(env.CHATGRAPH_AUTH_PASSWORD, control.loginAddress(requestFor('127.0.0.1', '203.0.113.200'))), error => error.status === 429);
});
