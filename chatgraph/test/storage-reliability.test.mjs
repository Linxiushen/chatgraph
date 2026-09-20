import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJobQueue } from '../lib/jobs.mjs';
import { createGraphStore } from '../lib/store.mjs';
import { organizeConversation } from '../lib/conversations.mjs';

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
