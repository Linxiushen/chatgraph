import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateGraph } from './conversations.mjs';
import { atomicWriteFile, durableRemoveFile } from './atomic-file.mjs';

export function createShareStore({ dataDir }) {
  const directory = path.join(dataDir, '.shares');
  const filename = token => {
    if (!/^[a-f0-9]{48}$/.test(token)) throw Object.assign(new Error('分享不存在或已撤回。'), { status: 404 });
    return path.join(directory, `${token}.json`);
  };
  const metadata = share => ({ token: share.token, title: share.graph.title, graphId: share.graph.id,
    includeSources: share.includeSources, createdAt: share.createdAt, expiresAt: share.expiresAt });
  function validateShare(value, token) {
    if (!value || value.token !== token || typeof value.includeSources !== 'boolean' ||
        !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt)) ||
        Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) {
      throw Object.assign(new Error('分享记录损坏，原文件已保留；请撤回后重新创建分享。'), { status: 422 });
    }
    value.graph = validateGraph(value.graph);
    return value;
  }
  return {
    async create(input) {
      const graph = validateGraph(input.graph);
      const days = input.expiresInDays ?? 7;
      if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('分享有效期须为 1–90 天。');
      const includeSources = input.includeSources === true;
      if (!includeSources) {
        graph.messages = [];
        graph.sessions = [];
        graph.nodes = graph.nodes.map(node => ({ ...node, sourceIds: [], note: '' }));
        graph.source = { platform: graph.source.platform, url: '', complete: 'partial' };
      }
      const token = randomBytes(24).toString('hex');
      const share = { token, graph, includeSources, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString() };
      await atomicWriteFile(filename(token), JSON.stringify(share));
      return metadata(share);
    },
    async load(token) {
      let share;
      try { share = JSON.parse(await fs.readFile(filename(token), 'utf8')); }
      catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error('分享不存在或已撤回。'), { status: 404 });
        if (error instanceof SyntaxError) throw Object.assign(new Error('分享记录损坏，原文件已保留；请撤回后重新创建分享。'), { status: 422 });
        throw error;
      }
      validateShare(share, token);
      if (Date.parse(share.expiresAt) <= Date.now()) throw Object.assign(new Error('分享已过期。'), { status: 410 });
      return share;
    },
    async list() {
      let entries;
      try { entries = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const shares = [];
      for (const entry of entries) {
        if (!/^[a-f0-9]{48}\.json$/.test(entry)) continue;
        try { shares.push(metadata(validateShare(JSON.parse(await fs.readFile(path.join(directory, entry), 'utf8')), entry.slice(0, -5)))); } catch { /* Do not expose malformed content. */ }
      }
      return shares.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async remove(token) { await durableRemoveFile(filename(token), { force: true }); return { ok: true }; },
  };
}
