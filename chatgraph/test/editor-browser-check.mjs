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

  const backupGuidance = '知识库超过 50 MiB 网页备份范围，请使用部署提供的全量数据目录备份；不会生成无法还原的不完整备份。';
  await page.route('**/api/backup', route => route.fulfill({ status: 413, json: { error: backupGuidance } }));
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  await page.getByRole('button', { name: '下载完整知识库备份', exact: true }).click();
  await page.getByRole('dialog').locator('.form-error').waitFor();
  assert.equal(await page.getByRole('dialog').locator('.form-error').textContent(), backupGuidance);
  assert.equal(await page.getByRole('button', { name: '下载完整知识库备份', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.unroute('**/api/backup');
  console.log('PASS oversized backup preserves server guidance to use a complete data snapshot');

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
  assert.ok(await page.evaluate(async () => (await (await import('/draft-store.js')).draftStore.all()).some(record => record.kind === 'pending-import' && record.input.title === '浏览器捕获预览')), 'Extension ACK must follow a committed local receipt');
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
  // A lost cancellation response must retain the paid job identity. It is not
  // evidence that the provider stopped, even if the modal has been dismissed.
  const cancellationJob = '00000000-0000-4000-8000-000000000091';
  const cancellationGraph = { ...(await (await context.request.get(`${base}/api/graphs/${(await (await context.request.get(`${base}/api/graphs`)).json()).find(item => item.title === '刷新中继续 AI 整理').id}`)).json()), id: 'graph-cancel-recovery', revision: 0, title: '取消状态不确定恢复' };
  let cancellationPosts = 0, cancellationReady = false;
  await recoveryPage.route('**/api/jobs', route => { cancellationPosts++; return route.fulfill({ status: 202, json: { id: cancellationJob, status: 'running' } }); });
  await recoveryPage.route(`**/api/jobs/${cancellationJob}`, route => route.request().method() === 'DELETE' ? route.abort() : route.fulfill({ json: cancellationReady ? { id: cancellationJob, status: 'completed', result: cancellationGraph } : { id: cancellationJob, status: 'running' } }));
  await recoveryPage.locator('[data-action="import"]').first().click();
  await recoveryPage.getByLabel('对话内容', { exact: true }).fill('用户：取消失败以后必须查询原任务，不能重复花钱。');
  await recoveryPage.locator('input[name="import-mode"][value="ai"]').check();
  await recoveryPage.getByRole('button', { name: '开始整理', exact: true }).click();
  await recoveryPage.waitForFunction(() => document.querySelector('.import-progress p')?.textContent === '正在整理对话…');
  await recoveryPage.getByRole('button', { name: '停止整理', exact: true }).click();
  await recoveryPage.waitForSelector('.modal-backdrop', { state: 'detached' });
  const uncertain = await recoveryPage.evaluate(async id => (await (await import('/draft-store.js')).draftStore.all()).find(record => record.jobId === id), cancellationJob);
  assert.equal(uncertain.phase, 'unknown');
  cancellationReady = true;
  await recoveryPage.locator('#resume-import').click();
  await recoveryPage.getByRole('button', { name: '继续上次整理', exact: true }).click();
  await recoveryPage.waitForSelector('.modal-backdrop', { state: 'detached' }); await saved(recoveryPage);
  assert.equal(cancellationPosts, 1);
  await recoveryPage.unroute('**/api/jobs'); await recoveryPage.unroute(`**/api/jobs/${cancellationJob}`);
  console.log('PASS failed cancellation retains the job receipt and resumes without a second paid submission');

  await recoveryPage.locator('.graph-node[data-node="recovered-choice"]').click();
  let expired = true;
  await recoveryPage.route('**/api/graphs', route => route.request().method() === 'POST' && expired ? route.fulfill({ status: 401, json: { error: 'session-expired-fixture' } }) : route.continue());
  await recoveryPage.route('**/api/login', async route => { assert.equal(route.request().postDataJSON().password, 'synthetic-reauthentication-fixture'); expired = false; await route.fulfill({ json: { ok: true } }); });
  await recoveryPage.getByLabel('编辑观点名称', { exact: true }).fill('登录过期也不能丢失的当前编辑');
  await recoveryPage.locator('#session-expired').waitFor();
  await recoveryPage.screenshot({ path: path.join(output, 'session-expired-recovery.png') });
  assert.equal(new URL(recoveryPage.url()).pathname, '/');
  assert.equal(await recoveryPage.getByLabel('编辑观点名称', { exact: true }).inputValue(), '登录过期也不能丢失的当前编辑');
  await recoveryPage.getByLabel('重新登录工作区密码', { exact: true }).fill('synthetic-reauthentication-fixture');
  await recoveryPage.getByRole('button', { name: '重新登录', exact: true }).click();
  await recoveryPage.locator('#session-expired').waitFor({ state: 'detached' }); await saved(recoveryPage);
  assert.ok((await (await context.request.get(`${base}/api/graphs/graph-cancel-recovery`)).json()).nodes.some(node => node.label === '登录过期也不能丢失的当前编辑'));
  await recoveryPage.unroute('**/api/graphs'); await recoveryPage.unroute('**/api/login');
  console.log('PASS expired login preserves the live editor and reauthenticates within the same WebView');

  const failedAck = await recoveryPage.evaluate(async () => {
    const { draftStore } = await import('/draft-store.js');
    const original = draftStore.putImport; draftStore.putImport = () => Promise.reject(new Error('quota-fixture'));
    try {
      return await new Promise(resolve => {
        const requestId = 'capture-storage-failure';
        const receive = event => { if (event.data?.type === 'chatgraph:import:ack' && event.data.requestId === requestId) { window.removeEventListener('message', receive); resolve(event.data); } };
        window.addEventListener('message', receive);
        window.postMessage({ type: 'chatgraph:import', version: 1, requestId, capture: { title: '不能虚报送达', messages: [{ role: 'user', content: '只有落盘以后才能确认送达。' }] } }, location.origin);
      });
    } finally { draftStore.putImport = original; }
  });
  assert.equal(failedAck.ok, false);
  assert.match(await recoveryPage.getByLabel('对话内容', { exact: true }).inputValue(), /只有落盘以后/);
  await recoveryPage.getByRole('button', { name: '取消', exact: true }).click();
  console.log('PASS extension delivery rejects storage failure while preserving the visible original');

  let releaseSave, startedSave, deleteRequests = 0;
  const savingStarted = new Promise(resolve => { startedSave = resolve; });
  await recoveryPage.route('**/api/graphs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    startedSave(); await new Promise(resolve => { releaseSave = resolve; }); await route.continue();
  });
  await recoveryPage.route('**/api/graphs/graph-cancel-recovery', route => { if (route.request().method() === 'DELETE') { deleteRequests++; assert.ok(route.request().postDataJSON().expectedRevision > 0); } return route.continue(); });
  await recoveryPage.getByLabel('编辑观点名称', { exact: true }).fill('删除与保存并发时保留这份草稿');
  await recoveryPage.getByRole('button', { name: '保存', exact: true }).click();
  await savingStarted;
  await recoveryPage.locator('.library-entry.selected .library-link').focus();
  await recoveryPage.getByRole('button', { name: '删除图谱 取消状态不确定恢复', exact: true }).click();
  await recoveryPage.getByRole('button', { name: '删除已保存文件', exact: true }).click();
  await recoveryPage.waitForTimeout(200); assert.equal(deleteRequests, 0, 'Deletion must wait for an already-admitted save');
  releaseSave();
  await recoveryPage.waitForSelector('.modal-backdrop', { state: 'detached' });
  assert.match(await recoveryPage.locator('#save-state').textContent(), /自动保存已暂停/);
  assert.equal((await context.request.get(`${base}/api/graphs/graph-cancel-recovery`)).status(), 404);
  await recoveryPage.waitForTimeout(1400);
  assert.equal((await context.request.get(`${base}/api/graphs/graph-cancel-recovery`)).status(), 404);
  assert.equal(await recoveryPage.getByLabel('编辑观点名称', { exact: true }).inputValue(), '删除与保存并发时保留这份草稿');
  await recoveryPage.unroute('**/api/graphs'); await recoveryPage.unroute('**/api/graphs/graph-cancel-recovery');
  console.log('PASS deletion serializes with existing saves and retains a paused draft without recreating the graph');
  // A new desktop tab gets a fresh sessionStorage owner. Recovery is visible
  // but requires an explicit selection; a paid receipt keeps its original ID.
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const closedTab = await desktopContext.newPage(); inspectedPage = closedTab;
  closedTab.on('pageerror', error => errors.push(error.message));
  const providerBaseline = providerCalls;
  let desktopPosts = 0, desktopGets = 0;
  desktopContext.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/jobs' && request.method() === 'POST') desktopPosts++;
    if (pathname.startsWith('/api/jobs/') && request.method() === 'GET') desktopGets++;
  });
  await closedTab.goto(base); await closedTab.waitForSelector('.graph-node');
  await closedTab.getByRole('button', { name: /模型与设置/ }).click();
  await closedTab.getByLabel('API Base URL', { exact: true }).fill('https://api.deepseek.com/v1');
  await closedTab.getByLabel('模型名称', { exact: true }).fill('fixture-model');
  await closedTab.getByLabel('API Key', { exact: true }).fill('desktop-recovery-synthetic-key');
  await closedTab.getByRole('button', { name: '应用到本次会话', exact: true }).click();
  await closedTab.locator('[data-action="import"]').first().click();
  await closedTab.getByLabel('这次思考的标题', { exact: true }).fill('关闭原标签页后的付费任务');
  await closedTab.getByLabel('对话内容', { exact: true }).fill('用户：即使原来的标签页关闭，也要继续原来的付费任务。');
  await closedTab.getByRole('button', { name: '开始整理', exact: true }).click();
  await closedTab.waitForFunction(async () => (await (await import('/draft-store.js')).draftStore.all()).some(item => item.kind === 'pending-import' && item.phase === 'running'));
  const desktopReceipt = await closedTab.evaluate(async () => {
    const { draftStore } = await import('/draft-store.js');
    const receipt = (await draftStore.all()).find(item => item.kind === 'pending-import');
    await draftStore.putImport({ operationId: crypto.randomUUID(), input: { title: '未接管的其他原文', text: '用户：这份原文应继续留在原窗口命名空间。' } });
    const graph = await (await fetch('/api/demo')).json();
    await draftStore.put({ graph: { ...graph, id: 'untouched-desktop-edit', title: '未接管的图谱编辑' }, dirty: true, saved: false });
    return receipt;
  });
  const oldOwner = await closedTab.evaluate(() => sessionStorage.getItem('chatgraph-draft-owner'));
  await closedTab.close();
  const freshTab = await desktopContext.newPage(); inspectedPage = freshTab;
  freshTab.on('pageerror', error => errors.push(error.message));
  await freshTab.goto(base); await freshTab.waitForSelector('.graph-node');
  assert.notEqual(await freshTab.evaluate(() => sessionStorage.getItem('chatgraph-draft-owner')), oldOwner);
  assert.equal(await freshTab.locator('#resume-import').isHidden(), true);
  const getsBeforeRecovery = desktopGets;
  await freshTab.locator('#recover-drafts').click();
  assert.equal(desktopPosts, 1); assert.equal(desktopGets, getsBeforeRecovery);
  const resumedOriginal = freshTab.waitForRequest(request => new URL(request.url()).pathname === `/api/jobs/${desktopReceipt.jobId}` && request.method() === 'GET');
  await freshTab.getByRole('dialog').locator('.history-entry').filter({ hasText: '关闭原标签页后的付费任务' }).getByRole('button', { name: '接着整理', exact: true }).click();
  await resumedOriginal;
  releaseProvider();
  await freshTab.waitForSelector('.modal-backdrop', { state: 'detached' }); await saved(freshTab);
  assert.equal(providerCalls, providerBaseline + 1); assert.equal(desktopPosts, 1);
  const afterDesktopRecovery = await freshTab.evaluate(async () => (await import('/draft-store.js')).draftStore.all());
  assert.equal(afterDesktopRecovery.filter(item => item.operationId === desktopReceipt.operationId).length, 0);
  assert.ok(afterDesktopRecovery.some(item => item.input?.title === '未接管的其他原文' && item.owner === oldOwner));
  assert.ok(afterDesktopRecovery.some(item => item.graph?.id === 'untouched-desktop-edit' && item.owner === oldOwner));
  await desktopContext.close();
  console.log('PASS closed desktop tab exposes explicit recovery, resumes the same paid job once and preserves unrelated foreign drafts');
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
