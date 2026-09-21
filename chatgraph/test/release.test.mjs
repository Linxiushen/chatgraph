import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { buildRelease } from '../scripts/package-release.mjs';

function archiveFiles(buffer) {
  const entries = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, inflateRawSync(buffer.subarray(start, start + size)));
    offset = start + size;
  }
  return entries;
}
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgraph-release-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  return directory;
}

test('release allowlist excludes private data and produces reproducible archives', async t => {
  const directory = await temporary(t);
  const files = {
    'chatgraph/package.json': '{"version":"0.2.0"}',
    'chatgraph/server.mjs': '// public server',
    'chatgraph/LICENSE': 'MIT',
    'chatgraph/.env.example': 'CHATGRAPH_API_KEY=',
    'chatgraph/.gitignore': '.env\n.data/',
    '.dockerignore': '**/.env\n**/.data/',
    'chatgraph/extension/manifest.json': '{"manifest_version":3,"name":"ChatGraph","version":"0.2.0"}',
    'chatgraph/.env': 'private-placeholder',
    'chatgraph/.env.production': 'private-placeholder',
    'chatgraph/research/.private.json': 'private-placeholder',
    'chatgraph/research/.hidden/nested.json': 'private-placeholder',
    'chatgraph/.data/private.json': 'private-placeholder',
    'chatgraph/lib/example.mjs': 'export const value = 1;',
    'chatgraph/integrations/chatgpt/node_modules/private.json': 'private-placeholder',
    'chatgraph/test-output/private.json': 'private-placeholder',
    'archify/assets/template.html': '<html>template</html>',
    'archify/renderers/shared/utils.mjs': '// utilities',
    'archify/renderers/shared/i18n.mjs': '// translations',
    'ARCHIFY_README.md': '# Upstream\n![Preview](docs/assets/preview.png)\n[Changelog](CHANGELOG.md#unreleased)\n[License](LICENSE)\n[Examples](archify/examples/)\n',
    'LICENSE': 'MIT',
  };
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), content); }
  const first = await buildRelease({ repositoryDir: directory, outputDir: path.join(directory, 'out1') });
  const second = await buildRelease({ repositoryDir: directory, outputDir: path.join(directory, 'out2') });
  assert.equal(first.sha256, second.sha256);
  const entries = archiveFiles(await fs.readFile(first.file));
  assert.ok(entries.has('chatgraph-0.2.0/chatgraph/.env.example'));
  assert.ok(entries.has('chatgraph-0.2.0/SHA256SUMS'));
  assert.ok(entries.has('chatgraph-0.2.0/.dockerignore'));
  assert.ok(entries.has('chatgraph-0.2.0/chatgraph/.gitignore'));
  const upstreamReadme = entries.get('chatgraph-0.2.0/ARCHIFY_README.md').toString('utf8');
  assert.match(upstreamReadme, /https:\/\/raw\.githubusercontent\.com\/tt-a1i\/archify\/72c750bb070d95171dbb2244e5b62b1b7da69c12\/docs\/assets\/preview\.png/);
  assert.match(upstreamReadme, /github\.com\/tt-a1i\/archify\/blob\/72c750bb070d95171dbb2244e5b62b1b7da69c12\/CHANGELOG\.md#unreleased/);
  assert.match(upstreamReadme, /github\.com\/tt-a1i\/archify\/tree\/72c750bb070d95171dbb2244e5b62b1b7da69c12\/archify\/examples\//);
  assert.ok(upstreamReadme.includes('[License](LICENSE)'));
  assert.equal(await fs.readFile(path.join(directory, 'ARCHIFY_README.md'), 'utf8'), files['ARCHIFY_README.md']);
  assert.equal(first.extension.sha256, second.extension.sha256);
  const extension = archiveFiles(await fs.readFile(first.extension.file));
  assert.ok(extension.has('manifest.json'));
  assert.ok(extension.has('LICENSE'));
  assert.ok([...entries.values()].every(content => !content.includes('private-placeholder')));
  assert.ok([...entries.keys()].every(name => !name.includes('node_modules') && !name.includes('/.data/') && !name.includes('/test-output/')));
});

test('release rejects symlink metadata before reading it and symlink source files before packing', async t => {
  const directory = await temporary(t);
  await fs.mkdir(path.join(directory, 'chatgraph'), { recursive: true });
  await fs.writeFile(path.join(directory, 'metadata-target.json'), '{"version":"0.2.0"}');
  await fs.symlink('../metadata-target.json', path.join(directory, 'chatgraph/package.json'));
  await assert.rejects(buildRelease({ repositoryDir: directory }), /符号链接/);
  await fs.unlink(path.join(directory, 'chatgraph/package.json'));
  await fs.writeFile(path.join(directory, 'chatgraph/package.json'), '{"version":"0.2.0"}');
  for (const file of ['archify/assets/template.html', 'archify/renderers/shared/utils.mjs', 'archify/renderers/shared/i18n.mjs']) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fs.writeFile(path.join(directory, file), 'public');
  }
  await fs.symlink('../metadata-target.json', path.join(directory, 'chatgraph/server.mjs'));
  await assert.rejects(buildRelease({ repositoryDir: directory }), /发布源包含符号链接/);
  await fs.unlink(path.join(directory, 'chatgraph/server.mjs'));
  await fs.writeFile(path.join(directory, 'chatgraph/server.mjs'), 'public');
  await fs.rename(path.join(directory, 'archify'), path.join(directory, 'archify-target'));
  await fs.symlink('archify-target', path.join(directory, 'archify'));
  await assert.rejects(buildRelease({ repositoryDir: directory }), /发布源包含符号链接.*archify/);
});

test('extracted release serves the app and standalone Archify export outside the checkout', async t => {
  const directory = await temporary(t);
  const repositoryDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const release = await buildRelease({ repositoryDir, outputDir: path.join(directory, 'archive') });
  const entries = archiveFiles(await fs.readFile(release.file));
  const extracted = path.join(directory, 'extracted');
  for (const [name, content] of entries) {
    assert.ok(!name.split('/').includes('..'));
    const target = path.join(extracted, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  const module = await import(pathToFileURL(path.join(extracted, `chatgraph-${release.version}/chatgraph/server.mjs`)).href);
  const server = module.createAppServer({ dataDir: path.join(directory, 'data'), env: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(base)).status, 200);
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json()).share_target.method, 'POST');
  assert.equal((await fetch(`${base}/mobile-assets/safari-shortcut.js`)).status, 200);
  const graph = await (await fetch(`${base}/api/demo`)).json();
  const exported = await fetch(`${base}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph, format: 'html' }) });
  assert.equal(exported.status, 200);
  assert.match(await exported.text(), /Archify/);
});
