import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/phone-preview.mjs', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(read, message) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(20);
  }
  assert.fail(message);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function fixture(t, { ignoreTerm = false, exitAfterURL = false } = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'chatgraph-preview-test-'));
  const stateDir = path.join(directory, 'state');
  const childReceipt = path.join(directory, 'fake-tunnel.json');
  const cloudflared = path.join(directory, 'fake-cloudflared');
  const privateConfig = path.join(directory, 'synthetic.env');
  await fs.writeFile(privateConfig, 'CHATGRAPH_MODEL=synthetic-model\n', { mode: 0o600 });
  await fs.writeFile(cloudflared, `#!${process.execPath}\n` + `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(childReceipt)}, JSON.stringify({ pid: process.pid, env: process.env }));
process.on('SIGTERM', () => { ${ignoreTerm ? '' : 'process.exit(0);'} });
console.error('https://synthetic-preview.trycloudflare.com');
${exitAfterURL ? 'setTimeout(() => process.exit(9), 30);' : 'setInterval(() => {}, 1000);'}
`, { mode: 0o700 });
  const children = [];
  function start(port, state = stateDir) {
    const child = spawn(process.execPath, [script, '--cloudflared', cloudflared, '--state-dir', state, '--port', String(port), '--private-config', privateConfig], {
      env: { PATH: process.env.PATH, HOME: directory, TMPDIR: tmpdir(), CHATGRAPH_API_KEY: 'synthetic-provider-key', GH_TOKEN: 'synthetic-unrelated-token' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const ended = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const result = { child, ended, output: () => output };
    children.push(result);
    return result;
  }
  async function status() {
    try { return JSON.parse(await fs.readFile(path.join(stateDir, 'status.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  t.after(async () => {
    for (const { child, ended } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 9000);
      try { await ended; } finally { clearTimeout(force); }
    }
    // Only a synthetic child PID written by this fixture may be cleaned up.
    try { const receipt = JSON.parse(await fs.readFile(childReceipt, 'utf8')); if (alive(receipt.pid)) process.kill(receipt.pid, 'SIGKILL'); } catch {}
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, stateDir, childReceipt, start, status };
}
const requestStatus = (port, route = '/api/health', body) => new Promise((resolve, reject) => {
  const request = http.request({ hostname: '127.0.0.1', port, path: route, method: body ? 'POST' : 'GET', headers: {
    Host: 'synthetic-preview.trycloudflare.com', ...(body ? { 'Content-Type': 'application/json' } : {}),
  } }, response => {
    response.resume(); response.on('end', () => resolve(response.statusCode));
  });
  request.on('error', reject);
  request.end(body ? JSON.stringify(body) : undefined);
});
const health = port => requestStatus(port);

test('preview starts one protected workspace, blocks duplicate state ownership and keeps provider secrets out of the tunnel', async t => {
  const f = await fixture(t);
  const port = await freePort();
  const first = f.start(port);
  await waitFor(async () => (await f.status())?.state === 'listening', 'preview should listen');
  assert.equal(await health(port), 200);
  assert.equal(await requestStatus(port, '/api/graphs'), 401);
  const beforeStatus = await fs.readFile(path.join(f.stateDir, 'status.json'), 'utf8');
  const beforeCredentials = await fs.readFile(path.join(f.stateDir, 'credentials.json'), 'utf8');
  const second = f.start(await freePort());
  assert.equal((await second.ended).code, 1);
  assert.match(second.output(), /already owns|locked/);
  assert.equal(await fs.readFile(path.join(f.stateDir, 'status.json'), 'utf8'), beforeStatus);
  assert.equal(await fs.readFile(path.join(f.stateDir, 'credentials.json'), 'utf8'), beforeCredentials);
  assert.equal(await requestStatus(port, '/api/login', { password: JSON.parse(beforeCredentials).password }), 200);
  const tunnel = JSON.parse(await fs.readFile(f.childReceipt, 'utf8'));
  assert.equal(tunnel.env.CHATGRAPH_API_KEY, undefined);
  assert.equal(tunnel.env.GH_TOKEN, undefined);
  assert.ok(!first.output().includes('synthetic-provider-key'));
  assert.ok(!beforeStatus.includes('synthetic-provider-key'));
  first.child.kill('SIGTERM');
  assert.equal((await first.ended).code, 0);
  assert.equal((await f.status()).state, 'stopped');
  assert.equal(alive(tunnel.pid), false);
  await assert.rejects(fs.access(path.join(f.stateDir, 'preview.lock')), error => error.code === 'ENOENT');
});

test('simultaneous initial launches preserve the winning password and state', async t => {
  const f = await fixture(t);
  const starts = [f.start(await freePort()), f.start(await freePort())];
  await waitFor(async () => (await f.status())?.state === 'listening', 'one contender should start');
  const status = await f.status();
  const winner = starts.find(item => item.child.pid === status.pid);
  const loser = starts.find(item => item !== winner);
  assert.ok(winner);
  assert.equal((await loser.ended).code, 1);
  const credentials = await fs.readFile(path.join(f.stateDir, 'credentials.json'), 'utf8');
  assert.equal(JSON.parse(credentials).password.length >= 16, true);
  assert.equal((await f.status()).pid, winner.child.pid);
  assert.equal(await health(status.port), 200);
  assert.equal(await requestStatus(status.port, '/api/login', { password: JSON.parse(credentials).password }), 200);
});

test('a live legacy preview is protected even when it has no instance lock', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.stateDir);
  const legacy = JSON.stringify({ state: 'listening', pid: process.pid, origin: 'https://legacy.trycloudflare.com' });
  await fs.writeFile(path.join(f.stateDir, 'status.json'), legacy);
  const started = f.start(await freePort());
  assert.equal((await started.ended).code, 1);
  assert.match(started.output(), /already owns/);
  assert.equal(await fs.readFile(path.join(f.stateDir, 'status.json'), 'utf8'), legacy);
  await assert.rejects(fs.access(f.childReceipt), error => error.code === 'ENOENT');
});

test('shutdown kills a tunnel that ignores SIGTERM instead of leaving an orphan', async t => {
  const f = await fixture(t, { ignoreTerm: true });
  const started = f.start(await freePort());
  await waitFor(async () => (await f.status())?.state === 'listening', 'preview should listen');
  const tunnel = JSON.parse(await fs.readFile(f.childReceipt, 'utf8'));
  started.child.kill('SIGTERM');
  assert.equal((await started.ended).code, 0);
  assert.equal(alive(tunnel.pid), false);
  assert.equal((await f.status()).state, 'stopped');
});

test('unexpected tunnel exit closes the workspace and releases its own lock', async t => {
  const f = await fixture(t, { exitAfterURL: true });
  const port = await freePort();
  const started = f.start(port);
  assert.equal((await started.ended).code, 9);
  assert.equal((await f.status()).state, 'stopped');
  await assert.rejects(health(port), error => error.code === 'ECONNREFUSED');
  await assert.rejects(fs.access(path.join(f.stateDir, 'preview.lock')), error => error.code === 'ENOENT');
});

test('a symlinked data directory cannot expose a different local workspace', async t => {
  const f = await fixture(t);
  const privateWorkspace = path.join(f.directory, 'unrelated-private-workspace');
  await fs.mkdir(privateWorkspace); await fs.mkdir(f.stateDir);
  await fs.symlink(privateWorkspace, path.join(f.stateDir, 'data'), 'dir');
  const started = f.start(await freePort());
  assert.equal((await started.ended).code, 1);
  assert.match(started.output(), /symbolic links/);
  await assert.rejects(fs.access(f.childReceipt), error => error.code === 'ENOENT');
  assert.deepEqual(await fs.readdir(privateWorkspace), []);
});

test('an occupied preview port fails cleanly without leaving a tunnel or owned lock behind', async t => {
  const f = await fixture(t);
  const blocker = net.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const started = f.start(blocker.address().port);
  assert.equal((await started.ended).code, 1);
  assert.equal((await f.status()).state, 'stopped');
  const tunnel = JSON.parse(await fs.readFile(f.childReceipt, 'utf8'));
  assert.equal(alive(tunnel.pid), false);
  await assert.rejects(fs.access(path.join(f.stateDir, 'preview.lock')), error => error.code === 'ENOENT');
});

test('an interrupted instance lock is preserved until an operator verifies it', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.stateDir);
  const lockFile = path.join(f.stateDir, 'preview.lock');
  const interrupted = JSON.stringify({ pid: 2147483647, token: 'synthetic-interrupted-owner' });
  await fs.writeFile(lockFile, interrupted);
  const started = f.start(await freePort());
  assert.equal((await started.ended).code, 1);
  assert.match(started.output(), /locked.*verify/s);
  assert.equal(await fs.readFile(lockFile, 'utf8'), interrupted);
  await assert.rejects(fs.access(f.childReceipt), error => error.code === 'ENOENT');
});
