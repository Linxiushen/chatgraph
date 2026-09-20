import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createChatGraphMcp } from './tools.mjs';
import { createAuth } from './auth.mjs';

export function createHttpServer({ env = process.env, analyze, auth = createAuth(env) } = {}) {
  const publicUrl = env.CHATGRAPH_MCP_PUBLIC_URL ? new URL(env.CHATGRAPH_MCP_PUBLIC_URL) : null;
  if (publicUrl && (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash)) throw new Error('PUBLIC_URL 必须是无凭证的 HTTPS 地址。');
  if (publicUrl && env.CHATGRAPH_MCP_ENABLE_AI === '1' && !auth) throw new Error('公共端点启用付费模型前必须配置 OAuth 资源服务；本机调试不需要。');
  const permittedHosts = new Set(['127.0.0.1', 'localhost', '[::1]', ...(publicUrl ? [publicUrl.hostname] : [])]);
  const permittedOrigins = new Set(['https://chatgpt.com', ...(publicUrl ? [publicUrl.origin] : [])]);
  const buckets = new Map();
  const sessions = new Map();
  let startingSessions = 0;
  let activeAnalysis = false;
  const guardedAnalyze = analyze ? async (...args) => {
    if (activeAnalysis) throw new Error('已有模型整理正在进行，请稍后重试。');
    activeAnalysis = true;
    try { return await analyze(...args); } finally { activeAnalysis = false; }
  } : async (...args) => {
    if (activeAnalysis) throw new Error('已有模型整理正在进行，请稍后重试。');
    activeAnalysis = true;
    try { return await (await import('../../lib/ai.mjs')).extractConversation(...args); } finally { activeAnalysis = false; }
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (code, body) => { if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    let url;
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) return reply(400, { error: 'Expected origin-form request URL' });
    try { url = new URL(req.url, `http://${req.headers.host}`); } catch { return reply(400, { error: 'Invalid request URL' }); }
    if (!permittedHosts.has(url.hostname)) return reply(403, { error: 'Host not allowed' });
    const origin = req.headers.origin;
    if (origin) {
      let localOrigin = false;
      try { const parsed = new URL(origin); localOrigin = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname); } catch {}
      if (!permittedOrigins.has(origin) && !localOrigin) return reply(403, { error: 'Origin not allowed' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
    }
    if (req.method === 'GET' && url.pathname === '/') return reply(200, { name: 'chatgraph', version: '0.2.0', transport: 'streamable-http', authenticated: !!auth, aiEnabled: env.CHATGRAPH_MCP_ENABLE_AI === '1' });
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') return auth ? reply(200, auth.metadata) : reply(404, { error: 'OAuth is not configured' });
    if (url.pathname !== '/mcp') return reply(404, { error: 'Not found' });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return reply(405, { error: 'Method not allowed' });
    let principal = 'anonymous';
    if (auth) {
      try { principal = (await auth.verify(req.headers.authorization)).subject; }
      catch { res.setHeader('WWW-Authenticate', auth.challenge); return reply(401, { error: 'Authentication required' }); }
    }
    const now = Date.now();
    for (const [key, value] of buckets) if (now - value.started >= 60_000) buckets.delete(key);
    const client = req.socket.remoteAddress || 'local';
    const bucket = buckets.get(client) || { started: now, count: 0 }; bucket.count++; buckets.set(client, bucket);
    if (bucket.count > 60) { res.setHeader('Retry-After', '60'); return reply(429, { error: 'Too many requests' }); }
    let parsedBody;
    if (req.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'Expected application/json' });
      if (Number(req.headers['content-length']) > 2_000_000) return reply(413, { error: 'Request exceeds 2 MB' });
      const chunks = []; let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2_000_000) { reply(413, { error: 'Request exceeds 2 MB' }); return; }
          chunks.push(chunk);
        }
        parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch { return reply(400, { error: 'Invalid JSON' }); }
    }
    let session;
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId) {
      session = sessions.get(sessionId);
      if (!session || session.principal !== principal) return reply(404, { error: 'MCP session not found' });
    } else if (req.method === 'POST' && isInitializeRequest(parsedBody)) {
      if (sessions.size + startingSessions >= 30) return reply(429, { error: 'Too many active MCP sessions' });
      startingSessions++;
      try {
        const mcp = await createChatGraphMcp({ env, analyze: guardedAnalyze, auth: !!auth });
        session = { mcp, principal, lastUsed: Date.now(), activeRequests: 0, id: null };
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true,
          onsessioninitialized(id) { session.id = id; sessions.set(id, session); },
        });
        session.transport = transport;
        transport.onclose = () => { if (session.id) sessions.delete(session.id); };
        await mcp.connect(transport);
      } catch { return reply(500, { error: 'MCP initialization failed' }); }
      finally { startingSessions--; }
    } else return reply(400, { error: 'Initialize an MCP session first' });
    session.lastUsed = Date.now(); session.activeRequests++;
    res.on('close', () => { session.activeRequests--; session.lastUsed = Date.now(); });
    try { await session.transport.handleRequest(req, res, parsedBody); }
    catch { if (!res.headersSent) reply(500, { error: 'MCP request failed' }); else res.end(); }
    finally { if (!session.id) await session.mcp.close().catch(() => {}); }
  });
  const cleanup = setInterval(() => {
    for (const session of sessions.values()) if (!session.activeRequests && Date.now() - session.lastUsed > 30 * 60_000) session.mcp.close().catch(() => {});
  }, 60_000);
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); for (const session of sessions.values()) session.mcp.close().catch(() => {}); sessions.clear(); });
  server.requestTimeout = 35_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--stdio')) {
    const server = await createChatGraphMcp();
    await server.connect(new StdioServerTransport());
  } else {
    const port = Number(process.env.CHATGRAPH_MCP_PORT || 4318);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CHATGRAPH_MCP_PORT 无效。');
    const server = createHttpServer();
    server.listen(port, '127.0.0.1', () => process.stderr.write(`ChatGraph MCP: http://127.0.0.1:${port}/mcp\n`));
  }
}
