import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJobQueue } from '../lib/jobs.mjs';
import { randomUUID } from 'node:crypto';

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
