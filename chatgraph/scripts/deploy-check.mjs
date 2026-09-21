// Docker smoke test uses only synthetic data and a disposable volume/password.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const id = randomUUID().slice(0, 8);
const image = `chatgraph-verify:${id}`, container = `chatgraph-verify-${id}`, volume = `chatgraph-verify-${id}`;
const password = `synthetic-test-${randomUUID()}`;
const docker = async args => (await execute('docker', args, { cwd: root, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let base, cookie;
// Node fetch deliberately overwrites Host; exercise the proxy's actual Host
// forwarding with http.request instead of weakening the app's host check.
const request = (route, { method = 'GET', body, authenticated = true } = {}) => new Promise((resolve, reject) => {
  const call = http.request(`${base}${route}`, {
    method, headers: { Host: 'workspace.test', Origin: 'https://workspace.test', ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(15_000),
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('error', reject);
    response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) })));
  });
  call.on('error', reject);
  call.end(body ? JSON.stringify(body) : undefined);
});
async function ready() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await request('/api/health')).ok) return; } catch {}
    await delay(250);
  }
  throw new Error('Container did not become ready within 60 seconds');
}
async function login() {
  const response = await request('/api/login', { method: 'POST', body: { password }, authenticated: false });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
}
try {
  await docker(['build', '-f', 'chatgraph/deploy/Dockerfile', '-t', image, '.']);
  console.log('PASS runtime-only Docker image builds');
  await docker(['volume', 'create', volume]);
  await docker(['run', '--detach', '--name', container, '--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=1g', '--pids-limit=128', '--cpus=2', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m', '--publish', '127.0.0.1::4317', '--mount', `type=volume,src=${volume},dst=/data`, '-e', 'CHATGRAPH_HOST=0.0.0.0', '-e', 'CHATGRAPH_PUBLIC_ORIGIN=https://workspace.test', '-e', `CHATGRAPH_AUTH_PASSWORD=${password}`, image]);
  base = `http://${(await docker(['port', container, '4317/tcp'])).split('\n')[0]}`;
  await ready();
  await docker(['exec', container, 'node', 'chatgraph/deploy/healthcheck.mjs']);
  await docker(['exec', container, 'node', '--input-type=module', '-e', "import fs from 'node:fs'; if(process.getuid()===0)throw Error('root'); for(const p of ['.env','.data','mobile/android','mobile/ios','test-output','node_modules'])if(fs.existsSync('/app/chatgraph/'+p))throw Error('unexpected build context');"]);
  assert.equal((await request('/api/graphs', { authenticated: false })).status, 401);
  await login();
  console.log('PASS non-root read-only runtime, private build exclusions, health and authentication');
  const graph = await (await request('/api/demo')).json();
  const savedResponse = await request('/api/graphs', { method: 'POST', body: graph });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  const jobId = randomUUID();
  assert.equal((await request('/api/jobs', { method: 'POST', body: { id: jobId, kind: 'import', input: { text: 'User: 测试重启后任务回执仍在\nAssistant: 本次不调用模型', mode: 'outline' } } })).status, 202);
  const jobDeadline = Date.now() + 15_000;
  let job;
  do { job = await (await request(`/api/jobs/${jobId}`)).json(); if (job.status === 'completed') break; await delay(100); } while (Date.now() < jobDeadline);
  assert.equal(job.status, 'completed');
  await docker(['restart', container]);
  // An ephemeral published port may be reassigned after a Docker restart.
  base = `http://${(await docker(['port', container, '4317/tcp'])).split('\n')[0]}`;
  await ready();
  assert.equal((await request('/api/graphs')).status, 401);
  await login();
  assert.deepEqual(await (await request(`/api/graphs/${saved.id}`)).json(), saved);
  assert.equal((await (await request(`/api/jobs/${jobId}`)).json()).status, 'completed');
  assert.equal((await request('/api/export', { method: 'POST', body: { graph: saved, format: 'html' } })).status, 200);
  console.log('PASS durable graphs, task receipts, re-login and HTML export after container restart');
  await docker(['stop', container]);
  const offline = args => docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--mount', `type=volume,src=${volume},dst=/data`, image, 'node', 'chatgraph/scripts/data-snapshot.mjs', ...args]);
  // Exercise the offline commands with separate sibling directories on this
  // disposable volume. The real deployment guide uses an external backup mount.
  await docker(['run', '--rm', '--network=none', '--mount', `type=volume,src=${volume},dst=/data`, image, 'node', '--input-type=module', '-e', "import fs from 'node:fs/promises'; await fs.mkdir('/data/source'); for(const e of await fs.readdir('/data')) if(e!=='source') await fs.rename('/data/'+e,'/data/source/'+e);"]);
  const backup = JSON.parse(await offline(['backup', '--data-dir', '/data/source', '--output', '/data/snapshot', '--stopped']));
  const verified = JSON.parse(await offline(['verify', '--snapshot', '/data/snapshot']));
  const restored = JSON.parse(await offline(['restore', '--snapshot', '/data/snapshot', '--data-dir', '/data/restored', '--stopped']));
  assert.equal(backup.files, verified.files); assert.equal(backup.files, restored.files);
  console.log('PASS full data snapshot verification and restore on the persistent Docker volume');
} catch (error) {
  console.error(await docker(['logs', container]).catch(() => 'Container unavailable'));
  throw error;
} finally {
  await docker(['rm', '--force', container]).catch(() => {});
  await docker(['volume', 'rm', volume]).catch(() => {});
  await docker(['image', 'rm', image]).catch(() => {});
}
