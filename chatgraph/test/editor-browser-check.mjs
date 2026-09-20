// Optional integration checks for the editable knowledge workspace.
// Run with CHATGRAPH_PLAYWRIGHT_PATH pointing to an installed playwright module.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';

const { chromium } = await import(process.env.CHATGRAPH_PLAYWRIGHT_PATH || 'playwright');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chatgraph-editor-'));
const output = fileURLToPath(new URL('../test-output/', import.meta.url));
await mkdir(output, { recursive: true });
let providerCalls = 0, releaseProvider, signalProviderStarted;
const providerStarted = new Promise(resolve => { signalProviderStarted = resolve; });
const server = createAppServer({ dataDir, env: {}, fetchImpl: async () => {
  providerCalls++; signalProviderStarted();
  await new Promise(resolve => { releaseProvider = resolve; });
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '恢复任务验证', nodes: [
    { id: 'root', label: '任务恢复', type: 'topic', stance: 'unknown', status: 'open', parentId: null, sourceIds: [] },
    { id: 'recovered-choice', label: '刷新以后继续同一个任务', type: 'claim', stance: 'user', status: 'confirmed', parentId: 'root', sourceIds: ['m-1'] },
  ], edges: [] }) } }] });
} });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
let inspectedPage;
const saved = page => page.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('已保存'));
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); inspectedPage = page; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.waitForSelector('.graph-node');
  const original = await page.getByLabel('编辑观点名称', { exact: true }).inputValue();
  await page.getByLabel('编辑观点名称', { exact: true }).fill('自动保存与重做验证');
  await page.getByLabel('编辑观点名称', { exact: true }).press('Tab'); await saved(page);
  await page.getByRole('button', { name: '撤销上一步', exact: true }).click();
  assert.equal(await page.getByLabel('编辑观点名称', { exact: true }).inputValue(), original);
  await page.getByRole('button', { name: '重做上一步', exact: true }).click();
  assert.equal(await page.getByLabel('编辑观点名称', { exact: true }).inputValue(), '自动保存与重做验证');
  await page.getByLabel('重要程度', { exact: true }).selectOption('5');
  await page.getByLabel('上级观点', { exact: true }).selectOption('demo-entry'); await saved(page);
  const graph = await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json();
  assert.equal(graph.nodes.find(node => node.id === 'demo-ownership').parentId, 'demo-entry');
  assert.equal(graph.nodes.find(node => node.id === 'demo-ownership').importance, 5);
  assert.ok(graph.revision >= 2);
  console.log('PASS auto-save, revision-safe undo/redo, parent change and importance persistence');

  await page.getByRole('tab', { name: '思考轨迹', exact: true }).click();
  assert.ok(await page.locator('.timeline-event').count() > 0);
  assert.ok(await page.locator('.timeline-revises').count() > 0);
  await page.screenshot({ path: path.join(output, 'reasoning-timeline.png') });
  await page.getByRole('button', { name: '多选观点', exact: true }).click();
  await page.getByRole('dialog').locator('input[type="checkbox"]').nth(1).check();
  await page.getByRole('dialog').locator('input[type="checkbox"]').nth(2).check();
  await page.getByRole('button', { name: '确定选择', exact: true }).click();
  await page.getByLabel('批量设置重要程度', { exact: true }).selectOption('4');
  assert.match(await page.locator('#batch-bar').textContent(), /已选择 2 个观点/);
  await page.getByRole('button', { name: '取消选择', exact: true }).click(); await saved(page);
  console.log('PASS source-grounded timeline and multi-select batch editing');

  await page.route('**/api/graphs', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  await page.getByLabel('编辑观点名称', { exact: true }).fill('刷新后找回的真实草稿');
  // Stay inside the input: draft persistence must not depend on a blur event.
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('保存失败'));
  await page.reload(); await page.waitForSelector('.timeline-event, .graph-node');
  assert.equal(await page.getByLabel('编辑观点名称', { exact: true }).inputValue(), '刷新后找回的真实草稿');
  await page.unroute('**/api/graphs');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await saved(page);
  console.log('PASS durable IndexedDB draft recovery after failed save and reload');

  const before = await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json();
  // Hold animation callbacks until the user has already focused and typed in
  // the conversation field. Old deferred modal/title autofocus stole that focus.
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    const queued = [];
    window.requestAnimationFrame = callback => { queued.push(callback); return queued.length; };
    window.flushEditorFocusFrames = () => {
      window.requestAnimationFrame = original;
      for (const callback of queued.splice(0)) callback(performance.now());
      delete window.flushEditorFocusFrames;
    };
  });
  await page.getByRole('button', { name: '追加对话', exact: true }).click();
  await page.getByLabel('这次思考的标题', { exact: true }).fill('第二次产品增长验证');
  await page.getByLabel('对话内容', { exact: true }).fill('我：产品增长验证需要先访谈十位用户。\nAI：可以记录他们查找旧观点花费的时间。');
  await page.evaluate(() => window.flushEditorFocusFrames());
  await page.keyboard.insertText('这段补充必须留在对话里。');
  assert.match(await page.getByLabel('对话内容', { exact: true }).inputValue(), /这段补充必须留在对话里。$/);
  assert.equal(await page.getByLabel('这次思考的标题', { exact: true }).inputValue(), '第二次产品增长验证');
  console.log('PASS opening a modal cannot steal focus after the user starts typing');
  await page.getByRole('button', { name: '追加到图谱', exact: true }).click();
  await page.waitForSelector('.modal-backdrop', { state: 'detached' }); await saved(page);
  const appended = await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json();
  assert.equal(appended.messages.length, before.messages.length + 2);
  assert.ok(appended.sessions.length >= 2);
  assert.ok(appended.nodes.some(node => node.label === '刷新后找回的真实草稿'));
  console.log('PASS append retains existing edits, source messages and session provenance');

  await page.getByRole('button', { name: '搜索全部观点与原文', exact: true }).click();
  await page.getByLabel('搜索全部观点与原文', { exact: true }).fill('产品增长验证');
  await page.waitForSelector('.knowledge-result');
  assert.match(await page.locator('.knowledge-results').textContent(), /产品增长验证/);
  await page.locator('.knowledge-result').first().click();
  await page.getByRole('button', { name: '查看版本历史', exact: true }).click();
  await page.waitForSelector('.history-entry');
  assert.ok(await page.locator('.history-entry').count() >= 3);
  const restores = page.getByRole('button', { name: '恢复此版本', exact: true });
  await restores.last().click(); await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  const restored = await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json();
  assert.ok(restored.revision > appended.revision);
  assert.equal(restored.messages.length, before.messages.length);
  console.log('PASS full-library search and version restore with increasing revisions');

  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整知识库备份', exact: true }).click();
  const download = await downloadPromise; await mkdir(path.join(dataDir, 'downloads')); const backupPath = path.join(dataDir, 'downloads', 'backup.json'); await download.saveAs(backupPath);
  await page.getByLabel('选择知识库备份文件', { exact: true }).setInputFiles(backupPath);
  await page.getByRole('button', { name: '恢复备份', exact: true }).click();
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  const library = await (await context.request.get(`${base}/api/graphs`)).json();
  assert.equal(library.length, 2);
  console.log('PASS full-library backup download and conflict-safe copy restore');

  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('button', { name: '创建只读分享链接', exact: true }).click();
  await page.getByRole('button', { name: '创建只读链接', exact: true }).click();
  await page.waitForSelector('[aria-label="只读分享链接"]');
  assert.match(await page.locator('.share-result').textContent(), /同一台电脑/);
  const shareUrl = await page.getByLabel('只读分享链接', { exact: true }).inputValue();
  assert.equal((await context.request.get(shareUrl)).status(), 200);
  await page.getByRole('button', { name: '撤销此链接', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.share-result')?.textContent.includes('已撤销'));
  assert.equal((await context.request.get(shareUrl)).status(), 404);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  console.log('PASS scoped read-only sharing and immediate revocation');

  const ack = await page.evaluate(() => new Promise(resolve => {
    const requestId = 'capture-test';
    const receive = event => { if (event.data?.type === 'chatgraph:import:ack' && event.data.requestId === requestId) { window.removeEventListener('message', receive); resolve(event.data); } };
    window.addEventListener('message', receive);
    window.postMessage({ type: 'chatgraph:import', version: 1, requestId, capture: { title: '浏览器捕获预览', platform: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/example', messages: [{ id: 'capture-user', role: 'user', content: '只预览，不自动发送到模型。' }], capture: { complete: 'unknown', warnings: ['当前分支可能尚未全部加载。'] } } }, location.origin);
  }));
  assert.equal(ack.ok, true);
  assert.equal(await page.getByLabel('这次思考的标题', { exact: true }).inputValue(), '浏览器捕获预览');
  assert.match(await page.locator('.capture-notice').textContent(), /完整性尚未确认/);
  assert.equal((await (await context.request.get(`${base}/api/graphs`)).json()).length, 2);
  console.log('PASS browser-extension capture handoff opens review without automatically importing');
  await page.getByRole('button', { name: '取消', exact: true }).click();

  let releaseJobAcknowledgement, signalJobSubmitted, signalJobCancelled;
  const jobSubmitted = new Promise(resolve => { signalJobSubmitted = resolve; });
  const jobCancelled = new Promise(resolve => { signalJobCancelled = resolve; });
  const delayedId = '00000000-0000-4000-8000-000000000001';
  await page.route('**/api/jobs', async route => {
    signalJobSubmitted();
    await new Promise(resolve => { releaseJobAcknowledgement = resolve; });
    await route.fulfill({ status: 202, json: { id: delayedId, status: 'running', progress: 1 } });
  });
  await page.route(`**/api/jobs/${delayedId}`, async route => {
    assert.equal(route.request().method(), 'DELETE');
    await route.fulfill({ json: { id: delayedId, status: 'cancelled' } }); signalJobCancelled();
  });
  await page.locator('[data-action="import"]').first().click();
  await page.getByLabel('对话内容', { exact: true }).fill('我：不要在停止后继续调用模型。');
  await page.locator('input[name="import-mode"][value="ai"]').check();
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await Promise.race([jobSubmitted, new Promise((_, reject) => setTimeout(() => reject(new Error('AI job submission was not observed')), 5000))]);
  await page.getByRole('button', { name: '停止整理', exact: true }).click();
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  releaseJobAcknowledgement();
  await Promise.race([jobCancelled, new Promise((_, reject) => setTimeout(() => reject(new Error('Delayed AI job was not cancelled')), 5000))]);
  await page.unroute('**/api/jobs'); await page.unroute(`**/api/jobs/${delayedId}`);
  console.log('PASS cancelling before the job acknowledgement still cancels the eventual backend job');

  const current = await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json();
  let semanticCalls = 0;
  await page.route('**/api/search', async route => {
    semanticCalls++;
    assert.equal(route.request().method(), 'POST');
    assert.equal(route.request().postDataJSON().query, '找回被否定的方案');
    await route.fulfill({ json: [{ id: current.id, title: current.title, matchType: 'semantic', score: .9, nodes: [{ id: 'demo-abandoned', label: '暂缓完整 PPT 与团队协作', summary: '曾经讨论后否定的方案' }], messages: [] }] });
  });
  await page.getByRole('button', { name: '搜索全部观点与原文', exact: true }).click();
  await page.getByLabel('AI 关联检索', { exact: true }).check();
  await page.getByLabel('搜索全部观点与原文', { exact: true }).fill('找回被否定的方案');
  await page.waitForTimeout(500);
  assert.equal(semanticCalls, 0);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.waitForSelector('.knowledge-result');
  assert.equal(semanticCalls, 1);
  await page.locator('.knowledge-result').first().click();
  await page.unroute('**/api/search');
  await page.route('**/api/relations/suggest', route => route.fulfill({ json: { relations: [{ id: 'suggestion-a', source: 'demo-pain', target: 'demo-platform', type: 'depends', label: '需要入口支持', explanation: '候选关联应先由用户核对。', evidenceIds: [current.messages[0].id] }] } }));
  const edgeCount = current.edges.length;
  await page.getByRole('button', { name: '发现关联', exact: true }).click();
  await page.getByRole('button', { name: '查找关联', exact: true }).click();
  await page.waitForSelector('.relation-suggestion');
  assert.equal((await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json()).edges.length, edgeCount);
  await page.getByRole('button', { name: '添加此关系', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click(); await saved(page);
  assert.equal((await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json()).edges.length, edgeCount + 1);
  await page.unroute('**/api/relations/suggest');
  console.log('PASS semantic search calls model only on submit and suggested relationships require selection');

  const remote = await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json();
  await context.request.post(`${base}/api/graphs`, { data: { ...remote, title: '另一页面已保存的版本' } });
  await page.getByLabel('编辑观点名称', { exact: true }).fill('本页面不能丢失的独立修改');
  await page.getByLabel('编辑观点名称', { exact: true }).press('Tab');
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('版本冲突'));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '将草稿另存为副本', exact: true }).click();
  await page.waitForSelector('.modal-backdrop', { state: 'detached' }); await saved(page);
  const afterConflict = await (await context.request.get(`${base}/api/graphs`)).json();
  assert.equal(afterConflict.length, 3);
  assert.equal((await (await context.request.get(`${base}/api/graphs/chatgraph-demo`)).json()).title, '另一页面已保存的版本');
  const draftCopy = afterConflict.find(item => item.title.endsWith('草稿副本'));
  assert.ok(draftCopy);
  const copy = await (await context.request.get(`${base}/api/graphs/${draftCopy.id}`)).json();
  assert.ok(copy.nodes.some(node => node.label === '本页面不能丢失的独立修改'));
  console.log('PASS revision conflict preserves external save and can save the local draft as a copy');
  const tabA = await context.newPage(), tabB = await context.newPage();
  for (const tab of [tabA, tabB]) {
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto(base); await tab.waitForSelector('.graph-node');
    await tab.route('**/api/graphs', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  }
  await tabA.getByLabel('编辑观点名称', { exact: true }).fill('窗口 A 的独立未保存草稿');
  await tabB.getByLabel('编辑观点名称', { exact: true }).fill('窗口 B 的独立未保存草稿');
  for (const tab of [tabA, tabB]) await tab.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('保存失败'));
  const snapshots = await tabA.evaluate(async () => {
    const { draftStore } = await import('/draft-store.js');
    return (await draftStore.all()).filter(draft => draft.graph).map(draft => ({ id: draft.id, owner: draft.owner, labels: draft.graph.nodes.map(node => node.label) }));
  });
  const draftA = snapshots.find(draft => draft.labels.includes('窗口 A 的独立未保存草稿'));
  const draftB = snapshots.find(draft => draft.labels.includes('窗口 B 的独立未保存草稿'));
  assert.ok(draftA && draftB); assert.notEqual(draftA.owner, draftB.owner); assert.notEqual(draftA.id, draftB.id);
  await tabA.unroute('**/api/graphs'); await tabA.getByRole('button', { name: '保存', exact: true }).click(); await saved(tabA);
  const afterOtherSave = await tabB.evaluate(async () => (await (await import('/draft-store.js')).draftStore.all()).filter(draft => draft.graph).map(draft => draft.graph.nodes.map(node => node.label)));
  assert.ok(afterOtherSave.some(labels => labels.includes('窗口 B 的独立未保存草稿')));
  await tabB.reload(); await tabB.waitForSelector('.graph-node');
  assert.equal(await tabB.getByLabel('编辑观点名称', { exact: true }).inputValue(), '窗口 B 的独立未保存草稿');
  assert.match(await tabB.locator('#save-state').textContent(), /版本冲突/);
  console.log('PASS per-tab draft namespaces retain both edits and one save never erases the other draft');

  const recoveryPage = await context.newPage(); inspectedPage = recoveryPage;
  recoveryPage.on('pageerror', error => errors.push(error.message));
  let jobPosts = 0; const resumedGets = [];
  recoveryPage.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/jobs' && request.method() === 'POST') jobPosts++;
    if (pathname.startsWith('/api/jobs/') && request.method() === 'GET') resumedGets.push(pathname.split('/').at(-1));
  });
  await recoveryPage.goto(base); await recoveryPage.waitForSelector('.graph-node');
  await recoveryPage.getByRole('button', { name: /模型与设置/ }).click();
  await recoveryPage.getByLabel('API Base URL', { exact: true }).fill('https://api.deepseek.com/v1');
  await recoveryPage.getByLabel('模型名称', { exact: true }).fill('deepseek-v4-pro');
  await recoveryPage.getByLabel('API Key', { exact: true }).fill('browser-recovery-test-secret');
  await recoveryPage.getByRole('button', { name: '应用到本次会话', exact: true }).click();
  await recoveryPage.locator('[data-action="import"]').first().click();
  await recoveryPage.getByLabel('这次思考的标题', { exact: true }).fill('刷新中继续 AI 整理');
  await recoveryPage.getByLabel('对话内容', { exact: true }).fill('用户：我决定刷新以后继续同一个任务，不重复消耗模型调用。');
  await recoveryPage.getByRole('button', { name: '开始整理', exact: true }).click();
  await Promise.race([providerStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('Recovery provider never started')), 5000))]);
  const receipt = await recoveryPage.evaluate(async () => (await (await import('/draft-store.js')).draftStore.all()).find(record => record.kind === 'pending-import' && record.input.title === '刷新中继续 AI 整理'));
  assert.ok(receipt.jobId); assert.ok(!JSON.stringify(receipt).includes('browser-recovery-test-secret'));
  await recoveryPage.reload(); await recoveryPage.waitForSelector('.graph-node');
  await recoveryPage.locator('#resume-import').click();
  assert.match(await recoveryPage.getByLabel('对话内容', { exact: true }).inputValue(), /不重复消耗模型调用/);
  assert.equal(await recoveryPage.getByLabel('对话内容', { exact: true }).isDisabled(), true);
  await recoveryPage.getByRole('button', { name: '继续上次整理', exact: true }).click();
  await recoveryPage.waitForFunction(() => document.querySelector('.import-progress')?.hidden === false);
  releaseProvider();
  await recoveryPage.waitForSelector('.modal-backdrop', { state: 'detached' }); await saved(recoveryPage);
  assert.equal(providerCalls, 1); assert.equal(jobPosts, 1);
  assert.ok(resumedGets.length > 0 && resumedGets.every(id => id === receipt.jobId));
  assert.equal(await recoveryPage.locator('.graph-node[data-node="recovered-choice"]').count(), 1);
  assert.equal(await recoveryPage.locator('#resume-import').isHidden(), true);
  const remainingReceipts = await recoveryPage.evaluate(async operationId => (await (await import('/draft-store.js')).draftStore.all()).filter(record => record.kind === 'pending-import' && record.operationId === operationId), receipt.operationId);
  assert.equal(remainingReceipts.length, 0);
  console.log('PASS refreshing a paid running task recovers original input and polls the same job with one provider call');
  assert.deepEqual(errors, []);
} catch (error) {
  if (inspectedPage && !inspectedPage.isClosed()) {
    await inspectedPage.screenshot({ path: path.join(output, 'editor-test-failure.png') }).catch(() => {});
    console.error('Browser state:', await inspectedPage.locator('#modal-root').innerText().catch(() => 'unavailable'));
  }
  throw error;
} finally {
  releaseProvider?.();
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true });
}
