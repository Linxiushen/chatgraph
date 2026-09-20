import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGraphStore } from '../lib/store.mjs';
import { organizeConversation, validateGraph } from '../lib/conversations.mjs';

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgraph-store-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return { dataDir, store: createGraphStore({ dataDir }), graph: organizeConversation({ text: 'User: 我决定先做真实用户测试。', title: '真实用户测试' }) };
}

test('legacy files migrate in memory and new saves preserve revision history', async t => {
  const { dataDir, store, graph } = await fixture(t);
  delete graph.schemaVersion;
  delete graph.revision;
  for (const node of graph.nodes) delete node.importance;
  await fs.writeFile(path.join(dataDir, `${graph.id}.json`), JSON.stringify(graph));
  const migrated = await store.load(graph.id);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.revision, 0);
  assert.equal(migrated.nodes[1].importance, 3);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, `${graph.id}.json`))).schemaVersion, undefined);
  const saved = await store.save(migrated);
  assert.equal(saved.revision, 1);
  assert.deepEqual((await store.history(graph.id)).map(item => item.version), [1, 0]);
});

test('two stale tabs cannot overwrite each other, even through different store objects', async t => {
  const { dataDir, store, graph } = await fixture(t);
  const first = await store.save(graph);
  const secondStore = createGraphStore({ dataDir });
  const results = await Promise.allSettled([
    store.save({ ...first, title: '第一个标签页' }),
    secondStore.save({ ...first, title: '第二个标签页' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await store.load(graph.id)).title, '第一个标签页');
  assert.equal((await store.load(graph.id)).revision, 2);
  assert.equal((await fs.readdir(dataDir)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('restore creates a new revision and deleted graphs can be restored without reusing revisions', async t => {
  const { store, graph } = await fixture(t);
  const first = await store.save(graph);
  const second = await store.save({ ...first, title: '后来改了主意' });
  const restored = await store.restore(graph.id, 1, 2);
  assert.equal(restored.revision, 3);
  assert.equal(restored.title, first.title);
  await assert.rejects(store.restore(graph.id, 2, 2), cause => cause.status === 409);
  assert.deepEqual((await store.history(graph.id)).map(item => item.version), [3, 2, 1]);
  await assert.rejects(store.remove(graph.id, second.revision), cause => cause.status === 409);
  await store.remove(graph.id, restored.revision);
  assert.equal((await store.list()).length, 0);
  const recovered = await store.restore(graph.id, 2, 0);
  assert.equal(recovered.revision, 4);
  assert.equal(recovered.title, second.title);
});

test('backup validates before writing and imports conflicts as distinct copies', async t => {
  const { store, graph } = await fixture(t);
  const saved = await store.save(graph);
  const backup = await store.backup();
  assert.equal(backup.format, 'chatgraph-backup');
  assert.deepEqual(backup.graphs[0], saved);
  const invalid = structuredClone(backup);
  invalid.graphs.push({ ...saved, id: 'invalid', nodes: [{ ...saved.nodes[0], sourceIds: ['missing'] }] });
  await assert.rejects(store.restoreBackup(invalid), /不存在的原文/);
  assert.equal((await store.list()).length, 1);
  const result = await store.restoreBackup(backup);
  assert.equal(result.count, 1);
  assert.notEqual(result.restored[0].id, saved.id);
  assert.equal(result.restored[0].originalId, saved.id);
  assert.equal((await store.load(saved.id)).revision, 1);
  assert.equal((await store.list()).length, 2);
  assert.deepEqual((await store.load(result.restored[0].id)).messages, saved.messages);
});

test('damaged files remain visible and recoverable with exact corrupt bytes preserved', async t => {
  const { dataDir, store, graph } = await fixture(t);
  const first = await store.save(graph);
  await store.save({ ...first, title: '第二版' });
  const corrupt = '{accidentally interrupted';
  await fs.writeFile(path.join(dataDir, `${graph.id}.json`), corrupt);
  await assert.rejects(store.load(graph.id), cause => cause.status === 422);
  assert.equal((await store.list())[0].recoveryRequired, true);
  await assert.rejects(store.backup(), /损坏图谱/);
  await assert.rejects(store.save(first), cause => cause.status === 422);
  const recovered = await store.restore(graph.id, 1, null);
  assert.equal(recovered.title, first.title);
  assert.equal(recovered.revision, 2);
  const recoveryFiles = await fs.readdir(path.join(dataDir, '.recovery'));
  assert.equal(await fs.readFile(path.join(dataDir, '.recovery', recoveryFiles[0]), 'utf8'), corrupt);
  assert.equal((await store.diagnostics()).issues.length, 0);
});

test('library retrieval searches real source text and exposes literal text matches', async t => {
  const { store, graph } = await fixture(t);
  await store.save(graph);
  const matches = await store.search('真实用户');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchType, 'text');
  assert.equal(matches[0].messages[0].id, graph.messages[0].id);
  assert.deepEqual(await store.search('不存在的观点'), []);
  await assert.rejects(store.load('../outside'), /编号无效/);
});

test('schema v2 validates receipts, importance and session source references', () => {
  const graph = organizeConversation({ text: 'User: 仅复制了部分对话。' });
  graph.source.complete = 'partial';
  graph.analysis = { model: 'test-model', generatedAt: new Date().toISOString(), durationMs: 400, inputTokens: 12, outputTokens: 30, calls: 1, chunkCount: 1, warnings: ['部分对话'] };
  graph.sessions = [{ id: 'first', title: graph.title, createdAt: graph.createdAt, mode: graph.mode, source: graph.source, messageIds: graph.messages.map(item => item.id), nodeIds: graph.nodes.map(item => item.id) }];
  assert.equal(validateGraph(graph).analysis.model, 'test-model');
  graph.nodes[0].importance = 6;
  assert.throws(() => validateGraph(graph), /重要程度/);
  graph.nodes[0].importance = 5;
  graph.sessions[0].nodeIds.push('missing');
  assert.throws(() => validateGraph(graph), /不存在的节点/);
  delete graph.sessions;
  graph.schemaVersion = 99;
  assert.throws(() => validateGraph(graph), /数据版本/);
});
