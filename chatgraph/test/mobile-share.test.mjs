import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { classifyMobileText, normalizeMobileShare, shareFromFormData, readMobileFile, MOBILE_SHARE_LIMITS } from '../public/mobile.js';

test('mobile sharing recognizes URLs in text, url and Android title fields without inventing a transcript', () => {
  const link = 'https://chatgpt.com/share/example';
  for (const input of [{ text: link }, { url: link }, { title: link }, { title: '产品讨论', text: `产品讨论\n${link}` }, { title: '产品讨论', text: '产品讨论', url: link }, { text: `Check out this conversation: ${link}` }]) {
    const share = normalizeMobileShare(input);
    assert.equal(share.kind, 'link');
    assert.equal(share.text, '');
    assert.equal(share.url, link);
  }
});

test('actual user dialogue mentioning a share link stays text', () => {
  const text = '我：查看这个方案 https://chatgpt.com/share/example\nAI：我想先讨论验证方法。';
  assert.deepEqual(classifyMobileText(text), { text, url: '', kind: 'text' });
  const caption = '我不同意这个论证。https://chatgpt.com/share/example';
  assert.equal(classifyMobileText(caption).text, caption);
});

test('mobile records reject unsafe URLs, binary control text, missing contents and forged ids', () => {
  for (const url of ['javascript:alert(1)', 'file:///private/conversation.json', 'https://person:secret@example.com/chat', 'https://']) {
    assert.throws(() => normalizeMobileShare({ text: '内容', url }), { code: 'url' });
  }
  assert.throws(() => normalizeMobileShare({ title: '只有标题' }), { code: 'empty' });
  assert.throws(() => normalizeMobileShare({ text: 'binary\u0000payload' }), { code: 'file' });
  assert.throws(() => normalizeMobileShare({ text: '内容', id: '../../private' }), { code: 'format' });
  assert.throws(() => normalizeMobileShare({ text: { messages: [] } }), { code: 'format' });
});

test('text size uses UTF-8 bytes and unknown input fields are not retained', () => {
  assert.throws(() => normalizeMobileShare({ text: '中'.repeat(Math.ceil(MOBILE_SHARE_LIMITS.text / 3)) }), { code: 'size' });
  const record = normalizeMobileShare({ text: '我：值得保留的判断。', title: '产品探索', apiKey: 'never-copy-this', arbitrary: 'not-retained' });
  assert.equal('apiKey' in record, false);
  assert.equal('arbitrary' in record, false);
  assert.equal(record.kind, 'text');
  assert.equal(record.bytes, Buffer.byteLength(record.text + record.title));
});

test('one UTF-8 account export can pass through locally without forcing a conversation choice', async () => {
  const body = JSON.stringify([{ title: '第一段', messages: [{ role: 'user', content: '用户自己的判断。' }] }, { title: '第二段', messages: [{ role: 'assistant', content: '另一个观点。' }] }]);
  const file = new File([body], 'conversations.json', { type: 'application/json' });
  const record = await readMobileFile(file);
  assert.equal(record.kind, 'file');
  assert.equal(record.text, body);
  assert.equal(record.fileName, 'conversations.json');
  const form = new FormData(); form.append('files', file); form.append('title', '我的导出'); form.append('text', '系统分享时附带的标题');
  const shared = await shareFromFormData(form);
  assert.equal(shared.text, body);
  assert.equal(shared.title, '我的导出');
});

test('mobile file import rejects binary, malformed UTF-8, unsupported media and oversize before reading', async () => {
  for (const file of [new File([new Uint8Array([0, 1, 2])], 'fake.txt'), new File([new Uint8Array([0xff, 0xfe, 0x80])], 'bad.txt'), new File(['%PDF'], 'document.pdf'), new File(['image'], 'fake.txt', { type: 'image/png' })]) {
    await assert.rejects(readMobileFile(file), { code: 'file' });
  }
  await assert.rejects(readMobileFile({ name: 'huge.txt', size: MOBILE_SHARE_LIMITS.file + 1, arrayBuffer() { throw new Error('must not read'); } }), { code: 'size' });
  await assert.rejects(readMobileFile(new File([' \n'], 'empty.txt')), { code: 'empty' });
});

test('share form rejects multiple files, duplicate fields and non-string text fields', async () => {
  const multiple = new FormData(); multiple.append('files', new File(['one'], 'one.txt')); multiple.append('files', new File(['two'], 'two.txt'));
  await assert.rejects(shareFromFormData(multiple), { code: 'multiple' });
  const repeated = new FormData(); repeated.append('text', 'one'); repeated.append('text', 'two');
  await assert.rejects(shareFromFormData(repeated), { code: 'format' });
  const nonText = new FormData(); nonText.append('text', new File(['one'], 'one.txt'));
  await assert.rejects(shareFromFormData(nonText), { code: 'format' });
});

test('share form handles the empty file field sent by text-only share intents', async () => {
  const form = new FormData(); form.append('text', '我：保留这次判断。'); form.append('files', new File([], ''));
  const record = await shareFromFormData(form);
  assert.equal(record.kind, 'text');
  assert.equal(record.text, '我：保留这次判断。');
});
