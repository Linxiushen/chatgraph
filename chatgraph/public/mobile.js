// Shared by the mobile inbox, app and service worker. No remote requests or model calls.
export const MOBILE_SHARE_LIMITS = Object.freeze({ text: 2 * 1024 * 1024, file: 25 * 1024 * 1024, total: 50 * 1024 * 1024, entries: 5, ttl: 24 * 60 * 60 * 1000 });
const DB_NAME = 'chatgraph-mobile-inbox-v1';
const STORE_NAME = 'shares';
const PENDING_KEY = 'chatgraph:mobile-import';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const encoder = new TextEncoder();
const byteLength = value => encoder.encode(value).byteLength;

export class MobileShareError extends Error {
  constructor(code, message) { super(message); this.name = 'MobileShareError'; this.code = code; }
}

export const MOBILE_SHARE_ERRORS = Object.freeze({
  empty: '没有收到可读取的内容。请复制对话文字，或选择 TXT、Markdown、JSON 文件。',
  size: '内容过大。文字最多 2 MB，单个对话文件最多 25 MB。',
  file: '请选择一个 UTF-8 编码的 TXT、Markdown 或 JSON 文件。暂不读取图片、PDF、音频和压缩包。',
  multiple: '一次只接收一个对话文件，请分别分享。',
  url: '来源链接须为有效的 HTTP 或 HTTPS 地址。',
  format: '分享内容格式不正确，请返回原应用，复制文字或选择对话文件。',
  storage: '浏览器暂时无法保存待整理内容。请开启网站存储，或复制文字后直接进入工作台导入。',
  conflict: '这份内容已在另一个窗口更新。当前输入仍保留，请复制需要保留的修改，再重新打开收件箱中的最新内容。',
  full: '手机收件箱已满。请先整理或删除已有内容，再重新分享。',
  unavailable: '未找到这份待整理内容，可能已整理、已删除，或已超过 24 小时。',
});
function fail(code) { throw new MobileShareError(code, MOBILE_SHARE_ERRORS[code]); }
function safeString(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail('format');
  if (byteLength(value) > max) fail('size');
  return value;
}
function safeUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('url');
    return parsed.href;
  } catch { fail('url'); }
}
function onlyUrl(text) {
  if (!/^https?:\/\/\S+$/i.test(text)) return '';
  try { return safeUrl(text); } catch { return ''; }
}

/** A shared URL is a pointer, never evidence that we received a transcript. */
export function classifyMobileText(text, url = '', title = '') {
  const trimmed = text.trim();
  const link = onlyUrl(trimmed);
  if (link) return { text: '', url: url || link, kind: 'link' };
  if (url && (!trimmed || trimmed === title.trim())) return { text: '', url, kind: 'link' };
  // Native share sheets commonly combine a title and a link into two lines.
  const lines = trimmed.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 2 && title.trim()) {
    const titleLine = lines.find(line => line.trim() === title.trim());
    const urlLine = lines.find(line => onlyUrl(line.trim()));
    if (titleLine && urlLine) return { text: '', url: url || onlyUrl(urlLine.trim()), kind: 'link' };
  }
  // Recognize standard share captions without discarding a dialogue that merely cites a link.
  const urls = trimmed.match(/https?:\/\/[^\s<>]+/gi) || [];
  if (urls.length === 1 && trimmed.length <= 600 && !/^(?:\s*#{1,6}\s*)?(?:我|用户|人类|AI|助手|user|assistant)\s*[:：]/im.test(trimmed)) {
    const candidate = onlyUrl(urls[0]);
    if (candidate) {
      const parsed = new URL(candidate);
      const aiShare = /^(chatgpt\.com|chat\.openai\.com|chat\.deepseek\.com|claude\.ai|gemini\.google\.com|g\.co)$/.test(parsed.hostname) && /\/(share|s)\//.test(parsed.pathname);
      const caption = trimmed.replace(urls[0], '').trim().replace(/[:：\-–—]+$/, '').trim();
      if (aiShare && /^(?:(?:check out|view|see|shared?)(?: this)?(?: conversation| chat)?(?: with)?(?: (?:ChatGPT|DeepSeek|Claude|Gemini))?|(?:ChatGPT|DeepSeek|Claude|Gemini)(?: conversation| chat)?|(?:查看|分享|来自|点击查看).{0,100})$/i.test(caption)) {
        return { text: '', url: url || candidate, kind: 'link' };
      }
    }
  }
  return { text, url, kind: text.trim() ? 'text' : 'link' };
}

/** Validate before storage; only known fields are retained. */
export function normalizeMobileShare(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('format');
  const id = input.id || globalThis.crypto.randomUUID();
  if (!UUID.test(id)) fail('format');
  const title = safeString(input.title, 4096).trim().slice(0, 200);
  const fileName = safeString(input.fileName, 1024).trim();
  if (fileName && !/\.(txt|md|markdown|json)$/i.test(fileName)) fail('file');
  let text = safeString(input.text, fileName ? MOBILE_SHARE_LIMITS.file : MOBILE_SHARE_LIMITS.text);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) fail('file');
  let url = safeUrl(safeString(input.url, 8192));
  if (!url && !text.trim()) url = onlyUrl(title);
  let kind;
  if (fileName) { kind = 'file'; if (!text.trim()) fail('empty'); }
  else ({ text, url, kind } = classifyMobileText(text, url, title));
  if (!text.trim() && !url) fail('empty');
  const bytes = byteLength(text) + byteLength(title) + byteLength(url) + byteLength(fileName);
  return { id, title, text, url, fileName, kind, bytes, createdAt: Number.isFinite(input.createdAt) && input.createdAt <= now ? input.createdAt : now };
}

export async function readMobileFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') fail('file');
  if (file.size > MOBILE_SHARE_LIMITS.file) fail('size');
  if (!/\.(txt|md|markdown|json)$/i.test(file.name)) fail('file');
  const mime = String(file.type || '').toLowerCase().split(';')[0];
  if (mime && !['text/plain', 'text/markdown', 'text/x-markdown', 'application/json', 'text/json', 'application/octet-stream'].includes(mime)) fail('file');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { fail('file'); }
  return normalizeMobileShare({ text, fileName: file.name, title: file.name.replace(/\.[^.]+$/, '') });
}

export async function shareFromFormData(form) {
  if (!form || typeof form.getAll !== 'function') fail('format');
  for (const name of ['title', 'text', 'url']) if (form.getAll(name).length > 1) fail('format');
  const values = Object.fromEntries(['title', 'text', 'url'].map(name => [name, form.get(name) || '']));
  // Check the text fields even when a file is present, so ignored fields cannot bypass limits.
  safeString(values.title, 4096); safeString(values.text, MOBILE_SHARE_LIMITS.text); safeUrl(safeString(values.url, 8192));
  const files = form.getAll('files').filter(file => !(typeof file === 'object' && file.size === 0 && !file.name));
  if (files.length > 1) fail('multiple');
  if (!files.length) return normalizeMobileShare(values);
  const file = await readMobileFile(files[0]);
  // A file is the selected source. Native share captions are metadata, not extra transcript turns.
  return normalizeMobileShare({ ...file, title: values.title || file.title, url: values.url });
}

function openInbox() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new MobileShareError('storage', MOBILE_SHARE_ERRORS.storage));
    const request = indexedDB.open(DB_NAME, 1);
    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onerror = request.onblocked = () => { settled = true; reject(new MobileShareError('storage', MOBILE_SHARE_ERRORS.storage)); };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function inboxTransaction(operation) {
  const db = await openInbox();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    let value, failure;
    request.onsuccess = () => {
      try {
        const now = Date.now();
        const records = [];
        for (const entry of request.result) {
          if (!Number.isFinite(entry.createdAt) || entry.createdAt < now - MOBILE_SHARE_LIMITS.ttl) store.delete(entry.id);
          else records.push(entry);
        }
        value = operation(store, records);
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); resolve(value); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(failure || new MobileShareError('storage', MOBILE_SHARE_ERRORS.storage)); };
  });
}

export async function saveMobileShare(input) {
  const record = normalizeMobileShare(input);
  return inboxTransaction((store, records) => {
    const previous = records.find(entry => entry.id === record.id);
    if (previous && input.revision !== undefined && input.revision !== (previous.revision || 1)) fail('conflict');
    // A draft can outlive its inbox entry. Never recycle its id/revision pair:
    // an older completed import may still hold a receipt for that pair.
    if (input.id && !previous) record.id = globalThis.crypto.randomUUID();
    const changed = previous && ['title', 'text', 'url', 'fileName', 'kind'].some(key => previous[key] !== record[key]);
    record.revision = previous ? (previous.revision || 1) + (changed ? 1 : 0) : 1;
    record.createdAt = previous?.createdAt || Date.now();
    const others = records.filter(entry => entry.id !== record.id);
    if (others.length >= MOBILE_SHARE_LIMITS.entries || others.reduce((total, entry) => total + entry.bytes, record.bytes) > MOBILE_SHARE_LIMITS.total) fail('full');
    store.put(record);
    return record;
  });
}
export async function listMobileShares() {
  return inboxTransaction((_store, records) => records.sort((a, b) => b.createdAt - a.createdAt).map(({ text, ...entry }) => entry));
}
export async function readMobileShare(id) {
  if (!UUID.test(id || '')) return null;
  return inboxTransaction((_store, records) => records.find(entry => entry.id === id) || null);
}
export async function removeMobileShare(id, expectedRevision) {
  if (!UUID.test(id || '')) return false;
  const removed = await inboxTransaction((store, records) => {
    const previous = records.find(entry => entry.id === id);
    if (previous && expectedRevision !== undefined && (previous.revision || 1) !== expectedRevision) return false;
    store.delete(id);
    return true;
  });
  if (!removed) return false;
  clearPendingMobileShare(id);
  return true;
}

export function pendingMobileShareId() {
  if (!globalThis.location) return null;
  const hash = new URLSearchParams(location.hash.slice(1)).get('mobile-import');
  if (UUID.test(hash || '')) {
    try { sessionStorage.setItem(PENDING_KEY, hash); } catch { /* The hash is still usable. */ }
    return hash;
  }
  try { const id = sessionStorage.getItem(PENDING_KEY); return UUID.test(id || '') ? id : null; }
  catch { return null; }
}
export function markMobileSharePending(id) {
  if (!UUID.test(id || '')) fail('format');
  try { sessionStorage.setItem(PENDING_KEY, id); } catch { /* Navigation carries the opaque id, too. */ }
  return `/#mobile-import=${id}`;
}
export function clearPendingMobileShare(id) {
  try { if (!id || sessionStorage.getItem(PENDING_KEY) === id) sessionStorage.removeItem(PENDING_KEY); } catch { /* Storage may be disabled. */ }
  if (globalThis.location && new URLSearchParams(location.hash.slice(1)).get('mobile-import') === id) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
}
export async function registerMobile() {
  if (!globalThis.navigator || !('serviceWorker' in navigator) || !globalThis.isSecureContext) return null;
  return navigator.serviceWorker.register('/service-worker.js', { type: 'module', scope: '/', updateViaCache: 'none' });
}
