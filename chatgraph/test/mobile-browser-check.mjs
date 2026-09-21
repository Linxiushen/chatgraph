// Browser integration against synthetic conversations. Mobile viewport emulation is
// not evidence of an installed iOS/Android app or real OS share-sheet compatibility.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';

const { chromium } = await import(process.env.CHATGRAPH_PLAYWRIGHT_PATH || 'playwright');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chatgraph-mobile-browser-'));
const output = fileURLToPath(new URL('../test-output/', import.meta.url));
await mkdir(output, { recursive: true });
let paidCalls = 0;
const denyProvider = async () => { paidCalls++; throw new Error('Mobile fixtures must never call a model'); };
const server = createAppServer({ dataDir: path.join(dataDir, 'local'), env: {}, fetchImpl: denyProvider });
const serverRequests = [];
server.prependListener('request', req => serverRequests.push({ method: req.method, url: req.url }));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
const errors = [], checks = [];
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
let page, hostedServer, tlsServer, recoveryServer, releaseRecoveryProvider;

const ready = async page => {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await page.evaluate(() => navigator.serviceWorker.ready);
};
const queue = page => page.evaluate(async () => (await import('/mobile.js')).listMobileShares());
const noOverflow = async page => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Phone page must not overflow horizontally');
async function share(page, { title = '', text = '', url = '', file } = {}) {
  // A real navigation form POST exercises the worker's request.formData, storage,
  // 303 redirect and receiving page together, without replacing network APIs.
  await page.evaluate(input => {
    const form = document.createElement('form');
    form.method = 'POST'; form.action = '/mobile-share'; form.enctype = 'multipart/form-data';
    for (const name of ['title', 'text', 'url']) {
      const field = document.createElement('textarea'); field.name = name; field.value = input[name]; form.append(field);
    }
    if (input.file) {
      const field = document.createElement('input'); field.type = 'file'; field.name = 'files';
      const transfer = new DataTransfer();
      transfer.items.add(new File([input.file.content], input.file.name, { type: input.file.type }));
      field.files = transfer.files; form.append(field);
    }
    document.body.append(form); form.submit();
  }, { title, text, url, file });
  await page.waitForURL(value => value.pathname === '/mobile-inbox.html' && Boolean(value.hash));
  await page.waitForFunction(() => document.querySelector('#continue-import') && !document.querySelector('#continue-import').disabled);
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const posts = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push({ url: request.url(), body: request.postData() || '' }); });
  await page.goto(`${base}/mobile-inbox.html`); await ready(page);
  const manifestResponse = await context.request.get(`${base}/manifest.webmanifest`);
  assert.match(manifestResponse.headers()['content-type'], /manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.share_target.method, 'POST');
  assert.equal(manifest.share_target.action, '/mobile-share');
  for (const icon of manifest.icons) assert.equal((await context.request.get(`${base}${icon.src}`)).status(), 200);
  await noOverflow(page); await page.setViewportSize({ width: 375, height: 812 }); await noOverflow(page);
  await page.getByRole('tab', { name: 'Android', exact: true }).click();
  assert.equal(await page.locator('#android-guide').isVisible(), true);
  await page.getByRole('tab', { name: 'iPhone / iPad', exact: true }).click();
  assert.equal(await page.locator('#ios-guide').isVisible(), true);
  check('install metadata, worker activation and mobile entry at 375/390 pixels');

  const text = '用户：MOBILE_PERSONAL_VIEW 我希望保留自己的判断。\nAI：MOBILE_AI_VIEW 可以关联原文作为依据。';
  await share(page, { title: '手机分享的思考', text, url: 'https://chat.deepseek.com/a/chat/synthetic' });
  const firstId = new URL(page.url()).hash.slice(1);
  assert.match(firstId, /^[a-f0-9-]{36}$/i);
  assert.equal(await page.locator('#share-text').inputValue(), text);
  assert.equal(serverRequests.filter(item => item.url.startsWith('/mobile-share')).length, 0);
  assert.equal(serverRequests.filter(item => item.method === 'POST').length, 0);
  assert.ok(!page.url().includes('MOBILE_PERSONAL_VIEW'));
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#share-text').inputValue(), text);
  assert.equal((await queue(page)).length, 1);
  await page.screenshot({ path: path.join(output, 'mobile-inbox.png'), fullPage: true });
  check('real multipart share is queued locally, survives refresh and never posts transcript to server');

  await page.locator('#continue-import').click();
  await page.getByRole('button', { name: '使用选中的对话', exact: true }).waitFor();
  assert.equal(await page.locator('.import-message').count(), 2);
  await noOverflow(page);
  assert.equal(serverRequests.filter(item => item.method === 'POST').length, 0);
  await page.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('已保存'));
  assert.equal((await queue(page)).length, 0);
  const graphs = await (await context.request.get(`${base}/api/graphs`)).json();
  const firstGraph = graphs.find(graph => graph.title === '手机分享的思考');
  assert.ok(firstGraph);
  assert.equal((await (await context.request.get(`${base}/api/graphs/${firstGraph.id}`)).json()).source.url, 'https://chat.deepseek.com/a/chat/synthetic');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('chatgraph:mobile-import')), null);
  check('mobile share opens selection preview and clears receipt only after graph is saved');

  await page.goto(`${base}/mobile-inbox.html`); await ready(page);
  await share(page, { text: 'https://chatgpt.com/share/synthetic-link-only' });
  assert.equal(await page.locator('#share-text').inputValue(), '');
  assert.equal(await page.locator('#link-notice').isVisible(), true);
  assert.equal(await page.locator('#share-url').inputValue(), 'https://chatgpt.com/share/synthetic-link-only');
  await page.locator('#continue-import').click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByLabel('对话内容', { exact: true }).inputValue(), '');
  assert.match(await page.locator('.mobile-import-notice').textContent(), /只有链接/);
  assert.equal(await page.locator('.import-message').count(), 0);
  check('Android text-field URL becomes a source pointer, never a fabricated conversation');

  await page.goto(`${base}/mobile-inbox.html`); await ready(page);
  const archive = JSON.stringify([
    { title: '不选择的会话', messages: [{ role: 'user', content: 'MOBILE_UNSELECTED_ARCHIVE_SECRET' }] },
    { title: '选择的手机会话', messages: [{ role: 'user', content: 'MOBILE_SELECTED_ARCHIVE_VIEW' }, { role: 'assistant', content: 'MOBILE_SELECTED_ARCHIVE_REPLY' }] },
  ]);
  await share(page, { file: { name: 'conversations.json', type: 'application/json', content: archive } });
  assert.equal(await page.locator('#file-preview').isVisible(), true);
  await page.locator('#continue-import').click();
  await page.getByLabel('选择要导入的会话', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('对话内容', { exact: true }).inputValue(), '');
  await page.getByLabel('选择要导入的会话', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('已保存'));
  for (const request of posts.filter(item => new URL(item.url).pathname.startsWith('/api/'))) assert.ok(!request.body.includes('MOBILE_UNSELECTED_ARCHIVE_SECRET'));
  assert.ok(posts.some(item => new URL(item.url).pathname === '/api/import' && item.body.includes('MOBILE_SELECTED_ARCHIVE_VIEW')));
  check('shared JSON account archive requires selection and uploads only selected conversation');

  await page.goto(`${base}/mobile-inbox.html`); await ready(page);
  const beforeInvalid = (await queue(page)).length;
  await share(page, { file: { name: 'binary.pdf', type: 'application/pdf', content: 'UNSUPPORTED_FILE_NEVER_RETAINED' } });
  assert.equal(new URL(page.url()).hash, '#error=file');
  assert.equal((await queue(page)).length, beforeInvalid);
  assert.ok(!(await page.locator('body').innerText()).includes('UNSUPPORTED_FILE_NEVER_RETAINED'));
  assert.equal(serverRequests.filter(item => item.url.startsWith('/mobile-share')).length, 0);
  check('unsupported shared file is rejected before storage or network');

  await page.goto(`${base}/mobile-inbox.html`); await ready(page);
  await context.setOffline(true);
  await page.reload();
  await page.locator('#share-text').fill('用户：OFFLINE_MOBILE_CAPTURE 留待联网后整理。');
  await page.locator('#save-inbox').click();
  await page.waitForFunction(async () => (await (await import('/mobile.js')).listMobileShares()).some(item => item.kind === 'text'));
  assert.ok((await queue(page)).some(item => item.kind === 'text'));
  await page.goto(base);
  assert.match(await page.locator('body').innerText(), /图谱和 AI 整理需要联网/);
  assert.equal(await page.locator('.graph-node').count(), 0);
  await context.setOffline(false);
  await page.goto(`${base}/mobile-inbox.html`); await ready(page);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = await Promise.all(names.map(async name => {
      const cache = await caches.open(name);
      return (await cache.keys()).map(request => new URL(request.url).pathname);
    }));
    return entries.flat();
  });
  assert.ok(cached.includes('/mobile-inbox.html'));
  assert.ok(cached.every(item => item !== '/' && !item.startsWith('/api/') && !item.startsWith('/s/') && !item.includes('app.js')));
  check('offline receiving retains local text while graph/API responses never enter Cache Storage');

  // Genuine hosted auth, HTTPS origin and Secure cookie through a temporary proxy.
  const keyPath = path.join(dataDir, 'test-key.pem'), certPath = path.join(dataDir, 'test-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
  tlsServer = https.createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (req, res) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: hostedServer.address().port, method: req.method, path: req.url, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  tlsServer.listen(0, '127.0.0.1'); await once(tlsServer, 'listening');
  const hostedBase = `https://127.0.0.1:${tlsServer.address().port}`;
  hostedServer = createAppServer({ dataDir: path.join(dataDir, 'hosted'), env: { CHATGRAPH_PUBLIC_ORIGIN: hostedBase, CHATGRAPH_AUTH_PASSWORD: 'synthetic-mobile-password-only' }, fetchImpl: denyProvider });
  hostedServer.listen(0, '127.0.0.1'); await once(hostedServer, 'listening');
  const authenticatedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const loginPage = await authenticatedContext.newPage();
  loginPage.on('pageerror', error => errors.push(error.message));
  await loginPage.goto(`${hostedBase}/mobile-inbox.html`); await ready(loginPage);
  assert.equal((await authenticatedContext.request.get(`${hostedBase}/api/graphs`)).status(), 401);
  await share(loginPage, { title: '登录后继续的手机对话', text: '用户：LOGIN_RECOVERY_MOBILE_VIEW 这条分享不能因登录而丢失。' });
  const loginShareId = new URL(loginPage.url()).hash.slice(1);
  const originalRevision = (await queue(loginPage)).find(item => item.id === loginShareId).revision;
  await loginPage.locator('#continue-import').click();
  await loginPage.waitForURL(value => value.pathname === '/login');
  await loginPage.reload();
  assert.equal(await loginPage.evaluate(() => sessionStorage.getItem('chatgraph:mobile-import')), loginShareId);
  await loginPage.getByLabel('工作区密码', { exact: true }).fill('synthetic-mobile-password-only');
  await loginPage.getByRole('button', { name: '登录', exact: true }).click();
  await loginPage.getByRole('button', { name: '使用选中的对话', exact: true }).waitFor();
  assert.match(await loginPage.locator('.import-message-list').textContent(), /LOGIN_RECOVERY_MOBILE_VIEW/);
  assert.equal((await queue(loginPage)).length, 1);
  assert.equal((await authenticatedContext.request.get(`${hostedBase}/api/graphs`)).status(), 200);
  const cookies = await authenticatedContext.cookies();
  assert.equal(cookies.find(cookie => cookie.name === 'chatgraph_session').secure, true);
  assert.equal(cookies.find(cookie => cookie.name === 'chatgraph_session').httpOnly, true);
  check('public mobile inbox preserves local share through real HTTPS login and refresh, with APIs protected');

  await loginPage.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  await loginPage.getByRole('button', { name: '取消', exact: true }).click();
  await loginPage.goto(`${hostedBase}/mobile-inbox.html#${loginShareId}`);
  await loginPage.waitForFunction(() => document.querySelector('#share-text')?.value.includes('LOGIN_RECOVERY_MOBILE_VIEW'));
  await loginPage.locator('#share-text').fill('用户：UPDATED_MOBILE_VIEW 这是编辑收件箱后的新判断。');
  await loginPage.locator('#continue-import').click();
  await loginPage.getByRole('button', { name: '使用选中的对话', exact: true }).waitFor();
  assert.match(await loginPage.locator('.import-message-list').textContent(), /UPDATED_MOBILE_VIEW/);
  assert.ok(!(await loginPage.locator('.import-message-list').textContent()).includes('LOGIN_RECOVERY_MOBILE_VIEW'));
  assert.equal((await queue(loginPage)).find(item => item.id === loginShareId).revision, originalRevision + 1);
  const staleDelete = await loginPage.evaluate(async ({ id, revision }) => (await import('/mobile.js')).removeMobileShare(id, revision), { id: loginShareId, revision: originalRevision });
  assert.equal(staleDelete, false);
  assert.equal((await queue(loginPage)).find(item => item.id === loginShareId).revision, originalRevision + 1);
  check('edited inbox receipt opens its new content instead of resuming an older selected draft');

  const recreated = await loginPage.evaluate(async () => {
    const { saveMobileShare, removeMobileShare, readMobileShare } = await import('/mobile.js');
    const initial = await saveMobileShare({ title: 'Deleted receipt fixture', text: '用户：FIRST_RECEIPT' });
    const unchanged = await saveMobileShare(initial);
    await removeMobileShare(initial.id, initial.revision);
    const replacement = await saveMobileShare({ ...initial, text: '用户：RECREATED_RECEIPT' });
    await removeMobileShare(initial.id, initial.revision);
    const retained = await readMobileShare(replacement.id);
    await removeMobileShare(replacement.id, replacement.revision);
    return { initial, unchanged, replacement, retained };
  });
  assert.equal(recreated.unchanged.id, recreated.initial.id);
  assert.equal(recreated.unchanged.revision, recreated.initial.revision);
  assert.notEqual(recreated.replacement.id, recreated.initial.id);
  assert.equal(recreated.retained.text, '用户：RECREATED_RECEIPT');
  check('unchanged receipts preserve revisions and recreated receipts cannot be deleted by stale completion');
  const conflict = await loginPage.evaluate(async () => {
    const { saveMobileShare, readMobileShare, removeMobileShare } = await import('/mobile.js');
    const original = await saveMobileShare({ title: '并发窗口', text: '用户：初始原文' });
    const newer = await saveMobileShare({ ...original, text: '用户：窗口B已经保存的新原文' });
    let code;
    try { await saveMobileShare({ ...original, text: '用户：窗口A过期的修改不能覆盖B' }); } catch (error) { code = error.code; }
    const retained = await readMobileShare(original.id);
    await removeMobileShare(newer.id, newer.revision);
    return { code, retained, newer };
  });
  assert.equal(conflict.code, 'conflict');
  assert.equal(conflict.retained.text, conflict.newer.text);
  assert.equal(conflict.retained.revision, conflict.newer.revision);
  check('stale mobile inbox edits cannot overwrite a newer copy in another window');


  let mockProviderCalls = 0, modelStarted;
  const started = new Promise(resolve => { modelStarted = resolve; });
  const modelGate = new Promise(resolve => { releaseRecoveryProvider = resolve; });
  recoveryServer = createAppServer({ dataDir: path.join(dataDir, 'process-recovery'), env: { CHATGRAPH_API_KEY: 'synthetic-recovery-fixture', CHATGRAPH_MODEL: 'fixture-model' }, fetchImpl: async () => {
    mockProviderCalls++; modelStarted(); await modelGate;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '手机进程恢复', nodes: [
      { id: 'root', label: '手机进程恢复', type: 'topic', stance: 'unknown', status: 'open', parentId: null, sourceIds: [] },
      { id: 'mobile-recovered-choice', label: '继续同一个模型任务', type: 'claim', stance: 'user', status: 'confirmed', parentId: 'root', sourceIds: ['m-1'] },
    ], edges: [] }) } }] });
  } });
  recoveryServer.listen(0, '127.0.0.1'); await once(recoveryServer, 'listening');
  const recoveryBase = `http://127.0.0.1:${recoveryServer.address().port}`;
  const recoveryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  let jobPosts = 0; const jobGets = [];
  recoveryContext.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/jobs' && request.method() === 'POST') jobPosts++;
    if (pathname.startsWith('/api/jobs/') && request.method() === 'GET') jobGets.push(pathname.split('/').at(-1));
  });
  const original = await recoveryContext.newPage();
  original.on('pageerror', error => errors.push(error.message));
  await original.goto(`${recoveryBase}/mobile-inbox.html`); await ready(original);
  await original.locator('#share-title').fill('PROCESS_RECOVERY_MOBILE');
  await original.locator('#share-text').fill('用户：我决定让手机重启后继续同一个模型任务。');
  await original.locator('#continue-import').click();
  await original.getByRole('button', { name: '使用选中的对话', exact: true }).click();
  await original.getByRole('button', { name: '开始整理', exact: true }).click();
  await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('Mobile recovery model did not start')), 5000))]);
  const receipt = await original.evaluate(async () => (await (await import('/draft-store.js')).draftStore.all()).find(record => record.kind === 'pending-import' && record.input.title === 'PROCESS_RECOVERY_MOBILE'));
  assert.ok(receipt.jobId); assert.ok(receipt.mobileShareId);
  const untouched = await original.evaluate(async () => {
    const { draftStore } = await import('/draft-store.js');
    const operations = [
      { operationId: crypto.randomUUID(), phase: 'draft', input: { title: 'ORDINARY_PRIVATE_DRAFT', text: '用户：普通窗口草稿仍然隔离。' } },
      { operationId: crypto.randomUUID(), phase: 'failed', jobId: crypto.randomUUID(), input: { title: 'ORDINARY_PRIVATE_FAILED', text: '用户：普通失败原文保留。' } },
      { operationId: crypto.randomUUID(), phase: 'failed', jobId: crypto.randomUUID(), mobileShareId: crypto.randomUUID(), mobileShareRevision: 1, input: { title: 'OTHER_MOBILE_FAILED', text: '用户：其他失败原文保留。' } },
      { operationId: crypto.randomUUID(), phase: 'draft', mobileShareId: crypto.randomUUID(), mobileShareRevision: 1, input: { title: 'OTHER_MOBILE_DRAFT', text: '用户：其他新手机草稿保留。' } },
    ];
    for (const operation of operations) await draftStore.putImport(operation);
    const graph = await (await fetch('/api/demo')).json(); graph.title = 'UNRELATED_GRAPH_DRAFT';
    await draftStore.put({ graph, dirty: true, saved: false, autoSavePaused: true });
    return { operationIds: operations.map(item => item.operationId), owner: sessionStorage.getItem('chatgraph-draft-owner') };
  });
  await original.close();

  const restored = await recoveryContext.newPage();
  restored.on('pageerror', error => errors.push(error.message));
  await restored.goto(recoveryBase); await restored.waitForSelector('.outline-card');
  assert.notEqual(await restored.evaluate(() => sessionStorage.getItem('chatgraph-draft-owner')), untouched.owner);
  assert.equal(await restored.locator('#resume-import').textContent(), '继续上次整理（3）');
  await restored.getByRole('button', { name: '展开导航', exact: true }).click();
  await restored.locator('#resume-import').click();
  const recoveryChoices = await restored.getByRole('dialog').innerText();
  assert.ok(recoveryChoices.includes('OTHER_MOBILE_FAILED') && recoveryChoices.includes('OTHER_MOBILE_DRAFT'));
  assert.ok(!recoveryChoices.includes('ORDINARY_PRIVATE'));
  await restored.locator('.history-entry').filter({ hasText: 'PROCESS_RECOVERY_MOBILE' }).getByRole('button', { name: '继续', exact: true }).click();
  assert.equal(await restored.getByLabel('对话内容', { exact: true }).isDisabled(), true);
  await restored.getByRole('button', { name: '继续上次整理', exact: true }).click();
  await restored.waitForFunction(async operationId => (await (await import('/draft-store.js')).draftStore.all()).filter(record => record.kind === 'pending-import' && record.operationId === operationId).length === 2, receipt.operationId);
  await restored.close();

  const continued = await recoveryContext.newPage();
  continued.on('pageerror', error => errors.push(error.message));
  await continued.goto(`${recoveryBase}/#mobile-import=${receipt.mobileShareId}`);
  await continued.getByRole('button', { name: '继续上次整理', exact: true }).waitFor();
  assert.equal(await continued.locator('#resume-import').textContent(), '继续上次整理（3）', 'Copies from earlier processes must collapse to one operation');
  assert.equal(await continued.getByLabel('对话内容', { exact: true }).isDisabled(), true);
  await continued.route('**/api/graphs', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic save interruption' }) }) : route.continue());
  await continued.getByRole('button', { name: '继续上次整理', exact: true }).click();
  await continued.waitForFunction(() => document.querySelector('.import-progress')?.hidden === false);
  releaseRecoveryProvider();
  await continued.getByRole('dialog').waitFor({ state: 'detached' });
  assert.ok((await queue(continued)).some(item => item.id === receipt.mobileShareId), 'Failed graph save must preserve mobile inbox original');
  const pendingCopies = await continued.evaluate(async operationId => (await (await import('/draft-store.js')).draftStore.all()).filter(record => record.kind === 'pending-import' && record.operationId === operationId), receipt.operationId);
  assert.equal(pendingCopies.length, 3); assert.ok(pendingCopies.every(record => record.jobId === receipt.jobId));
  check('fresh mobile sessions recover one paid job from sidebar or receipt link while ordinary drafts stay isolated');

  await continued.unroute('**/api/graphs');
  await continued.getByRole('button', { name: '保存', exact: true }).click();
  await continued.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('已保存'));
  const remaining = await continued.evaluate(async () => (await (await import('/draft-store.js')).draftStore.all()));
  assert.equal(remaining.filter(record => record.kind === 'pending-import' && record.operationId === receipt.operationId).length, 0);
  for (const operationId of untouched.operationIds) assert.equal(remaining.filter(record => record.operationId === operationId).length, 1);
  assert.ok(remaining.some(record => record.graph?.title === 'UNRELATED_GRAPH_DRAFT' && record.owner === untouched.owner));
  assert.ok(!(await queue(continued)).some(item => item.id === receipt.mobileShareId));
  assert.equal(mockProviderCalls, 1); assert.equal(jobPosts, 1);
  assert.ok(jobGets.length > 0 && jobGets.every(id => id === receipt.jobId));
  check('durable save clears only matching mobile receipt copies across owners and retains unrelated failed/new originals');

  assert.equal(paidCalls, 0); assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'mobile-browser-check.json'), JSON.stringify({ passed: true, checks, pageErrors: errors, realDeviceTested: false }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'mobile-browser-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  releaseRecoveryProvider?.();
  await browser.close();
  for (const active of [tlsServer, hostedServer, recoveryServer, server].filter(Boolean)) {
    active.closeAllConnections(); await new Promise(resolve => active.close(resolve));
  }
  await rm(dataDir, { recursive: true, force: true });
}
