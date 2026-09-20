import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Optional single-owner hosted workspace, behind a TLS reverse proxy. */
export function createAccessControl(env) {
  const hosted = Boolean(env.CHATGRAPH_PUBLIC_ORIGIN);
  let origin = '';
  if (hosted) {
    const value = new URL(env.CHATGRAPH_PUBLIC_ORIGIN);
    if (value.protocol !== 'https:' || value.username || value.password || value.pathname !== '/' || value.search || value.hash) throw new Error('托管模式需要 HTTPS 的 CHATGRAPH_PUBLIC_ORIGIN 根域名。');
    if (typeof env.CHATGRAPH_AUTH_PASSWORD !== 'string' || env.CHATGRAPH_AUTH_PASSWORD.length < 16) throw new Error('托管模式需要至少 16 字符的 CHATGRAPH_AUTH_PASSWORD。');
    origin = value.origin;
  }
  const salt = randomBytes(32);
  const expected = hosted ? scryptSync(env.CHATGRAPH_AUTH_PASSWORD, salt, 32) : null;
  const sessions = new Map(), attempts = new Map();
  return {
    hosted, origin,
    validHost(host, port) {
      return hosted ? host === new URL(origin).host : [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host);
    },
    validOrigin(value, host) { return !value || value === (hosted ? origin : `http://${host}`); },
    authenticated(req) {
      if (!hosted) return true;
      const id = req.headers.cookie?.match(/(?:^|;\s*)chatgraph_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      return Boolean(id && sessions.get(id) > Date.now());
    },
    login(password, address = 'unknown') {
      if (!hosted) return '';
      const now = Date.now();
      const rate = attempts.get(address);
      if (rate && rate.until > now && rate.count >= 5) throw Object.assign(new Error('尝试过于频繁，请 15 分钟后再试。'), { status: 429 });
      const bounded = typeof password === 'string' && password.length <= 1024 ? password : '';
      if (!timingSafeEqual(scryptSync(bounded, salt, 32), expected)) {
        attempts.set(address, { until: now + 15 * 60000, count: rate && rate.until > now ? rate.count + 1 : 1 });
        throw Object.assign(new Error('密码不正确。'), { status: 401 });
      }
      attempts.delete(address);
      for (const [id, expiry] of sessions) if (expiry <= now) sessions.delete(id);
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, now + 86400000);
      return `chatgraph_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
    },
    logout(req) {
      const id = req.headers.cookie?.match(/(?:^|;\s*)chatgraph_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      sessions.delete(id);
      return 'chatgraph_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
    },
  };
}
