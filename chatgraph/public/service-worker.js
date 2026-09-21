import { shareFromFormData, saveMobileShare, MOBILE_SHARE_LIMITS, MOBILE_SHARE_ERRORS } from './mobile.js';

// Only public, content-free entry assets belong in this cache. Never cache the app or API responses.
const CACHE_NAME = 'chatgraph-mobile-entry-v1';
const ENTRY_ASSETS = [
  '/mobile-inbox.html', '/mobile-inbox.js', '/mobile-inbox.css', '/mobile.js', '/manifest.webmanifest', '/offline.html',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];
const ENTRY_PATHS = new Set(ENTRY_ASSETS);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ENTRY_ASSETS.map(url => new Request(url, { cache: 'reload', credentials: 'omit' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('chatgraph-mobile-entry-') && name !== CACHE_NAME) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function receiveShare(request) {
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw { code: 'format' };
    const length = Number(request.headers.get('content-length'));
    if (length > MOBILE_SHARE_LIMITS.file + MOBILE_SHARE_LIMITS.text + 64 * 1024) throw { code: 'size' };
    const record = await saveMobileShare(await shareFromFormData(await request.formData()));
    return Response.redirect(new URL(`/mobile-inbox.html#${record.id}`, self.location.origin), 303);
  } catch (error) {
    const code = Object.hasOwn(MOBILE_SHARE_ERRORS, error?.code) ? error.code : 'storage';
    return Response.redirect(new URL(`/mobile-inbox.html#error=${code}`, self.location.origin), 303);
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/mobile-share' && event.request.method === 'POST') {
    // No network fallback: a received transcript must never accidentally be posted to the server.
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (ENTRY_PATHS.has(url.pathname) && !url.search) {
    event.respondWith((async () => {
      try { return await fetch(event.request); }
      catch {
        return (await caches.match(url.pathname)) || Response.error();
      }
    })());
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(event.request); }
      catch {
        const fallback = await caches.match('/offline.html');
        return fallback ? new Response(await fallback.text(), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }) : Response.error();
      }
    })());
  }
});
