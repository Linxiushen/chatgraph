import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJobQueue } from '../lib/jobs.mjs';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

test('concurrent admission preserves one active job plus at most five queued jobs', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-queue-bound-'));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const queue = createJobQueue({ dataDir, run: async () => { calls++; await gate; return { ok: true }; } });
  try {
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => queue.create('import', { text: 'User: admission test', mode: 'outline' })));
    const accepted = outcomes.filter(outcome => outcome.status === 'fulfilled').map(outcome => outcome.value);
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    assert.equal(accepted.length, 6);
    assert.equal(rejected.length, 6);
    assert.ok(rejected.every(outcome => outcome.reason.status === 429));
    assert.equal(calls, 1);
    release();
    // Wait for persisted completion, so cleanup never removes files under the writer.
    const deadline = Date.now() + 5000;
    for (;;) {
      const persisted = await Promise.all(accepted.map(job => readFile(path.join(dataDir, '.jobs', `${job.id}.json`), 'utf8').then(JSON.parse)));
      if (persisted.every(job => job.status === 'completed')) break;
      assert.ok(Date.now() < deadline, 'accepted jobs should drain after the worker is released');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(calls, 6);
    const next = await queue.create('import', { text: 'User: after drain', mode: 'outline' });
    assert.ok(next.id, 'a rejected admission must not poison later submissions');
    while ((await readFile(path.join(dataDir, '.jobs', `${next.id}.json`), 'utf8').then(JSON.parse)).status !== 'completed') {
      assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5));
    }
  } finally { release(); queue.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('client UUID is idempotent across simultaneous submissions and service restarts', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-idempotent-'));
  let calls = 0;
  const run = async () => { calls++; return { title: '一次真实生成' }; };
  const queue = createJobQueue({ dataDir, run });
  const id = randomUUID();
  try {
    const records = await Promise.all(Array.from({ length: 4 }, () => queue.create('import', { text: 'User: one request' }, id)));
    assert.ok(records.every(record => record.id === id));
    const deadline = Date.now() + 3000;
    while ((await readFile(path.join(dataDir, '.jobs', `${id}.json`), 'utf8').then(JSON.parse)).status !== 'completed') {
      assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5));
    }
    queue.close();
    const restarted = createJobQueue({ dataDir, run });
    const found = await restarted.create('import', { text: 'User: one request' }, id);
    assert.equal(found.status, 'completed'); assert.equal(found.result.title, '一次真实生成');
    assert.equal(calls, 1);
    await assert.rejects(restarted.create('append', {}, id), error => error.status === 409);
    restarted.close();
  } finally { queue.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('one UUID cannot return a different conversation result, including after restart', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-request-identity-'));
  let calls = 0;
  const run = async () => { calls++; return { title: '原始结果' }; };
  const queue = createJobQueue({ dataDir, run });
  const id = randomUUID();
  t.after(async () => { queue.close(); await rm(dataDir, { recursive: true, force: true }); });
  const original = { text: 'User: original', mode: 'ai', api: { model: 'test', apiKey: 'private-test-key' } };
  await queue.create('import', original, id);
  const deadline = Date.now() + 3000;
  while ((await queue.get(id)).status !== 'completed') {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5));
  }
  await assert.rejects(queue.create('import', { ...original, text: 'User: different' }, id), error => error.status === 409);
  const same = await queue.create('import', { api: { apiKey: 'rotated-test-key', model: 'test' }, mode: 'ai', text: original.text }, id);
  assert.equal(same.result.title, '原始结果', 'credential rotation and property order must not duplicate a paid job');
  assert.equal(Object.hasOwn(same, 'requestHash'), false);
  const persisted = await readFile(path.join(dataDir, '.jobs', `${id}.json`), 'utf8');
  assert.ok(!persisted.includes('private-test-key') && !persisted.includes('User: original'));
  queue.close();
  const restarted = createJobQueue({ dataDir, run });
  try {
    await assert.rejects(restarted.create('import', { ...original, text: 'User: different' }, id), error => error.status === 409);
    assert.equal((await restarted.create('import', original, id)).status, 'completed');
  } finally { restarted.close(); }
  assert.equal(calls, 1);
});

test('cancellation during the running receipt flush never starts the provider', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-cancel-before-call-'));
  const originalOpen = fs.open;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const writing = new Promise(resolve => { entered = resolve; });
  let calls = 0, opens = 0;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).startsWith(path.join(dataDir, '.jobs')) && String(args[0]).endsWith('.tmp') && ++opens === 2) {
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = async (...values) => { entered(); await gate; return originalWrite(...values); };
    }
    return handle;
  };
  const queue = createJobQueue({ dataDir, run: async () => { calls++; return { ok: true }; } });
  try {
    const created = await queue.create('import', { text: 'User: cancel during flush' });
    await writing;
    const cancelled = queue.cancel(created.id);
    release();
    assert.equal((await cancelled).status, 'cancelled');
    assert.equal((await queue.get(created.id)).status, 'cancelled');
    assert.equal(calls, 0);
  } finally { release(); fs.open = originalOpen; queue.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('polling and cancellation during initial admission wait for the live record instead of declaring a restart', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatgraph-admission-handoff-'));
  const id = randomUUID();
  const receipt = path.join(dataDir, '.jobs', `${id}.json`);
  const originalRename = fs.rename;
  let release, entered, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  const renamed = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  fs.rename = async (...args) => {
    const result = await originalRename(...args);
    if (args[1] === receipt && !held) {
      held = true;
      entered();
      // The file is visible, but its directory fsync/admission handoff is pending.
      await gate;
    }
    return result;
  };
  const queue = createJobQueue({ dataDir, run: async () => { calls++; return { ok: true }; } });
  try {
    const creating = queue.create('import', { text: 'User: cancel during admission' }, id);
    await renamed;
    assert.equal(JSON.parse(await readFile(receipt, 'utf8')).status, 'queued');
    const queried = queue.get(id);
    const cancelling = queue.cancel(id);
    release();
    const [created, polled, cancelled] = await Promise.all([creating, queried, cancelling]);
    assert.equal(created.id, id);
    assert.ok(['queued', 'running', 'cancelled'].includes(polled.status), 'a live admission must never be marked as interrupted by restart');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(calls, 0);
    assert.equal((await queue.get(id)).status, 'cancelled');
    assert.equal(JSON.parse(await readFile(receipt, 'utf8')).status, 'cancelled');
  } finally { release(); fs.rename = originalRename; queue.close(); await rm(dataDir, { recursive: true, force: true }); }
});
