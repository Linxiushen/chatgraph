import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildShortcut } from '../../mobile/build-shortcut.mjs';

const context = vm.createContext({ URL });
vm.runInContext(await readFile(new URL('../destination.js', import.meta.url), 'utf8'), context);
const { parseDestination } = context.ChatGraphDestination;

test('workspace addresses require a root HTTPS origin or explicit loopback HTTP', () => {
  assert.equal(parseDestination(' https://graph.example.com:8443/ ').origin, 'https://graph.example.com:8443');
  assert.equal(parseDestination('https://graph.example.com:8443').permission, 'https://graph.example.com/*');
  assert.equal(parseDestination('http://127.0.0.1:4317').url, 'http://127.0.0.1:4317/');
  for (const value of ['', 'graph.example.com', 'http://graph.example.com', 'http://192.168.1.2:4317', 'javascript:alert(1)', 'https://name:secret@graph.example.com', 'https://graph.example.com/private', 'https://graph.example.com/?key=secret', 'https://graph.example.com/#data', 'http://127.0.0.1.evil.example:4317', 'https://*', 'https://*.example.com']) assert.throws(() => parseDestination(value), value);
});

test('iPhone capture artifact stays generated from the shared semantic extractor', async () => {
  const actual = await readFile(new URL('../../mobile/safari-shortcut.js', import.meta.url), 'utf8');
  assert.equal(actual, await buildShortcut());
  let completed = false;
  const page = vm.createContext({ URL, TextEncoder, document: {}, location: { href: 'https://example.com/' }, completion: () => { completed = true; } });
  assert.throws(() => vm.runInContext(actual, page), /不受支持/);
  assert.equal(completed, false, 'unsupported pages must stop before downstream copy/open actions');
  assert.equal(page.ChatGraphCapture, undefined, 'the Safari shortcut must not replace a global page adapter');
});
