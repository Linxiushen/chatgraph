import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJobQueue } from '../lib/jobs.mjs';
import { createGraphStore } from '../lib/store.mjs';
import { organizeConversation } from '../lib/conversations.mjs';
import { createShareStore } from '../lib/shares.mjs';

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgraph-reliability-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('retrying a UUID with a damaged receipt never starts a duplicate model call', async t => {
  const dataDir = await temporaryDirectory(t);
  await fs.mkdir(path.join(dataDir, '.jobs'));
  let calls = 0;
  const queue = createJobQueue({ dataDir, run: async () => { calls++; return { ok: true }; } });
  t.after(() => queue.close());
  for (const contents of ['{truncated', 'null', '{}', JSON.stringify({ id: randomUUID(), status: 'completed' })]) {
    const id = randomUUID();
    const receipt = path.join(dataDir, '.jobs', `${id}.json`);
    await fs.writeFile(receipt, contents);
    await assert.rejects(queue.get(id), error => error.status === 422);
    await assert.rejects(queue.create('import', { text: 'User: preserve one paid request' }, id), error => error.status === 422);
    assert.equal(await fs.readFile(receipt, 'utf8'), contents, 'keep the original receipt for recovery');
  }
  assert.equal(calls, 0);
});

test('an inaccessible receipt cannot be mistaken for a missing job', async t => {
  const dataDir = await temporaryDirectory(t);
  const id = randomUUID();
  await fs.mkdir(path.join(dataDir, '.jobs', `${id}.json`), { recursive: true });
  let calls = 0;
  const queue = createJobQueue({ dataDir, run: async () => { calls++; return { ok: true }; } });
  t.after(() => queue.close());
  await assert.rejects(queue.get(id), error => error.status === 503);
  await assert.rejects(queue.create('import', { text: 'User: wait for storage recovery' }, id), error => error.status === 503);
  assert.equal(calls, 0);
});

test('cancelling a queued job admits its replacement without executing the cancelled input', async t => {
  const dataDir = await temporaryDirectory(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const queue = createJobQueue({ dataDir, run: async (kind, input) => {
    calls.push(input.text); await gate; return { title: input.text };
  } });
  try {
    const first = await queue.create('import', { text: 'running' });
    const pending = [];
    for (let index = 0; index < 5; index++) pending.push(await queue.create('import', { text: `queued-${index}` }));
    assert.equal((await queue.cancel(pending[2].id)).status, 'cancelled');
    const replacement = await queue.create('import', { text: 'replacement' });
    await assert.rejects(queue.create('import', { text: 'overflow' }), error => error.status === 429);
    release();
    const jobs = [first, ...pending, replacement];
    const deadline = Date.now() + 5_000;
    while ((await Promise.all(jobs.map(job => queue.get(job.id)))).some(job => ['queued', 'running'].includes(job.status))) {
      assert.ok(Date.now() < deadline, 'the worker must drain all noncancelled jobs');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.deepEqual(calls, ['running', 'queued-0', 'queued-1', 'queued-3', 'queued-4', 'replacement']);
    const restarted = createJobQueue({ dataDir, run: async () => assert.fail('a cancelled UUID must not run again') });
    try { assert.equal((await restarted.create('import', { text: 'queued-2' }, pending[2].id)).status, 'cancelled'); }
    finally { restarted.close(); }
  } finally { release(); queue.close(); }
});

test('search stays available when another tab deletes a graph during the library scan', async t => {
  const dataDir = await temporaryDirectory(t);
  const store = createGraphStore({ dataDir });
  const base = organizeConversation({ text: 'User: 真实用户访谈', title: '真实用户研究' });
  await store.save({ ...base, id: 'a-delete-during-scan' });
  await store.save({ ...base, id: 'b-keep-during-scan' });
  await fs.writeFile(path.join(dataDir, 'c-needs-recovery.json'), '{broken');
  const originalRead = fs.readFile;
  let deleted = false;
  fs.readFile = async function (file, ...args) {
    if (!deleted && file === path.join(dataDir, 'b-keep-during-scan.json')) {
      deleted = true;
      await fs.unlink(path.join(dataDir, 'a-delete-during-scan.json'));
    }
    return originalRead.call(this, file, ...args);
  };
  try {
    const results = await store.search('真实用户');
    assert.ok(results.some(item => item.id === 'b-keep-during-scan'));
    assert.ok(results.every(item => !item.recoveryRequired));
    assert.ok(results.every(item => item.messages[0].excerpt.includes('真实用户')));
  } finally { fs.readFile = originalRead; }
  assert.equal(deleted, true);
  const entries = await store.list();
  assert.deepEqual(entries.map(item => item.id).sort(), ['b-keep-during-scan', 'c-needs-recovery']);
  assert.equal(entries.find(item => item.id === 'c-needs-recovery').recoveryRequired, true);
  await assert.rejects(store.backup(), error => error.status === 422);
});

test('a failed atomic replacement preserves the original graph and leaves no temporary partial share', async t => {
  const dataDir = await temporaryDirectory(t);
  const store = createGraphStore({ dataDir });
  const graph = await store.save(organizeConversation({ text: 'User: 原来的可靠版本' }));
  const file = path.join(dataDir, `${graph.id}.json`);
  const original = await fs.readFile(file, 'utf8');
  const shares = createShareStore({ dataDir });
  const originalRename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === file || to.startsWith(path.join(dataDir, '.shares'))) throw Object.assign(new Error('injected disk failure'), { code: 'EIO' });
    return originalRename(from, to);
  };
  try {
    await assert.rejects(store.save({ ...graph, title: '尚未写入的新内容' }), error => error.code === 'EIO');
    assert.equal(await fs.readFile(file, 'utf8'), original);
    await assert.rejects(shares.create({ graph }), error => error.code === 'EIO');
    assert.deepEqual(await shares.list(), []);
    assert.ok((await fs.readdir(dataDir)).every(name => !name.endsWith('.tmp')));
    assert.ok((await fs.readdir(path.join(dataDir, '.shares'))).every(name => !name.endsWith('.tmp')));
  } finally { fs.rename = originalRename; }
  assert.equal((await store.save({ ...graph, title: '故障恢复后的内容' })).title, '故障恢复后的内容');
});

test('damaged share expiry never makes a snapshot permanent and revocation still works', async t => {
  const dataDir = await temporaryDirectory(t);
  const shares = createShareStore({ dataDir });
  const shared = await shares.create({ graph: organizeConversation({ text: 'User: 分享快照' }) });
  const file = path.join(dataDir, '.shares', `${shared.token}.json`);
  const damaged = { ...JSON.parse(await fs.readFile(file, 'utf8')), expiresAt: 'invalid date' };
  await fs.writeFile(file, JSON.stringify(damaged));
  await assert.rejects(shares.load(shared.token), error => error.status === 422);
  assert.equal(await fs.readFile(file, 'utf8'), JSON.stringify(damaged));
  assert.deepEqual(await shares.list(), []);
  assert.equal((await shares.remove(shared.token)).ok, true);
  await assert.rejects(shares.load(shared.token), error => error.status === 404);
});

test('share revocation waits for durable deletion and retries the directory flush after a failure', async t => {
  if (process.platform === 'win32') return t.skip('Node cannot fsync directories on Windows');
  const dataDir = await temporaryDirectory(t);
  const shares = createShareStore({ dataDir });
  const shared = await shares.create({ graph: organizeConversation({ text: 'User: 必须持久撤回' }) });
  const originalOpen = fs.open;
  let flushes = 0;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === path.join(dataDir, '.shares')) {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => {
        flushes++;
        if (flushes === 1) throw Object.assign(new Error('injected directory sync failure'), { code: 'EIO' });
        return originalSync();
      };
    }
    return handle;
  };
  try {
    await assert.rejects(shares.remove(shared.token), error => error.code === 'EIO');
    assert.equal((await shares.remove(shared.token)).ok, true);
    assert.equal(flushes, 2, 'idempotent retry still durably records an absent token');
    await assert.rejects(shares.load(shared.token), error => error.status === 404);
  } finally { fs.open = originalOpen; }
});

test('web backups reject libraries larger than the restore endpoint without silently dropping graphs', async t => {
  const dataDir = await temporaryDirectory(t);
  const graph = organizeConversation({ text: 'User: 网页备份容量' });
  graph.messages = Array.from({ length: 20 }, (_, index) => ({ id: index ? `source-${index}` : 'm-1', role: 'user', content: '中'.repeat(100000) }));
  for (let index = 0; index < 9; index++) {
    const id = `backup-size-${index}`;
    await fs.writeFile(path.join(dataDir, `${id}.json`), JSON.stringify({ ...graph, id }));
  }
  const store = createGraphStore({ dataDir });
  await assert.rejects(store.backup(), error => error.status === 413 && /50 MiB.*全量数据目录备份/.test(error.message));
  assert.equal((await store.list()).length, 9);
  assert.equal((await store.load('backup-size-8')).messages[19].content, graph.messages[19].content);
});
