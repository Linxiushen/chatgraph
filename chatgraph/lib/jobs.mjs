import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Bounded single-worker queue. Only receipts/results persist, never provider settings. */
export function createJobQueue({ dataDir, run }) {
  const directory = path.join(dataDir, '.jobs');
  const records = new Map(), queue = [];
  let active = false, closing = false, admission = Promise.resolve();
  const publicJob = job => ({ id: job.id, kind: job.kind, status: job.status, progress: job.progress,
    message: job.message, createdAt: job.createdAt, updatedAt: job.updatedAt,
    ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) });
  const persist = async job => {
    const snapshot = JSON.stringify(publicJob(job));
    const previous = job.write || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const target = path.join(directory, `${job.id}.json`), temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(snapshot); await handle.sync(); }
        finally { await handle.close(); }
        await fs.rename(temporary, target);
      }
      finally { await fs.rm(temporary, { force: true }); }
    });
    job.write = next;
    return next;
  };
  async function work() {
    if (active || closing) return;
    active = true;
    try {
      while (queue.length && !closing) {
        const job = queue.shift();
        if (job.status === 'cancelled') continue;
        job.status = 'running'; job.message = '开始整理对话…'; job.updatedAt = new Date().toISOString();
        try {
          await persist(job);
          const result = await run(job.kind, job.input, { signal: job.controller.signal, onProgress(update) {
            if (job.controller.signal.aborted) return;
            if (typeof update.progress === 'number') job.progress = Math.min(99, Math.max(job.progress, update.progress));
            if (update.message) job.message = update.message;
          } });
          if (!job.controller.signal.aborted) { job.result = result; job.status = 'completed'; job.progress = 100; job.message = '整理完成，请核对原文后保存。'; }
        } catch (error) {
          if (!job.controller.signal.aborted) { job.status = 'failed'; job.error = error.message || '整理失败。'; job.message = job.error; }
        } finally {
          job.input = undefined;
          job.updatedAt = new Date().toISOString();
          await persist(job).catch(() => { job.status = 'failed'; job.error = '任务结果无法写入磁盘，请检查数据目录。'; });
        }
      }
    } finally { active = false; }
  }
  return {
    async create(kind, input, requestedId) {
      if (requestedId !== undefined && (typeof requestedId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestedId))) throw new Error('任务编号无效。');
      const next = admission.catch(() => {}).then(async () => {
        if (closing) throw new Error('服务正在关闭。');
        if (!['import', 'append'].includes(kind)) throw new Error('不支持的整理任务。');
        // The browser stores its UUID before sending, so refresh cannot orphan a paid job.
        if (requestedId) {
          try {
            const existing = await this.get(requestedId);
            if (existing.kind !== kind) throw Object.assign(new Error('该任务编号已用于其他类型的整理。'), { status: 409 });
            return existing;
          } catch (error) { if (error.status !== 404) throw error; }
        }
        if (queue.filter(job => job.status === 'queued').length >= 5) throw Object.assign(new Error('已有多个任务排队，请等待完成。'), { status: 429 });
        const now = new Date().toISOString();
        const job = { id: requestedId || randomUUID(), kind, input, status: 'queued', progress: 0, message: '已加入整理队列…', createdAt: now, updatedAt: now, controller: new AbortController() };
        await persist(job); records.set(job.id, job); queue.push(job); void work();
        if (records.size > 50) {
          for (const [id, record] of records) {
            if (['completed', 'failed', 'cancelled'].includes(record.status)) records.delete(id);
            if (records.size <= 50) break;
          }
        }
        return publicJob(job);
      });
      admission = next;
      return next;
    },
    async get(id) {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('任务不存在。'), { status: 404 });
      if (records.has(id)) {
        const job = records.get(id);
        // A completion is observable only after its recoverable receipt is on disk.
        if (['completed', 'failed', 'cancelled'].includes(job.status)) await job.write;
        return publicJob(job);
      }
      let contents, job;
      try { contents = await fs.readFile(path.join(directory, `${id}.json`), 'utf8'); }
      catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error('任务不存在。'), { status: 404 });
        throw Object.assign(new Error('暂时无法读取任务记录，请检查数据目录后重试；不会重复调用模型。'), { status: 503 });
      }
      // Only a genuinely missing receipt permits a new paid call with this UUID.
      // Preserve damaged or unreadable files instead of overwriting their evidence.
      try { job = JSON.parse(contents); } catch { /* Validated below. */ }
      if (!job || job.id !== id || !['import', 'append'].includes(job.kind) ||
          !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status) ||
          !Number.isFinite(job.progress) || job.progress < 0 || job.progress > 100 ||
          typeof job.message !== 'string' || !Number.isFinite(Date.parse(job.createdAt)) ||
          !Number.isFinite(Date.parse(job.updatedAt)) || (job.status === 'completed' && !job.result)) {
        throw Object.assign(new Error('任务记录损坏，原文件已保留；请先恢复记录，不会重复调用模型。'), { status: 422 });
      }
      if (['queued', 'running'].includes(job.status)) {
        job.status = 'failed'; job.error = '服务重启中断了整理，请重新提交。原文草稿仍保留在浏览器中。'; job.message = job.error;
        await persist(job);
      }
      return publicJob(job);
    },
    async cancel(id) {
      const job = records.get(id);
      if (!job) return this.get(id);
      if (['queued', 'running'].includes(job.status)) {
        job.status = 'cancelled'; job.message = '整理已取消。'; job.controller.abort(); job.input = undefined;
        const queuedIndex = queue.indexOf(job);
        if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
        job.updatedAt = new Date().toISOString(); await persist(job);
      }
      return publicJob(job);
    },
    close() {
      closing = true;
      for (const job of records.values()) if (['queued', 'running'].includes(job.status)) job.controller.abort();
    },
  };
}
