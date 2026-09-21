// Real browser verification; every conversation below is a synthetic fixture.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';

const { chromium } = await import(process.env.CHATGRAPH_PLAYWRIGHT_PATH || 'playwright');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chatgraph-import-browser-'));
const output = fileURLToPath(new URL('../test-output/', import.meta.url));
await mkdir(output, { recursive: true });
let paidCalls = 0;
const server = createAppServer({ dataDir, env: {}, fetchImpl: async () => { paidCalls++; throw new Error('No provider call is permitted by this test'); } });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const mappingConversation = (title, contents) => {
  const mapping = { start: { parent: null, message: null } };
  contents.forEach((item, index) => {
    mapping[`node-${index + 1}`] = { parent: index ? `node-${index}` : 'start', message: { id: `source-${index + 1}`, author: { role: item.role }, content: { parts: [item.content] } } };
  });
  return { title, update_time: 1789862400, current_node: `node-${contents.length}`, mapping };
};
const archive = JSON.stringify([
  mappingConversation('不应导入的第一个会话', Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `UNSELECTED_PRIVATE_ACCOUNT_CONTENT_${index}${'x'.repeat(60_000)}` }))),
  mappingConversation('第二个会话：我的产品选择', [
    { role: 'user', content: 'OUTSIDE_RANGE_BEFORE：先讨论一个无关的旧方案。' },
    { role: 'unknown', content: 'CHOSEN_PERSONAL_VIEW：我希望保留自己改变判断的过程。' },
    { role: 'assistant', content: 'CHOSEN_AI_SUGGESTION：可以先验证观点和依据的追溯。' },
    { role: 'user', content: 'OUTSIDE_RANGE_AFTER：这条留到下次再整理。' },
  ]),
]);
assert.ok(Buffer.byteLength(archive) > 2 * 1024 * 1024);
const drafts = page => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('chatgraph-drafts', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
});
const pauseForDraft = page => page.waitForFunction(async () => {
  const db = await new Promise(resolve => { const request = indexedDB.open('chatgraph-drafts', 1); request.onsuccess = () => resolve(request.result); });
  return await new Promise(resolve => { const request = db.transaction('drafts').objectStore('drafts').getAll(); request.onsuccess = () => resolve(request.result.some(item => item.kind === 'pending-import' && item.input.text.includes('CHOSEN_PERSONAL_VIEW'))); });
});
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1050 } });
  page = await context.newPage();
  const errors = [], posts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push({ url: request.url(), body: request.postData() || '' }); });
  await page.goto(base); await page.waitForSelector('.graph-node');
  await page.locator('[data-action="import"]').click();
  await page.getByLabel('选择对话文件或 ChatGPT 账号导出', { exact: true }).setInputFiles({ name: 'conversations.json', mimeType: 'application/json', buffer: Buffer.from(archive) });
  await page.getByLabel('选择要导入的会话', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('对话内容', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '开始整理', exact: true }).isDisabled(), true);
  assert.equal(posts.length, 0);
  assert.ok(!JSON.stringify(await drafts(page)).includes('UNSELECTED_PRIVATE_ACCOUNT_CONTENT'));
  await page.getByLabel('查找会话标题', { exact: true }).fill('产品选择');
  assert.equal(await page.getByLabel('选择要导入的会话', { exact: true }).locator('option').count(), 2);
  await page.getByLabel('选择要导入的会话', { exact: true }).selectOption('1');
  assert.match(await page.locator('.import-selection-status').textContent(), /4 \/ 4.*1 条说话者未标注/);
  assert.ok(!(await page.locator('.import-message-list').textContent()).includes('UNSELECTED_PRIVATE_ACCOUNT_CONTENT'));
  console.log('PASS account export larger than 2 MiB stays local and requires explicit conversation selection');

  await page.getByLabel('第 2 条消息的说话者', { exact: true }).selectOption('user');
  await page.getByLabel('起始消息编号', { exact: true }).fill('2');
  await page.getByLabel('结束消息编号', { exact: true }).fill('3');
  assert.equal(await page.getByRole('button', { name: '使用选中的对话', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '更新预览', exact: true }).click();
  assert.match(await page.locator('.import-selection-status').textContent(), /2 \/ 4.*0 条说话者未标注.*部分对话/);
  assert.equal(await page.locator('.import-message').count(), 2);
  await page.locator('.import-message-list').scrollIntoViewIfNeeded();
  assert.equal(await page.getByRole('button', { name: '使用选中的对话', exact: true }).evaluate(button => {
    const rect = button.getBoundingClientRect();
    const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && button.contains(center);
  }), true, 'The selection confirmation must be inside the viewport and not covered by the modal footer');
  await page.screenshot({ path: path.join(output, 'import-conversation-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  await pauseForDraft(page);
  const selected = JSON.parse(await page.getByLabel('对话内容', { exact: true }).inputValue());
  assert.deepEqual(selected.messages.map(message => message.role), ['user', 'assistant']);
  assert.equal(selected.source.complete, 'partial');
  const retained = JSON.stringify(await drafts(page));
  assert.ok(retained.includes('CHOSEN_PERSONAL_VIEW'));
  for (const excluded of ['UNSELECTED_PRIVATE_ACCOUNT_CONTENT', 'OUTSIDE_RANGE_BEFORE', 'OUTSIDE_RANGE_AFTER']) assert.ok(!retained.includes(excluded));
  assert.equal(posts.length, 0);
  console.log('PASS message range and corrected speakers are previewed before only selected text reaches IndexedDB');

  // Refresh after selection must recover exactly this excerpt, not the account file.
  await page.reload(); await page.waitForSelector('.graph-node');
  await page.locator('#resume-import').click();
  assert.deepEqual(JSON.parse(await page.getByLabel('对话内容', { exact: true }).inputValue()), selected);
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('已保存'));
  const imported = posts.find(request => new URL(request.url).pathname === '/api/import');
  assert.ok(imported); assert.ok(imported.body.includes('CHOSEN_PERSONAL_VIEW'));
  for (const request of posts) for (const excluded of ['UNSELECTED_PRIVATE_ACCOUNT_CONTENT', 'OUTSIDE_RANGE_BEFORE', 'OUTSIDE_RANGE_AFTER']) assert.ok(!request.body.includes(excluded));
  const library = await (await context.request.get(`${base}/api/graphs`)).json();
  const graphId = library.find(item => item.title === '第二个会话：我的产品选择').id;
  const graph = await (await context.request.get(`${base}/api/graphs/${graphId}`)).json();
  assert.equal(graph.messages.length, 2); assert.equal(graph.source.complete, 'partial');
  console.log('PASS refresh recovers the selected excerpt and server imports only those messages with partial provenance');

  await page.locator('[data-action="import"]').click();
  const smallArchive = JSON.stringify([mappingConversation('未选择会话一', [{ role: 'user', content: 'PASTED_ARCHIVE_NEVER_STORED' }]), mappingConversation('未选择会话二', [{ role: 'user', content: 'PASTED_SECOND_NEVER_STORED' }])]);
  await page.getByLabel('对话内容', { exact: true }).fill(smallArchive);
  await page.getByLabel('这次思考的标题', { exact: true }).fill('暂未选择的账号导出');
  assert.ok(!JSON.stringify(await drafts(page)).includes('PASTED_ARCHIVE_NEVER_STORED'));
  const previousPosts = posts.length;
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page.getByLabel('选择要导入的会话', { exact: true }).waitFor();
  assert.equal(posts.length, previousPosts);
  assert.equal(await page.getByLabel('对话内容', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.ok(!JSON.stringify(await drafts(page)).includes('PASTED_ARCHIVE_NEVER_STORED'));
  console.log('PASS pasted account exports cannot bypass selection or persist their full contents');

  await page.locator('[data-action="import"]').click();
  await page.getByLabel('选择对话文件或 ChatGPT 账号导出', { exact: true }).setInputFiles({ name: 'saved-graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)) });
  await page.getByRole('button', { name: '使用这张图谱', exact: true }).waitFor();
  assert.equal(await page.getByLabel('起始消息编号', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '使用这张图谱', exact: true }).click();
  assert.deepEqual(JSON.parse(await page.getByLabel('对话内容', { exact: true }).inputValue()), graph);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  console.log('PASS saved graph files retain full structures without message selection or paid calls');

  await page.locator('[data-action="import"]').click();
  const oversized = JSON.stringify({ title: '超长单条消息的范围恢复', messages: [{ id: 'huge', role: 'user', content: 'x'.repeat(100_001) }, { id: 'valid', role: 'user', content: '这条较短的结论仍然可以导入。' }] });
  await page.getByLabel('选择对话文件或 ChatGPT 账号导出', { exact: true }).setInputFiles({ name: 'oversized-message.json', mimeType: 'application/json', buffer: Buffer.from(oversized) });
  await page.getByLabel('起始消息编号', { exact: true }).fill('2');
  await page.getByLabel('结束消息编号', { exact: true }).fill('2');
  await page.getByRole('button', { name: '更新预览', exact: true }).click();
  await page.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  assert.equal(JSON.parse(await page.getByLabel('对话内容', { exact: true }).inputValue()).messages[0].id, 'valid');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  console.log('PASS an oversized unselected message does not block selecting another valid range');

  await page.locator('[data-action="import"]').click();
  const firstSource = JSON.stringify({ title: '自动标题一', source: { platform: 'ChatGPT', url: 'https://example.com/first', complete: 'provided' }, messages: [{ role: 'user', content: '第一份导入。' }] });
  const secondSource = JSON.stringify({ title: '自动标题二', messages: [{ role: 'user', content: '第二份导入。' }] });
  const upload = content => page.getByLabel('选择对话文件或 ChatGPT 账号导出', { exact: true }).setInputFiles({ name: 'conversation.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  await upload(firstSource); await page.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  assert.equal(await page.getByLabel('原始对话链接', { exact: true }).inputValue(), 'https://example.com/first');
  await upload(secondSource); await page.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  assert.equal(await page.getByLabel('这次思考的标题', { exact: true }).inputValue(), '自动标题二');
  assert.equal(await page.getByLabel('原始对话链接', { exact: true }).inputValue(), '');
  await page.getByLabel('这次思考的标题', { exact: true }).fill('我自己写的标题');
  await page.getByLabel('原始对话链接', { exact: true }).fill('https://example.com/manual');
  await upload(firstSource); await page.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  assert.equal(await page.getByLabel('这次思考的标题', { exact: true }).inputValue(), '我自己写的标题');
  assert.equal(await page.getByLabel('原始对话链接', { exact: true }).inputValue(), 'https://example.com/manual');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  console.log('PASS title and source updates preserve manual edits and never inherit a stale automatic URL');

  await page.locator('[data-action="import"]').click();
  const largeUtf8 = JSON.stringify({ messages: Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: '中'.repeat(90_000) })) });
  await upload(largeUtf8);
  await page.getByLabel('结束消息编号', { exact: true }).fill('9');
  await page.getByRole('button', { name: '更新预览', exact: true }).click();
  await page.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  assert.match(await page.locator('.import-selection .form-error').textContent(), /2 MB/);
  assert.equal(await page.getByLabel('对话内容', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  console.log('PASS encoded UTF-8 request limit rejects an oversized selected range before storage or network');

  const largeGraph = { ...graph, id: 'large-graph-restore-fixture', revision: 0, title: '完整中文图谱恢复', messages: [
    ...graph.messages.map(message => ({ ...message, content: '中'.repeat(70_000) })),
    ...Array.from({ length: 10 }, (_, index) => ({ id: `large-extra-${index}`, role: 'user', content: '文'.repeat(70_000) })),
  ] };
  assert.ok(Buffer.byteLength(JSON.stringify(largeGraph)) > 2 * 1024 * 1024);
  await page.locator('[data-action="import"]').click();
  await upload(JSON.stringify(largeGraph, null, 2));
  await page.getByRole('button', { name: '使用这张图谱', exact: true }).click();
  assert.equal(await page.locator('input[name="import-mode"][value="outline"]').isChecked(), true);
  await page.getByLabel('对话内容', { exact: true }).fill('\uFEFF' + JSON.stringify(largeGraph));
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('已保存'));
  const restoredId = (await (await context.request.get(`${base}/api/graphs`)).json()).find(item => item.title === largeGraph.title).id;
  const restored = await (await context.request.get(`${base}/api/graphs/${restoredId}`)).json();
  assert.deepEqual(restored.messages, largeGraph.messages);
  assert.deepEqual(restored.edges, largeGraph.edges);
  assert.equal(paidCalls, 0); assert.deepEqual(errors, []);
  console.log('PASS saved graph above 2 MiB restores every UTF-8 source and relationship without invoking a model');
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(output, 'import-browser-failure.png'), fullPage: true }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-6000)); }
  throw error;
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true });
}
