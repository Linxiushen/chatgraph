import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createZip } from '../lib/zip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const paths = [
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'ARCHIFY_README.md', '.dockerignore',
  'archify/LICENSE', 'archify/THIRD_PARTY_NOTICES.md',
  'archify/assets/template.html', 'archify/assets/JetBrainsMono-OFL.txt',
  'archify/renderers/shared/utils.mjs', 'archify/renderers/shared/i18n.mjs',
  'chatgraph/server.mjs', 'chatgraph/package.json', 'chatgraph/LICENSE', 'chatgraph/.env.example', 'chatgraph/.gitignore',
  'chatgraph/README.md', 'chatgraph/CONTRACT.md', 'chatgraph/PRODUCT.md',
  'chatgraph/UPSTREAM.md', 'chatgraph/VALIDATION.md', 'chatgraph/RELEASE.md',
  'chatgraph/lib', 'chatgraph/public', 'chatgraph/extension', 'chatgraph/integrations',
  'chatgraph/deploy', 'chatgraph/test', 'chatgraph/scripts', 'chatgraph/research', 'chatgraph/docs', 'chatgraph/mobile',
];
const forbidden = new Set(['.git', '.data', '.history', '.recovery', '.jobs', '.shares', 'node_modules', 'test-output', 'dist', 'coverage', '.DS_Store', 'build', 'build-simulator', '.gradle', 'xcuserdata', 'native-artifacts', 'local.properties', 'signing.properties', 'keystore.properties', 'ExportOptions.local.plist', 'Configuration.local.xcconfig']);
const extensions = new Set(['.mjs', '.js', '.css', '.html', '.json', '.webmanifest', '.md', '.txt', '.svg', '.png', '.yaml', '.yml', '.sh', '.bat', '.java', '.gradle', '.properties', '.xml', '.swift', '.plist', '.pbxproj', '.xcscheme', '.xcworkspacedata', '.xcconfig', '.entitlements', '.xcprivacy', '.py']);
const allowedHiddenPaths = new Set(['.dockerignore', 'chatgraph/.gitignore', 'chatgraph/.env.example', 'chatgraph/mobile/android/.gitignore', 'chatgraph/mobile/ios/.gitignore']);
const upstreamRevision = '72c750bb070d95171dbb2244e5b62b1b7da69c12';

/** Explicit source allowlist; runtime data and credentials are never traversed. */
export async function buildRelease({ repositoryDir = repository, outputDir } = {}) {
  let tracked;
  try {
    await fs.lstat(path.join(repositoryDir, '.git'));
    tracked = new Set(execFileSync('git', ['-C', repositoryDir, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean));
  } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  async function inspectPath(relative) {
    let stat;
    const segments = relative.split('/');
    for (let index = 0; index < segments.length; index++) {
      const inspected = segments.slice(0, index + 1).join('/');
      stat = await fs.lstat(path.join(repositoryDir, inspected));
      if (stat.isSymbolicLink()) throw new Error(`发布源包含符号链接，无法确认内容：${inspected}`);
      if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`发布源目录无效：${inspected}`);
    }
    return stat;
  }
  const metadataPath = path.join(repositoryDir, 'chatgraph/package.json');
  const metadataStat = await inspectPath('chatgraph/package.json');
  if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) throw new Error('发布元数据必须是普通文件，不能使用符号链接。');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(metadata.version)) throw new Error('发布版本号无效。');
  const entries = new Map();
  async function add(relative, required = false) {
    const segments = relative.split('/');
    const name = segments.at(-1);
    if (segments.some(part => forbidden.has(part)) || (segments.some(part => part.startsWith('.')) && !allowedHiddenPaths.has(relative))) return;
    const target = path.join(repositoryDir, relative);
    let stat;
    try { stat = await inspectPath(relative); } catch (cause) { if (cause.code === 'ENOENT' && !required) return; throw cause; }
    if (stat.isDirectory()) {
      for (const child of (await fs.readdir(target)).sort()) await add(`${relative}/${child}`);
      return;
    }
    if (!stat.isFile()) return;
    if (tracked && !tracked.has(relative)) {
      if (required) throw new Error(`发布必需文件尚未加入版本控制：${relative}`);
      return;
    }
    const allowedSpecial = ['LICENSE', 'GRADLE-LICENSE', 'Dockerfile', 'Caddyfile', '.env.example', '.gitignore', '.dockerignore', 'gradlew', 'gradle-wrapper.jar'].includes(name);
    if (!allowedSpecial && !extensions.has(path.extname(name))) return;
    if (stat.size > 8 * 1024 * 1024) throw new Error(`发布源文件超过 8 MB，请检查：${relative}`);
    entries.set(`chatgraph-${metadata.version}/${relative}`, await fs.readFile(target));
  }
  for (const relative of paths) await add(relative, ['chatgraph/server.mjs', 'chatgraph/package.json', 'chatgraph/LICENSE', 'archify/assets/template.html', 'archify/renderers/shared/utils.mjs', 'archify/renderers/shared/i18n.mjs'].includes(relative));
  const prefix = `chatgraph-${metadata.version}/`;
  const upstreamReadmePath = `${prefix}ARCHIFY_README.md`;
  if (entries.has(upstreamReadmePath)) {
    // The runtime package carries only the Archify components it uses. Keep its
    // archived README useful without copying unrelated upstream examples/assets.
    const text = entries.get(upstreamReadmePath).toString('utf8').replace(/(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g, (full, lead, target, tail) => {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) return full;
      const suffixIndex = target.search(/[?#]/);
      const relative = suffixIndex < 0 ? target : target.slice(0, suffixIndex);
      const suffix = suffixIndex < 0 ? '' : target.slice(suffixIndex);
      const normalized = path.posix.normalize(relative);
      if (normalized.startsWith('../') || entries.has(`${prefix}${normalized}`)) return full;
      const encoded = normalized.split('/').map(encodeURIComponent).join('/');
      const url = lead.startsWith('!')
        ? `https://raw.githubusercontent.com/tt-a1i/archify/${upstreamRevision}/${encoded}`
        : `https://github.com/tt-a1i/archify/${relative.endsWith('/') ? 'tree' : 'blob'}/${upstreamRevision}/${encoded}`;
      return `${lead}${url}${suffix}${tail}`;
    });
    entries.set(upstreamReadmePath, Buffer.from(text));
  }
  const checksums = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => `${createHash('sha256').update(content).digest('hex')}  ${name.split('/').slice(1).join('/')}`).join('\n');
  entries.set(`chatgraph-${metadata.version}/SHA256SUMS`, `${checksums}\n`);
  const body = createZip([...entries].sort(([a], [b]) => a.localeCompare(b)));
  const digest = createHash('sha256').update(body).digest('hex');
  const directory = path.resolve(outputDir || path.join(repositoryDir, 'chatgraph/test-output/releases'));
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `chatgraph-${metadata.version}.zip`);
  await fs.writeFile(file, body);
  await fs.writeFile(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`);
  const extensionPrefix = `chatgraph-${metadata.version}/chatgraph/extension/`;
  const extensionRuntime = new Set(['manifest.json', 'extractor.js', 'destination.js', 'popup.html', 'popup.css', 'popup.js', 'README.md', 'LICENSE']);
  const extensionEntries = [...entries].filter(([name]) => name.startsWith(extensionPrefix) && extensionRuntime.has(name.slice(extensionPrefix.length))).map(([name, content]) => [name.slice(extensionPrefix.length), content]);
  let extension;
  if (extensionEntries.some(([name]) => name === 'manifest.json')) {
    if (!extensionEntries.some(([name]) => name === 'LICENSE')) extensionEntries.push(['LICENSE', entries.get(`chatgraph-${metadata.version}/chatgraph/LICENSE`)]);
    const extensionBody = createZip(extensionEntries.sort(([a], [b]) => a.localeCompare(b)));
    const extensionFile = path.join(directory, `chatgraph-extension-${metadata.version}.zip`);
    const extensionSha256 = createHash('sha256').update(extensionBody).digest('hex');
    await fs.writeFile(extensionFile, extensionBody);
    await fs.writeFile(`${extensionFile}.sha256`, `${extensionSha256}  ${path.basename(extensionFile)}\n`);
    extension = { file: extensionFile, sha256: extensionSha256, bytes: extensionBody.length };
  }
  return { file, sha256: digest, bytes: body.length, fileCount: entries.size, version: metadata.version, ...(extension ? { extension } : {}) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildRelease({ outputDir: process.argv[2] });
  console.log(JSON.stringify(result, null, 2));
}
