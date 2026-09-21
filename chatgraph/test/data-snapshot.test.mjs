import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSnapshot, verifySnapshot, restoreSnapshot } from '../scripts/data-snapshot.mjs';
import { createGraphStore } from '../lib/store.mjs';
import { createDemoGraph } from '../lib/demo.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgraph-snapshot-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const dataDir = path.join(root, 'original');
  const store = createGraphStore({ dataDir });
  const graph = await store.save(createDemoGraph());
  const next = await store.save({ ...graph, title: '恢复演练' });
  for (const [name, body] of [['.jobs/receipt.json', '{"status":"completed"}'], ['.shares/token.json', '{"snapshot":true}'], ['.recovery/original.corrupt', 'corrupt original preserved']]) {
    await fs.mkdir(path.dirname(path.join(dataDir, name)), { recursive: true });
    await fs.writeFile(path.join(dataDir, name), body);
  }
  return { root, dataDir, next, outputDir: path.join(root, 'snapshot') };
}

test('offline full snapshot restores current graphs, revisions, task receipts and original corrupt files', async t => {
  const fixtureData = await fixture(t);
  const { root, dataDir, next, outputDir } = fixtureData;
  const result = await createSnapshot({ dataDir, outputDir, stopped: true });
  assert.ok(result.files >= 5);
  assert.equal((await verifySnapshot(outputDir)).files, result.files);
  const restoredDir = path.join(root, 'restored');
  await restoreSnapshot({ snapshotDir: outputDir, dataDir: restoredDir, stopped: true });
  const restored = createGraphStore({ dataDir: restoredDir });
  assert.deepEqual(await restored.load(next.id), next);
  assert.equal((await restored.history(next.id)).length, 2);
  assert.equal(await fs.readFile(path.join(restoredDir, '.recovery/original.corrupt'), 'utf8'), 'corrupt original preserved');
  assert.equal(await fs.readFile(path.join(restoredDir, '.jobs/receipt.json'), 'utf8'), '{"status":"completed"}');
  assert.equal((await fs.stat(path.join(outputDir, 'manifest.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(restoredDir)).mode & 0o777, 0o700);
});

test('snapshot never overwrites existing data and requires an offline acknowledgment', async t => {
  const { dataDir, outputDir } = await fixture(t);
  await assert.rejects(createSnapshot({ dataDir, outputDir }), /停止服务/);
  await assert.rejects(createSnapshot({ dataDir, outputDir: path.join(dataDir, 'backup'), stopped: true }), /之外/);
  await createSnapshot({ dataDir, outputDir, stopped: true });
  await assert.rejects(createSnapshot({ dataDir, outputDir, stopped: true }), { code: 'EEXIST' });
  await assert.rejects(restoreSnapshot({ snapshotDir: outputDir, dataDir, stopped: true }), { code: 'EEXIST' });
});

test('corruption, partial operations and unlisted files are rejected before any restore writes', async t => {
  const { root, dataDir, outputDir } = await fixture(t);
  await createSnapshot({ dataDir, outputDir, stopped: true });
  const destination = path.join(root, 'restore');
  await fs.writeFile(path.join(outputDir, '.incomplete'), 'pending');
  await assert.rejects(restoreSnapshot({ snapshotDir: outputDir, dataDir: destination, stopped: true }), /不完整/);
  await fs.unlink(path.join(outputDir, '.incomplete'));
  await fs.writeFile(path.join(outputDir, 'data/extra.json'), '{}');
  await assert.rejects(verifySnapshot(outputDir), /多出/);
  await fs.unlink(path.join(outputDir, 'data/extra.json'));
  await fs.writeFile(path.join(outputDir, 'data/.jobs/receipt.json'), '{"status":"changed"}');
  await assert.rejects(restoreSnapshot({ snapshotDir: outputDir, dataDir: destination, stopped: true }), /校验失败/);
  await assert.rejects(fs.access(destination), { code: 'ENOENT' });
});

test('snapshot rejects symlinks and manifest traversal without reading or overwriting external files', async t => {
  const { root, dataDir, outputDir } = await fixture(t);
  const external = path.join(root, 'outside.txt');
  await fs.writeFile(external, 'outside');
  await fs.symlink(external, path.join(dataDir, 'link.json'));
  await assert.rejects(createSnapshot({ dataDir, outputDir, stopped: true }), /符号链接/);
  await fs.unlink(path.join(dataDir, 'link.json'));
  await createSnapshot({ dataDir, outputDir, stopped: true });
  const manifestPath = path.join(outputDir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.files[0].path = '../../outside.txt';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifySnapshot(outputDir), /路径/);
  assert.equal(await fs.readFile(external, 'utf8'), 'outside');
});

test('a new snapshot parent flush failure is reported and leaves an unusable incomplete snapshot', { skip: process.platform === 'win32' }, async t => {
  const { root, dataDir, outputDir, next } = await fixture(t);
  const original = await fs.readFile(path.join(dataDir, `${next.id}.json`));
  const realRoot = await fs.realpath(root);
  const open = fs.open;
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (path.resolve(file) === realRoot && args[0] === 'r') throw Object.assign(new Error('simulated directory I/O failure'), { code: 'EIO' });
    return open(file, ...args);
  });
  await assert.rejects(createSnapshot({ dataDir, outputDir, stopped: true }), { code: 'EIO' });
  await assert.rejects(verifySnapshot(outputDir), /不完整/);
  assert.deepEqual(await fs.readFile(path.join(dataDir, `${next.id}.json`)), original);
});
