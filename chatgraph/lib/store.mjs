import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateGraph } from './conversations.mjs';
import { atomicWriteFile, durableRemoveFile } from './atomic-file.mjs';
import { MAX_BACKUP_BYTES } from './limits.mjs';

const queues = new Map();
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const invalidNames = new Set(['__proto__', 'prototype', 'constructor']);
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const validId = id => typeof id === 'string' && idPattern.test(id) && !invalidNames.has(id);
const summary = graph => ({ id: graph.id, title: graph.title, description: graph.description, updatedAt: graph.updatedAt, nodeCount: graph.nodes.length, messageCount: graph.messages.length, sessionCount: graph.sessions?.length || 1, revision: graph.revision, mode: graph.mode, source: graph.source });

/** Local store: writes are serialized per directory and revisions protect stale tabs. */
export function createGraphStore({ dataDir }) {
  if (typeof dataDir !== 'string' || !dataDir) throw error('请指定数据目录。');
  const directory = path.resolve(dataDir);
  function graphFile(id) {
    if (!validId(id)) throw error('图谱编号无效。');
    return path.join(directory, `${id}.json`);
  }
  function revisionFile(id, version) {
    graphFile(id);
    if (!Number.isSafeInteger(version) || version < 0) throw error('历史版本编号无效。');
    return path.join(directory, '.history', id, `${version}.json`);
  }
  function serialized(operation) {
    const previous = queues.get(directory) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(directory, next);
    return next.finally(() => { if (queues.get(directory) === next) queues.delete(directory); });
  }
  async function atomicJSON(file, value) {
    return atomicWriteFile(file, JSON.stringify(value, null, 2));
  }
  async function read(file) {
    let value;
    try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (cause) {
      if (cause.code) throw cause;
      throw error('图谱文件损坏；原文件已保留，可从历史版本或备份恢复。', 422);
    }
    try { return validateGraph(value); }
    catch (cause) { throw error(`图谱数据无法验证：${cause.message} 原文件已保留，可从历史版本或备份恢复。`, 422); }
  }
  async function load(id) {
    const graph = await read(graphFile(id));
    if (graph.id !== id) throw error('图谱编号与文件不一致；请从备份恢复。', 422);
    return graph;
  }
  async function maybeLoad(id) {
    try { return await load(id); } catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
  }
  function checkRevision(expected, current) {
    if (expected !== current) throw error(`保存冲突：本地文件已更新到版本 ${current}，当前编辑基于版本 ${expected}。请先备份当前草稿，再载入最新版本。`, 409);
  }
  async function lastHistoricalRevision(id) {
    let entries = [];
    try { entries = await fs.readdir(path.join(directory, '.history', id)); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    return Math.max(0, ...entries.filter(name => /^\d+\.json$/.test(name)).map(name => Number(name.slice(0, -5))).filter(Number.isSafeInteger));
  }
  async function saveUnlocked(input) {
    const graph = validateGraph(input);
    const existing = await maybeLoad(graph.id);
    checkRevision(graph.revision, existing?.revision ?? 0);
    graph.revision = Math.max(existing?.revision ?? 0, await lastHistoricalRevision(graph.id)) + 1;
    graph.createdAt = existing?.createdAt || graph.createdAt;
    graph.updatedAt = new Date().toISOString();
    // Revision digits and normalized timestamps can grow at the exact byte limit.
    // Validate the final persisted record before changing either current/history.
    validateGraph(graph);
    if (existing) await atomicJSON(revisionFile(existing.id, existing.revision), existing);
    // The current graph is authoritative. A crash before rename leaves it intact.
    await atomicJSON(graphFile(graph.id), graph);
    return graph;
  }
  async function* scan() {
    let entries;
    try { entries = await fs.readdir(directory); } catch (cause) { if (cause.code === 'ENOENT') return; throw cause; }
    const ids = entries.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(validId);
    // Bound the number of full transcripts in memory while overlapping disk reads.
    // Each consumer uses this same validated snapshot instead of loading it again.
    for (let offset = 0; offset < ids.length; offset += 4) {
      const batch = ids.slice(offset, offset + 4);
      const outcomes = await Promise.allSettled(batch.map(load));
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === 'fulfilled') yield { graph: outcome.value, item: summary(outcome.value) };
        else if (outcome.reason.code !== 'ENOENT') {
          const id = batch[index];
          yield { item: { id, title: `需要恢复的图谱 · ${id}`, description: outcome.reason.message, updatedAt: '', nodeCount: 0, mode: 'outline', source: { platform: '', url: '', complete: 'unknown' }, recoveryRequired: true } };
        }
      }
    }
  }
  async function list() {
    const graphs = [];
    for await (const { item } of scan()) graphs.push(item);
    return graphs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function history(id) {
    graphFile(id);
    const versions = new Map();
    let entries = [];
    try { entries = await fs.readdir(path.join(directory, '.history', id)); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    for (const entry of entries.filter(name => /^\d+\.json$/.test(name))) {
      const version = Number(entry.slice(0, -5));
      try {
        const graph = await read(revisionFile(id, version));
        if (graph.id === id && graph.revision === version) versions.set(version, { version, createdAt: graph.updatedAt, title: graph.title, nodeCount: graph.nodes.length });
      } catch { /* Keep damaged snapshots on disk; valid snapshots remain recoverable. */ }
    }
    try {
      const graph = await load(id);
      versions.set(graph.revision, { version: graph.revision, createdAt: graph.updatedAt, title: graph.title, nodeCount: graph.nodes.length });
    } catch (cause) { if (cause.code !== 'ENOENT' && cause.status !== 422) throw cause; }
    return [...versions.values()].sort((a, b) => b.version - a.version);
  }
  async function restore(id, version, expectedRevision) {
    return serialized(async () => {
      let current;
      try { current = await maybeLoad(id); }
      catch (cause) {
        if (cause.status !== 422 || expectedRevision !== null) throw cause;
        const snapshot = await read(revisionFile(id, version));
        if (snapshot.id !== id || snapshot.revision !== version) throw error('历史版本内容与编号不一致。', 422);
        snapshot.revision = Math.max(version, await lastHistoricalRevision(id)) + 1;
        snapshot.updatedAt = new Date().toISOString();
        validateGraph(snapshot);
        const original = await fs.readFile(graphFile(id));
        const recoveryDir = path.join(directory, '.recovery');
        await fs.mkdir(recoveryDir, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(recoveryDir, `${id}.${randomUUID()}.corrupt`), original, { flag: 'wx', mode: 0o600 });
        await atomicJSON(graphFile(id), snapshot);
        return snapshot;
      }
      checkRevision(expectedRevision, current?.revision ?? 0);
      const snapshot = version === current?.revision ? current : await read(revisionFile(id, version));
      if (snapshot.id !== id || snapshot.revision !== version) throw error('历史版本内容与编号不一致。', 422);
      return saveUnlocked({ ...snapshot, revision: current?.revision ?? 0 });
    });
  }
  async function remove(id, expectedRevision) {
    return serialized(async () => {
      const graph = await load(id);
      if (expectedRevision !== undefined) checkRevision(expectedRevision, graph.revision);
      await atomicJSON(revisionFile(id, graph.revision), graph);
      await durableRemoveFile(graphFile(id));
      return { ok: true, id, recoverable: true };
    });
  }
  async function search(query, { limit = 50 } = {}) {
    if (typeof query !== 'string' || query.length > 500) throw error('搜索词须为不超过 500 字的文字。');
    const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const normalize = value => value.normalize('NFKC').toLocaleLowerCase();
    const results = [];
    const matches = value => { const text = normalize(value); return terms.every(term => text.includes(term)); };
    for await (const { item, graph } of scan()) {
      if (!graph) continue;
      const nodes = graph.nodes.filter(node => matches([node.label, node.summary, node.note].join('\n')));
      const messages = graph.messages.filter(message => matches(message.content));
      const titleMatches = matches(`${graph.title}\n${graph.description}`);
      if (titleMatches || nodes.length || messages.length) results.push({ ...item, matchType: 'text', score: (titleMatches ? 10 : 0) + nodes.length * 2 + messages.length, nodes: nodes.slice(0, 10).map(node => ({ id: node.id, label: node.label, summary: node.summary.slice(0, 240) })), messages: messages.slice(0, 5).map(message => ({ id: message.id, role: message.role, excerpt: message.content.slice(0, 240) })) });
    }
    return results.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  }
  async function backup() {
    return serialized(async () => {
      const graphs = [], damaged = [];
      let bytes = 1024;
      for await (const { item, graph } of scan()) {
        if (graph) {
          // Keep the downloaded JSON re-importable through the 50 MiB endpoint.
          bytes += Buffer.byteLength(JSON.stringify(graph)) + 1;
          if (bytes > MAX_BACKUP_BYTES) throw error('知识库超过 50 MiB 网页备份范围，请使用部署提供的全量数据目录备份；不会生成无法还原的不完整备份。', 413);
          graphs.push(graph);
        }
        else damaged.push(item);
      }
      if (damaged.length) throw error(`有 ${damaged.length} 个损坏图谱，无法生成完整备份。请先恢复它们；也可直接复制整个数据目录保留原始文件。`, 422);
      graphs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { format: 'chatgraph-backup', version: 1, createdAt: new Date().toISOString(), graphs };
    });
  }
  async function restoreBackup(value) {
    if (!value || value.format !== 'chatgraph-backup' || value.version !== 1 || !Array.isArray(value.graphs) || value.graphs.length > 1_000) throw error('备份格式无效，或超过 1,000 个图谱。');
    // Validate the whole archive before performing any mutation.
    const graphs = value.graphs.map(validateGraph);
    if (new Set(graphs.map(graph => graph.id)).size !== graphs.length) throw error('备份包含重复图谱编号。');
    return serialized(async () => {
      const restored = [];
      for (const graph of graphs) {
        const originalId = graph.id;
        try { await fs.access(graphFile(graph.id)); graph.id = `graph-${randomUUID()}`; }
        catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
        graph.revision = 0;
        const saved = await saveUnlocked(graph);
        restored.push({ id: saved.id, originalId, title: saved.title });
      }
      return { count: restored.length, restored };
    });
  }
  async function diagnostics() {
    const graphs = await list();
    let entries = [];
    try { entries = await fs.readdir(directory); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    return { issues: graphs.filter(graph => graph.recoveryRequired).map(graph => ({ id: graph.id, kind: 'invalid-graph', message: graph.description })), pendingFiles: entries.filter(entry => entry.endsWith('.tmp')).length };
  }
  return { list, load, save: input => serialized(() => saveUnlocked(input)), remove, history, restore, search, backup, restoreBackup, diagnostics };
}
