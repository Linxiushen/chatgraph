import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { organizeConversation, validateGraph, toMarkdown } from './lib/conversations.mjs';
import { createDemoGraph } from './lib/demo.mjs';
import { extractConversation, serverAIConfig } from './lib/ai.mjs';
import { renderGraphHtml, renderGraphSvg } from './lib/render.mjs';
import { createGraphStore } from './lib/store.mjs';
import { appendGraphs } from './lib/knowledge.mjs';
import { createJobQueue } from './lib/jobs.mjs';
import { loadPrivateConfig } from './lib/config.mjs';
import { createShareStore } from './lib/shares.mjs';
import { createAccessControl } from './lib/access.mjs';
import { semanticSearch, suggestRelations } from './lib/semantic.mjs';
import { renderGraphPptx } from './lib/pptx.mjs';
import { MAX_REQUEST_BYTES, MAX_BACKUP_BYTES } from './lib/limits.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const MAX_BODY = MAX_REQUEST_BYTES;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8' };
// Public installation and receiving screens contain no workspace data. Keep
// this an exact allowlist: API access and the editor still require a session.
const mobileAssets = new Set(['/manifest.webmanifest', '/service-worker.js', '/mobile.js', '/mobile-inbox.html', '/mobile-inbox.js', '/mobile-inbox.css', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']);
const mobileDownloads = new Map([['/mobile-assets/safari-shortcut.js', 'safari-shortcut.js'], ['/mobile-assets/README.md', 'README.md']]);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJSON(req, limit = MAX_BODY) {
  if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw Object.assign(new Error('请求须使用 application/json。'), { status: 415 });
  if (Number(req.headers['content-length']) > limit) throw Object.assign(new Error(`请求超过 ${Math.round(limit / 1024 / 1024)} MiB，请拆分后导入。`), { status: 413 });
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw Object.assign(new Error(`请求超过 ${Math.round(limit / 1024 / 1024)} MB，请拆分后导入。`), { status: 413 });
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new Error('请求内容不是有效 JSON。'); }
}

export function createAppServer({ dataDir = process.env.CHATGRAPH_DATA_DIR || path.join(root, '.data'), env = process.env, fetchImpl = fetch } = {}) {
  const store = createGraphStore({ dataDir });
  const access = createAccessControl(env);
  const shares = createShareStore({ dataDir });
  let directModelCalls = 0;
  // A background import owns one model slot. Synchronous utilities share one
  // additional slot, so repeated clicks cannot create unbounded paid requests.
  async function directModel(req, res, operation) {
    if (directModelCalls >= 1) throw Object.assign(new Error('已有一个即时 AI 请求正在处理，请等待完成后重试。'), { status: 429 });
    directModelCalls++;
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    try { return await operation({ signal: controller.signal }); }
    finally { directModelCalls--; req.off('aborted', disconnected); res.off('close', disconnected); }
  }
  async function importGraph(input, options = {}) {
    if (!input || typeof input !== 'object') throw new Error('请提供对话内容。');
    if (typeof input.text === 'string' && input.text.replace(/^\uFEFF/, '').trim().startsWith('{')) {
      let value;
      try { value = JSON.parse(input.text.replace(/^\uFEFF/, '')); } catch { /* parser gives the actionable error */ }
      if (value?.nodes && value?.edges && value?.messages) {
        const imported = validateGraph(value);
        imported.id = randomUUID(); imported.revision = 0;
        imported.createdAt = imported.updatedAt = new Date().toISOString();
        return imported;
      }
      // Preserve the browser capture's source range instead of claiming a complete chat.
      if (value?.source || value?.capture) {
        const source = value.source || value.capture;
        input = { ...input, platform: input.platform || source.platform || value.platform,
          url: input.url || source.url || value.url, complete: source.complete || 'partial' };
      }
    }
    if (!['outline', 'ai'].includes(input.mode)) throw new Error('请选择原文整理或 AI 结构化。');
    const graph = input.mode === 'ai' ? await extractConversation(input, { env, fetchImpl, ...options }) : organizeConversation(input);
    if (input.complete) graph.source.complete = input.complete;
    return validateGraph(graph);
  }
  const jobs = createJobQueue({ dataDir, run: async (kind, input, options) => {
    const graph = await importGraph(input, options);
    return kind === 'append' ? appendGraphs(input.graph, graph) : graph;
  } });

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      const address = server.address();
      if (!access.validHost(req.headers.host, address.port)) return json(res, 403, { error: '访问地址不在工作区允许范围内。' });
      if (!access.validOrigin(req.headers.origin, req.headers.host)) return json(res, 403, { error: '不允许跨站访问知识库。' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = decodeURIComponent(url.pathname);

      if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'POST' && pathname === '/api/login') {
        const { password } = await readJSON(req, 2048);
        const cookie = access.login(password, access.loginAddress(req));
        if (cookie) res.setHeader('Set-Cookie', cookie);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/logout') {
        res.setHeader('Set-Cookie', access.logout(req));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && /^\/s\/[a-f0-9]{48}$/.test(pathname)) {
        const share = await shares.load(pathname.slice(3));
        const html = await renderGraphHtml(share.graph);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
        return res.end(html);
      }
      if (req.method === 'POST' && pathname === '/mobile-share') return json(res, 405, { error: '分享入口尚未就绪。请先打开 ChatGraph 手机收件箱并安装到主屏幕，再重新分享；也可复制原文后粘贴。' });
      if ((req.method === 'GET' || req.method === 'HEAD') && mobileDownloads.has(pathname)) {
        const filename = mobileDownloads.get(pathname);
        const body = await fs.readFile(path.join(root, 'mobile', filename));
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      const loginAsset = ['/login', '/login.html', '/login.js'].includes(pathname) || mobileAssets.has(pathname);
      if (!loginAsset && !access.authenticated(req)) {
        if (pathname.startsWith('/api/')) return json(res, 401, { error: '请先登录工作区。' });
        res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' }); return res.end();
      }

      if (req.method === 'GET' && pathname === '/api/config') {
        const config = serverAIConfig(env);
        return json(res, 200, { aiConfigured: Boolean(config.apiKey && config.model), model: config.model, baseUrl: config.baseUrl, reasoningEffort: config.reasoningEffort, hosted: access.hosted, version });
      }
      if (req.method === 'GET' && pathname === '/api/demo') return json(res, 200, createDemoGraph());
      if (req.method === 'GET' && pathname === '/api/graphs') return json(res, 200, await store.list());
      if (req.method === 'GET' && pathname === '/api/search') return json(res, 200, await store.search(url.searchParams.get('q') || ''));
      if (req.method === 'POST' && pathname === '/api/search') {
        const input = await readJSON(req);
        return json(res, 200, await directModel(req, res, options => semanticSearch(store, input.query, { api: input.api, env, fetchImpl, ...options })));
      }
      if (req.method === 'POST' && pathname === '/api/relations/suggest') {
        const input = await readJSON(req);
        return json(res, 200, await directModel(req, res, options => suggestRelations(input.graph, { api: input.api, env, fetchImpl, ...options })));
      }
      if (req.method === 'GET' && pathname === '/api/diagnostics') return json(res, 200, await store.diagnostics());
      if (req.method === 'GET' && pathname === '/api/backup') {
        const backup = await store.backup();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="chatgraph-backup.json"', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(backup));
      }
      if (req.method === 'POST' && pathname === '/api/backup') return json(res, 200, await store.restoreBackup((await readJSON(req, MAX_BACKUP_BYTES)).backup));
      if (req.method === 'POST' && pathname === '/api/graphs') return json(res, 200, await store.save(await readJSON(req)));
      const graphRoute = pathname.match(/^\/api\/graphs\/([^/]+)(?:\/(history|restore))?$/);
      if (graphRoute) {
        const [, id, operation] = graphRoute;
        if (req.method === 'GET' && operation === 'history') return json(res, 200, await store.history(id));
        if (req.method === 'POST' && operation === 'restore') {
          const input = await readJSON(req);
          return json(res, 200, await store.restore(id, input.version, Object.hasOwn(input, 'expectedRevision') ? input.expectedRevision : input.revision));
        }
        if (req.method === 'GET' && !operation) return json(res, 200, await store.load(id));
        if (req.method === 'DELETE' && !operation) {
          if (!req.headers['content-type']) throw Object.assign(new Error('删除前需要当前图谱版本，请刷新知识库后重试。'), { status: 428 });
          const input = await readJSON(req, 2048);
          if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 1) throw Object.assign(new Error('删除前需要当前图谱版本，请刷新知识库后重试。'), { status: 428 });
          return json(res, 200, await store.remove(id, input.expectedRevision));
        }
      }
      if (req.method === 'POST' && pathname === '/api/import') {
        const input = await readJSON(req);
        return json(res, 200, await (input?.mode === 'ai' ? directModel(req, res, options => importGraph(input, options)) : importGraph(input)));
      }
      if (req.method === 'POST' && pathname === '/api/append') {
        const input = await readJSON(req);
        const previous = validateGraph(input.graph);
        const graph = await (input.mode === 'ai' ? directModel(req, res, options => importGraph(input, options)) : importGraph(input));
        return json(res, 200, appendGraphs(previous, graph));
      }
      if (req.method === 'POST' && pathname === '/api/jobs') {
        const { kind, input, id } = await readJSON(req);
        if (!input || typeof input.text !== 'string') throw new Error('请提供对话内容。');
        if (kind === 'append') validateGraph(input.graph);
        return json(res, 202, await jobs.create(kind, input, id));
      }
      const jobRoute = pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})$/);
      if (jobRoute && req.method === 'GET') return json(res, 200, await jobs.get(jobRoute[1]));
      if (jobRoute && req.method === 'DELETE') return json(res, 200, await jobs.cancel(jobRoute[1]));
      const withShareUrl = share => ({ ...share, url: `${access.origin || `http://${req.headers.host}`}/s/${share.token}`, scope: access.hosted ? 'public' : 'local' });
      if (req.method === 'GET' && pathname === '/api/shares') return json(res, 200, (await shares.list()).map(withShareUrl));
      if (req.method === 'POST' && pathname === '/api/shares') return json(res, 201, withShareUrl(await shares.create(await readJSON(req))));
      if (req.method === 'DELETE' && pathname.startsWith('/api/shares/')) return json(res, 200, await shares.remove(pathname.slice('/api/shares/'.length)));
      if (req.method === 'POST' && pathname === '/api/export') {
        const input = await readJSON(req);
        const graph = validateGraph(input.graph);
        const formats = {
          markdown: ['md', 'text/markdown; charset=utf-8', () => toMarkdown(graph)],
          json: ['json', 'application/json; charset=utf-8', () => JSON.stringify(graph, null, 2)],
          svg: ['svg', 'image/svg+xml; charset=utf-8', () => renderGraphSvg(graph)],
          html: ['html', 'text/html; charset=utf-8', () => renderGraphHtml(graph)],
          pptx: ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', () => renderGraphPptx(graph)],
        };
        const format = formats[input.format];
        if (!format) throw new Error('不支持的导出格式。');
        const body = await format[2]();
        res.writeHead(200, { 'Content-Type': format[1], 'Content-Disposition': `attachment; filename="chatgraph.${format[0]}"; filename*=UTF-8''${encodeURIComponent(graph.title)}.${format[0]}`, 'Cache-Control': 'no-store' });
        return res.end(body);
      }
      if (pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在。' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '不支持的请求方法。' });
      const relative = pathname === '/' ? 'index.html' : pathname === '/login' ? 'login.html' : pathname.slice(1);
      const target = path.resolve(publicDir, relative);
      if (!target.startsWith(`${publicDir}${path.sep}`)) return json(res, 404, { error: '文件不存在。' });
      const actual = await fs.realpath(target);
      if (!actual.startsWith(`${publicDir}${path.sep}`)) return json(res, 404, { error: '文件不存在。' });
      const body = await fs.readFile(actual);
      res.writeHead(200, { 'Content-Type': types[path.extname(actual)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error.code === 'ENOENT' ? 404 : error.status || 400;
      json(res, status, { error: error.code === 'ENOENT' ? '图谱或文件不存在。' : (error.code ? '本地文件操作失败，请检查数据目录权限。' : error.message || '操作失败，请重试。') });
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  server.maxRequestsPerSocket = 100;
  // Direct analysis can make one repair attempt (2 × 240 seconds).
  server.setTimeout(10 * 60_000, socket => socket.destroy());
  server.on('close', () => jobs.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadPrivateConfig(path.join(root, '.env'));
  const dataDir = process.env.CHATGRAPH_DATA_DIR || path.join(root, '.data');
  try {
    await fs.access(path.join(dataDir, '.incomplete'));
    throw new Error('数据目录的恢复尚未完成（存在 .incomplete 标记），拒绝启动。请重新校验备份，并恢复到新的空目录后再启动。');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.CHATGRAPH_PORT || 4317);
  const host = process.env.CHATGRAPH_HOST || '127.0.0.1';
  if (host !== '127.0.0.1' && !process.env.CHATGRAPH_PUBLIC_ORIGIN) throw new Error('对外监听前须配置 HTTPS 域名和工作区密码。');
  const server = createAppServer({ dataDir });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被使用，请设置 CHATGRAPH_PORT。` : '服务启动失败。'); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`ChatGraph → http://127.0.0.1:${server.address().port}`));
}
