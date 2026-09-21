import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function syncDirectory(directory) {
  // Windows does not expose directory fsync through Node's file API.
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Flush contents before atomic replacement, then persist the directory entry. */
export async function atomicWriteFile(file, contents) {
  const directory = path.dirname(file);
  const firstCreated = await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, file);
    // POSIX needs the containing directory flushed to make the rename durable.
    if (process.platform !== 'win32') {
      for (let current = directory;; current = path.dirname(current)) {
        await syncDirectory(current);
        if (!firstCreated || current === path.dirname(firstCreated)) break;
      }
    }
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

/** Successful revocation/deletion must survive a subsequent process/power loss. */
export async function durableRemoveFile(file, { force = false } = {}) {
  try { await fs.unlink(file); }
  catch (error) { if (!force || error.code !== 'ENOENT') throw error; }
  // Flush even an already absent token: this can be a retry after fsync failed.
  if (force) {
    try { await syncDirectory(path.dirname(file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  await syncDirectory(path.dirname(file));
}
