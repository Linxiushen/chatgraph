import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { renderGraphPptx } from '../lib/pptx.mjs';
import { createZip, crc32 } from '../lib/zip.mjs';
import { createDemoGraph } from '../lib/demo.mjs';
import { organizeConversation } from '../lib/conversations.mjs';

function unzip(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const expectedLength = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const body = method === 8 ? inflateRawSync(buffer.subarray(start, start + size)) : buffer.subarray(start, start + size);
    assert.equal(body.length, expectedLength);
    assert.equal(crc32(body), buffer.readUInt32LE(offset + 14));
    files.set(name, body.toString('utf8'));
    offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  return files;
}

const notes = files => [...files].filter(([name]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
const slides = files => [...files].filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
const xmlEscape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

test('PPTX archive contains editable slides, complete node notes and source page citations', () => {
  const graph = createDemoGraph();
  const files = unzip(renderGraphPptx(graph));
  const slideFiles = slides(files);
  const noteFiles = notes(files);
  assert.ok(slideFiles.length >= graph.nodes.length + graph.messages.length + 3);
  assert.equal(slideFiles.length, noteFiles.length);
  assert.ok(slideFiles.every(([, xml]) => xml.includes('<p:sp>') && xml.includes('<a:t')));
  assert.ok(![...files.keys()].some(name => name.startsWith('ppt/media/')));
  const allNotes = noteFiles.map(([, xml]) => xml).join('\n');
  for (const node of graph.nodes) {
    assert.ok(allNotes.includes(`节点 ID：${node.id}`));
    assert.ok(allNotes.includes(xmlEscape(node.label)));
  }
  for (const message of graph.messages) {
    assert.equal(noteFiles.filter(([, xml]) => xml.includes(`原文 ID：${message.id}<`)).length, 1);
    assert.ok(allNotes.includes(xmlEscape(message.content)));
    assert.match(allNotes, new RegExp(`${message.id}：来源索引第 \\d+ 页`));
  }
  assert.ok(allNotes.includes('类型：revises'));
});

test('PPTX escapes injected XML and pagination preserves every detail line', () => {
  const graph = organizeConversation({ text: 'User: <script>& "原文"</script>', title: '<a:t>并非标签</a:t>' });
  graph.nodes[1].label = '较长节点标题'.repeat(60);
  graph.nodes[1].summary = Array.from({ length: 26 }, (_, i) => `第 ${i + 1} 行真实说明`).join('\n');
  graph.nodes[1].note = '最后一条备注 <末尾> &';
  const files = unzip(renderGraphPptx(graph));
  const allSlides = slides(files).map(([, xml]) => xml).join('\n');
  const allNotes = notes(files).map(([, xml]) => xml).join('\n');
  assert.ok(allNotes.includes('&lt;script&gt;&amp; &quot;原文&quot;&lt;/script&gt;'));
  assert.ok(allNotes.includes('最后一条备注 &lt;末尾&gt; &amp;'));
  for (let index = 1; index <= 26; index++) assert.ok(allSlides.includes(`第 ${index} 行真实说明`));
  assert.ok(allSlides.includes('（2/'));
  assert.ok(!allSlides.includes('<script>'));
  for (const [, xml] of slides(files)) {
    const body = xml.match(/<p:cNvPr id="4"[\s\S]*?<\/p:sp>/)?.[0];
    assert.ok((body.match(/<a:p>/g) || []).length <= 10);
  }
});

test('ZIP archive is reproducible and rejects unsafe names', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.deepEqual(createZip([['hello.txt', '你好']]), createZip([['hello.txt', '你好']]));
  assert.equal(unzip(createZip([['hello.txt', '你好']])).get('hello.txt'), '你好');
  assert.throws(() => createZip([['../escape', 'bad']]), /路径无效/);
  assert.throws(() => createZip([['duplicate', 'one'], ['duplicate', 'two']]), /重复/);
});
