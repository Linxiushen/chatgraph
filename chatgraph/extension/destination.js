/* Shared by the extension UI and its tests. This stores no conversation data. */
(() => {
  function parseDestination(value) {
    const raw = String(value || '').trim();
    let url;
    try { url = new URL(raw); } catch { throw new Error('请输入完整的 ChatGraph 地址，例如 https://graph.example.com。'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('请只填写工作区根地址，不要包含账号、路径、查询参数或片段。');
    }
    if (!url.hostname || url.hostname.includes('*')) throw new Error('请填写一个具体的工作区主机，不能使用通配符。');
    const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (!local && url.protocol !== 'https:') throw new Error('手机工作区必须使用 HTTPS；HTTP 仅支持本机 127.0.0.1。');
    // Chrome host permissions cannot restrict ports. Injection separately checks
    // the exact origin, including its port, before releasing the capture.
    return Object.freeze({ origin: url.origin, url: `${url.origin}/`, permission: `${url.protocol}//${url.hostname}/*`, local });
  }
  globalThis.ChatGraphDestination = Object.freeze({ parseDestination, defaultOrigin: 'http://127.0.0.1:4317' });
})();
