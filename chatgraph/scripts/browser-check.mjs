// Optional real-browser QA. Set CHATGRAPH_PLAYWRIGHT_PATH to an installed
// playwright ES module path, or install playwright in your development runtime.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server.mjs';
import { createDemoGraph } from '../lib/demo.mjs';
import { renderGraphHtml } from '../lib/render.mjs';

const { chromium } = await import(process.env.CHATGRAPH_PLAYWRIGHT_PATH || 'playwright');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chatgraph-browser-'));
const output = fileURLToPath(new URL('../test-output/', import.meta.url));
await mkdir(output, { recursive: true });
const server = createAppServer({ dataDir, env: {} });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base);
  await page.waitForSelector('.graph-node');
  assert.equal(await page.locator('.graph-node').count(), 11);
  await page.screenshot({ path: path.join(output, 'workspace.png') });
  check('desktop workspace and explicit demonstration load');

  await page.getByRole('button', { name: '折叠子节点：三个入口，共用一套核心', exact: true }).click();
  assert.equal(await page.locator('.graph-node').count(), 10);
  await page.getByRole('button', { name: '展开子节点：三个入口，共用一套核心', exact: true }).click();
  assert.equal(await page.locator('.graph-node').count(), 11);
  await page.getByRole('button', { name: '折叠子节点：把对话变成可复用的判断', exact: true }).click();
  assert.equal(await page.locator('.graph-node').count(), 1);
  await page.locator('[data-action="toggleExport"]').click();
  const foldedDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-format="json"]').click();
  const foldedDownload = await foldedDownloadPromise;
  assert.equal(JSON.parse(await readFile(await foldedDownload.path(), 'utf8')).nodes.length, 11);
  await page.getByRole('button', { name: '展开子节点：把对话变成可复用的判断', exact: true }).click();
  assert.equal(await page.locator('.graph-node').count(), 11);
  check('branch collapse hides descendants and can restore the full graph');

  await page.getByRole('tab', { name: '结构大纲' }).click();
  assert.equal(await page.locator('.outline-card').count(), 11);
  await page.getByRole('tab', { name: '对话原文' }).click();
  assert.equal(await page.locator('.source-message').count(), 9);
  await page.getByRole('tab', { name: '思考图谱' }).click();
  await page.locator('.graph-node[data-node="demo-ownership"]').click();
  await page.getByLabel('编辑观点名称').fill('只有我接受的才是我的判断');
  await page.locator('.inspector-header').click();
  await page.waitForFunction(() => document.querySelector('[data-node="demo-ownership"] .node-label')?.textContent === '只有我接受的才是我的判断');
  await page.getByRole('button', { name: '在完整对话中查看', exact: true }).first().click();
  assert.ok(await page.locator('.source-message.message-highlight').count());
  await page.getByRole('tab', { name: '思考图谱' }).click();
  check('outline, source view, editing and source navigation');

  await page.getByRole('button', { name: '添加子观点', exact: true }).click();
  assert.equal(await page.locator('.graph-node').count(), 12);
  await page.getByLabel('编辑观点名称').fill('手动新增的验证计划');
  await page.locator('.inspector-header').click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  assert.equal(await page.locator('.graph-node').count(), 11);
  await page.getByRole('button', { name: '撤销上一步', exact: true }).click();
  assert.equal(await page.locator('.graph-node').count(), 12);
  await page.getByRole('button', { name: '适应画布', exact: true }).first().click();
  const rootNode = page.locator('.graph-node[data-node="demo-root"]');
  const before = await rootNode.getAttribute('style');
  const box = await rootNode.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 25);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + 50, { steps: 5 }); await page.mouse.up();
  assert.notEqual(await rootNode.getAttribute('style'), before);
  check('add, remove, undo and drag nodes');

  await page.getByRole('button', { name: '适应画布', exact: true }).first().click();
  await page.locator('.graph-node').filter({ hasText: '手动新增的验证计划' }).click();
  await page.getByRole('button', { name: '调整原文关联', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '确认关联', exact: true }).click();
  await page.getByRole('button', { name: '添加一条关系', exact: true }).click();
  await page.getByRole('dialog').getByLabel('关系', { exact: true }).selectOption('supports');
  await page.getByRole('dialog').getByLabel('补充说明', { exact: true }).fill('补充验证路径');
  await page.getByRole('dialog').getByRole('button', { name: '添加关系', exact: true }).click();
  await page.getByLabel('搜索观点或原文').fill('手动新增的验证计划');
  assert.equal(await page.locator('.graph-node').count(), 1);
  await page.getByLabel('搜索观点或原文').fill('');
  await page.getByRole('button', { name: '筛选节点', exact: true }).click();
  await page.getByLabel('按节点类型筛选').selectOption('question');
  assert.equal(await page.locator('.graph-node').count(), 1);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  check('source association, relation editing, search and filters');

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.includes('已保存'));
  const library = await (await fetch(base + '/api/graphs')).json();
  assert.equal(library.length, 1);
  const saved = await (await fetch(base + `/api/graphs/${library[0].id}`)).json();
  assert.equal(saved.nodes.find(n => n.id === 'demo-ownership').label, '只有我接受的才是我的判断');
  assert.ok(saved.nodes.some(n => n.label === '手动新增的验证计划'));
  assert.equal(saved.nodes.find(n => n.label === '手动新增的验证计划').sourceIds[0], 'demo-m1');
  assert.ok(saved.edges.some(e => e.label === '补充验证路径' && e.type === 'supports'));
  await page.reload();
  await page.waitForSelector('.graph-node');
  await page.waitForFunction(() => document.querySelector('[data-node="demo-ownership"] .node-label')?.textContent === '只有我接受的才是我的判断');
  check('save and reload preserve edits including the sample ID');

  for (const format of ['json', 'markdown', 'svg', 'html']) {
    await page.locator('[data-action="toggleExport"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator(`[data-format="${format}"]`).click();
    const download = await downloadPromise;
    const body = await readFile(await download.path(), 'utf8');
    assert.ok(body.includes('只有我接受的才是我的判断'));
    assert.ok(!body.includes('test-browser-api-key'));
  }
  check('all four exports download authored content');

  await page.locator('[data-action="import"]').first().click();
  await page.getByLabel('这次思考的标题').fill('浏览器验证导入');
  await page.getByLabel('对话内容').fill('用户：我先尝试 A。\nAI：可以考虑 B。\n用户：我还没有决定。');
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#graph-title')?.textContent === '浏览器验证导入');
  assert.equal(await page.locator('.graph-node').count(), 4);
  assert.ok((await page.locator('#mode-badge').textContent()).includes('原文'));
  await page.locator('[data-action="settings"]').click();
  await page.getByLabel('API Key', { exact: true }).fill('test-browser-api-key');
  await page.getByRole('button', { name: '应用到本次会话' }).click();
  assert.ok(await page.evaluate(() => !JSON.stringify(localStorage).includes('test-browser-api-key') && !JSON.stringify(sessionStorage).includes('test-browser-api-key')));
  await page.locator('[data-action="settings"]').click();
  await page.getByRole('button', { name: '清除临时设置' }).click();
  await page.locator('[data-action="import"]').first().click();
  await page.getByLabel('对话内容').fill('用户：请分析这段对话。');
  await page.locator('input[name="import-mode"][value="ai"]').check();
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page.waitForSelector('.form-error');
  assert.match(await page.locator('.form-error').textContent(), /API/);
  check('real text import, ephemeral settings and truthful missing-key error');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(base); await mobile.waitForSelector('.outline-card');
  assert.equal(await mobile.getByRole('tab', { name: '结构大纲' }).getAttribute('aria-selected'), 'true');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mobile.screenshot({ path: path.join(output, 'mobile.png') });
  await mobile.getByRole('button', { name: '展开导航' }).click();
  await mobile.locator('.sidebar-create').click();
  await mobile.waitForSelector('[role="dialog"]');
  assert.ok(await mobile.getByLabel('对话内容').isVisible());
  check('mobile layout and import navigation');

  const artifact = path.join(output, 'sample.html');
  await writeFile(artifact, await renderGraphHtml(createDemoGraph()));
  const exported = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  exported.on('pageerror', error => errors.push(error.message));
  await exported.goto(pathToFileURL(artifact).href);
  await exported.waitForSelector('#main-svg g[data-node-id]');
  const bounds = await exported.locator('#main-svg g[data-node-id]').evaluateAll(nodes => nodes.map(n => { const b = n.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
  assert.equal(new Set(bounds.map(b => `${b.x},${b.y}`)).size, 11);
  assert.ok(bounds.every(b => b.x >= 0 && b.y >= 0 && b.width > 0));
  assert.equal(await exported.locator('[id^="cg-source-"]').count(), 9);
  await exported.screenshot({ path: path.join(output, 'archify-export.png') });
  assert.deepEqual(errors, []);
  check('standalone Archify export: correct semantic bounds, source text and no runtime errors');
  await writeFile(path.join(output, 'browser-check.json'), JSON.stringify({ passed: true, checks, pageErrors: errors }, null, 2));
} catch (error) {
  const active = browser.contexts().flatMap(context => context.pages())[0];
  if (active) await active.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
