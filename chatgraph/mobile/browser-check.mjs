import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.CHATGRAPH_PLAYWRIGHT_PATH || 'playwright');
const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const [shortcut, popup, popupScript, destination, css] = await Promise.all([
  read('./safari-shortcut.js'), read('../extension/popup.html'), read('../extension/popup.js'),
  read('../extension/destination.js'), read('../extension/popup.css'),
]);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<title>手机采集 - ChatGPT</title><article data-message-author-role="user">我的初步立场<br>继续核对</article><article data-message-author-role="assistant"><p>我的建议</p><div data-thinking>不采集隐藏思考</div></article><article data-message-author-role="user" hidden>隐藏分支</article>` }));
  await page.goto('https://chatgpt.com/c/mobile-fixture?private-token=removed#fragment');
  await page.evaluate(() => { globalThis.completion = data => { globalThis.shortcutOutput = data; }; });
  await page.addScriptTag({ content: shortcut });
  const capture = JSON.parse(await page.evaluate(() => globalThis.shortcutOutput));
  assert.deepEqual(capture.messages.map(message => message.role), ['user', 'assistant']);
  assert.match(capture.messages[0].content, /立场\n继续/);
  assert.doesNotMatch(JSON.stringify(capture.messages), /隐藏思考|隐藏分支/);
  assert.equal(capture.url, 'https://chatgpt.com/c/mobile-fixture');
  assert.equal(await page.evaluate(() => typeof globalThis.ChatGraphCapture), 'undefined');
  console.log('PASS Safari Shortcut returns current visible branch JSON with roles and no URL secrets (Chromium fixture).');

  const html = popup.replace('<link rel="stylesheet" href="popup.css">', `<style>${css}</style>`).replace(/<script[^>]+><\/script>/g, '');
  await page.route('https://extension.example.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://extension.example.test/');
  await page.evaluate(capture => {
    globalThis.saved = { workspaceOrigin: 'https://graph.example.test:8443' };
    globalThis.requested = []; globalThis.sent = []; globalThis.opened = []; globalThis.redirect = false;
    globalThis.chrome = {
      storage: { local: { get: async () => saved, set: async data => { Object.assign(saved, data); } } },
      permissions: { request: async data => { requested.push(data); return true; } },
      tabs: {
        query: async () => [{ id: 1, url: 'https://chatgpt.com/c/mobile-fixture' }],
        create: async options => { opened.push(options); return { id: 2 }; },
        get: async () => ({ id: 2, status: 'complete', url: redirect ? 'https://unexpected.example.test/' : opened.at(-1).url }),
        update: async () => {},
      },
      scripting: { executeScript: async options => {
        if (options.files) return [];
        if (options.world === 'MAIN') {
          sent.push(options.args);
          // The receiver runs on this different fixture origin. Its own guard
          // must fail before posting the transcript to the window.
          globalThis.guardResult = options.func(...options.args);
          return [{ result: true }];
        }
        return [{ result: { capture } }];
      } },
    };
  }, capture);
  await page.addScriptTag({ content: destination });
  await page.addScriptTag({ content: popupScript });
  await page.waitForFunction(() => document.getElementById('workspace').value === 'https://graph.example.test:8443');
  await page.getByRole('button', { name: '采集当前对话', exact: true }).click();
  await page.getByRole('button', { name: '发送到 ChatGraph', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已送到'));
  assert.deepEqual(await page.evaluate(() => requested), [{ origins: ['https://graph.example.test/*'] }]);
  assert.equal(await page.evaluate(() => sent[0][2]), 'https://graph.example.test:8443');
  assert.equal(await page.evaluate(() => guardResult), false);
  assert.deepEqual(await page.evaluate(() => Object.keys(saved)), ['workspaceOrigin']);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS mobile extension remembers only origin, requests one host and enforces exact origin including port.');

  await page.evaluate(() => { globalThis.redirect = true; });
  await page.getByRole('button', { name: '发送到 ChatGraph', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('其他地址'));
  assert.equal(await page.evaluate(() => sent.length), 1);
  await page.locator('summary').click();
  await page.getByLabel('工作区地址', { exact: true }).fill('http://192.168.1.20:4317');
  await page.getByRole('button', { name: '发送到 ChatGraph', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('HTTPS'));
  assert.equal(await page.evaluate(() => requested.length), 2);
  assert.equal(await page.evaluate(() => sent.length), 1);
  assert.deepEqual(errors, []);
  console.log('PASS redirected destinations and insecure mobile origins fail before transcript injection; no page errors.');
} finally { await browser.close(); }
