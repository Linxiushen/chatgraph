import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile, durableRemoveFile } from '../lib/atomic-file.mjs';

const FORMAT = 'chatgraph-data-snapshot';
const MAX_ENTRIES = 100_000;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const validPath = value => typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.includes('\0') && !path.posix.isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':'));
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

async function directory(value) {
  const resolved = path.resolve(value);
  if (!(await fs.lstat(resolved)).isDirectory()) throw new Error('必须指定真实目录，不能使用符号链接。');
  return fs.realpath(resolved);
}

async function inventory(root) {
  const files = [], directories = [];
  async function walk(relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!validPath(name)) throw new Error('数据目录中存在不支持的路径。');
      if (files.length + directories.length >= MAX_ENTRIES) throw new Error('数据超过 100,000 个文件或目录，请分开备份。');
      if (entry.isDirectory()) { directories.push(name); await walk(name); }
      else if (entry.isFile()) files.push(name);
      else throw new Error('数据目录包含符号链接或特殊文件；为避免遗漏或读取目录外内容，备份已停止。');
    }
  }
  await walk();
  return { files: files.sort(), directories: directories.sort() };
}

// Stream files so history and completed task results need not all fit in RAM.
async function hashFile(filename, destination) {
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let output;
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error('快照只能包含普通文件。');
    const hash = createHash('sha256');
    let size = 0;
    if (destination) output = await fs.open(destination, 'wx', 0o600);
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      size += bytesRead; hash.update(chunk);
      if (output) await output.writeFile(chunk);
    }
    if (output) await output.sync();
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || size !== before.size) throw new Error('备份期间数据发生变化，请先停止所有写入服务。');
    return { size, sha256: hash.digest('hex') };
  } finally { await output?.close(); await handle.close(); }
}

async function destinationPath(value, excluded) {
  const candidate = path.resolve(value);
  const parent = await directory(path.dirname(candidate));
  const destination = path.join(parent, path.basename(candidate));
  if (excluded.some(source => inside(source, destination) || inside(destination, source))) throw new Error('目标目录必须在源目录之外。');
  // mkdir is the exclusive claim: never replace any pre-existing destination.
  await fs.mkdir(destination, { mode: 0o700 });
  await atomicWriteFile(path.join(destination, '.incomplete'), 'Snapshot operation incomplete\n');
  // Persist the newly claimed directory entry as well as its contents. Flushing
  // only destination would allow a successful snapshot to vanish on power loss.
  await flushDirectories(parent, []);
  return destination;
}

async function flushDirectories(root, directories) {
  if (process.platform === 'win32') return;
  for (const relative of [...directories].sort((a, b) => b.length - a.length).concat('')) {
    const handle = await fs.open(path.join(root, relative), 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
}

export async function createSnapshot({ dataDir, outputDir, stopped = false }) {
  if (!stopped) throw new Error('请先停止服务，再指定 --stopped；在线复制无法保证跨文件一致性。');
  const source = await directory(dataDir);
  const original = await inventory(source);
  if (original.files.includes('.incomplete')) throw new Error('源数据目录标记为未完成恢复，不能作为有效备份。');
  const output = await destinationPath(outputDir, [source]);
  // A failed/interrupted operation keeps .incomplete and can never pass verify.
  const data = path.join(output, 'data');
  await fs.mkdir(data, { mode: 0o700 });
  for (const relative of original.directories) await fs.mkdir(path.join(data, relative), { recursive: true, mode: 0o700 });
  const files = [];
  for (const relative of original.files) files.push({ path: relative, ...await hashFile(path.join(source, relative), path.join(data, relative)) });
  if (JSON.stringify(await inventory(source)) !== JSON.stringify(original)) throw new Error('备份期间目录发生变化，请停止服务后重试。');
  const manifest = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), directories: original.directories, files };
  const encoded = JSON.stringify(manifest, null, 2);
  if (Buffer.byteLength(encoded) > MAX_MANIFEST_BYTES) throw new Error('快照清单超过 32 MiB，请按数据目录拆分备份。');
  await flushDirectories(data, original.directories);
  await atomicWriteFile(path.join(output, 'manifest.json'), encoded);
  await durableRemoveFile(path.join(output, '.incomplete'));
  return { directory: output, files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
}

export async function verifySnapshot(snapshotDir) {
  const root = await directory(snapshotDir);
  const rootEntries = (await fs.readdir(root)).sort();
  if (JSON.stringify(rootEntries) !== JSON.stringify(['data', 'manifest.json'])) throw new Error('快照不完整或包含额外文件，不能恢复。');
  const manifestPath = path.join(root, 'manifest.json');
  const stat = await fs.lstat(manifestPath);
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('快照清单不是有效的普通文件。');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.format !== FORMAT || manifest.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories) || manifest.files.length + manifest.directories.length > MAX_ENTRIES) throw new Error('不支持的快照清单。');
  const names = new Set();
  for (const name of [...manifest.directories, ...manifest.files.map(file => file?.path)]) {
    if (!validPath(name) || name === '.incomplete' || names.has(name)) throw new Error('快照路径无效或重复。');
    names.add(name);
  }
  const data = await directory(path.join(root, 'data'));
  const actual = await inventory(data);
  if (JSON.stringify(actual.files) !== JSON.stringify(manifest.files.map(file => file.path).sort()) || JSON.stringify(actual.directories) !== JSON.stringify([...manifest.directories].sort())) throw new Error('快照文件缺失或多出，不能恢复。');
  for (const file of manifest.files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('快照校验值无效。');
    const measured = await hashFile(path.join(data, file.path));
    if (measured.size !== file.size || measured.sha256 !== file.sha256) throw new Error('快照文件校验失败，不能恢复。');
  }
  return { directory: root, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0), manifest };
}

export async function restoreSnapshot({ snapshotDir, dataDir, stopped = false }) {
  if (!stopped) throw new Error('请先停止服务，再指定 --stopped。');
  const verified = await verifySnapshot(snapshotDir);
  const output = await destinationPath(dataDir, [verified.directory]);
  const { manifest } = verified;
  for (const relative of manifest.directories) await fs.mkdir(path.join(output, relative), { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    const copied = await hashFile(path.join(verified.directory, 'data', file.path), path.join(output, file.path));
    if (copied.sha256 !== file.sha256 || copied.size !== file.size) throw new Error('恢复期间源文件发生变化，目标未完成；不要启动该目录。');
  }
  await flushDirectories(output, manifest.directories);
  await durableRemoveFile(path.join(output, '.incomplete'));
  return { directory: output, files: verified.files, bytes: verified.bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const values = {};
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (key === '--stopped' && !values.stopped) values.stopped = true;
      else if (['--data-dir', '--output', '--snapshot'].includes(key) && args[index + 1] && !args[index + 1].startsWith('--') && !Object.hasOwn(values, key)) values[key] = args[++index];
      else throw new Error('参数无效。');
    }
    let result;
    if (command === 'backup' && values['--data-dir'] && values['--output']) result = await createSnapshot({ dataDir: values['--data-dir'], outputDir: values['--output'], stopped: values.stopped });
    else if (command === 'verify' && values['--snapshot']) result = await verifySnapshot(values['--snapshot']);
    else if (command === 'restore' && values['--snapshot'] && values['--data-dir']) result = await restoreSnapshot({ snapshotDir: values['--snapshot'], dataDir: values['--data-dir'], stopped: values.stopped });
    else throw new Error('用法：backup --data-dir DIR --output NEW_DIR --stopped | verify --snapshot DIR | restore --snapshot DIR --data-dir NEW_DIR --stopped');
    console.log(JSON.stringify({ ok: true, directory: result.directory, files: result.files, bytes: result.bytes }));
  } catch (error) { console.error(error.code ? `快照操作失败 (${error.code})；原数据未覆盖。` : error.message); process.exitCode = 1; }
}
