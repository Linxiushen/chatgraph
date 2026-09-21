import { inspectConversationFile } from './import-model.js';

const DB_NAME = 'chatgraph-drafts';
let connection;
const ownerKey = 'chatgraph-draft-owner';
let owner;
try { owner = sessionStorage.getItem(ownerKey); } catch { /* A private browser may disable session storage. */ }
if (!/^[a-f0-9-]{36}$/.test(owner || '')) owner = crypto.randomUUID();
function rememberOwner() { try { sessionStorage.setItem(ownerKey, owner); } catch { /* Recovery remains available in other drafts. */ } }
rememberOwner();

// Duplicating a browser tab can copy sessionStorage. Existing tabs answer this
// startup probe so the duplicate acquires its own draft namespace before editing.
if (typeof BroadcastChannel !== 'undefined') {
  const channel = new BroadcastChannel('chatgraph-draft-tabs'), nonce = crypto.randomUUID();
  channel.addEventListener('message', event => {
    if (event.data?.owner !== owner) return;
    if (event.data.kind === 'probe') channel.postMessage({ kind: 'present', owner, nonce: event.data.nonce });
    if (event.data.kind === 'present' && event.data.nonce === nonce) { owner = crypto.randomUUID(); rememberOwner(); }
  });
  channel.postMessage({ kind: 'probe', owner, nonce });
}

function open() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

async function transaction(mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode), request = operation(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('草稿存储中断'));
  });
}

const mobileImport = draft => /^[a-f0-9-]{36}$/.test(draft?.mobileShareId || '');
function recoverableImports(records, { includeForeign = false } = {}) {
  const grouped = new Map();
  for (const record of records) {
    if (record.kind !== 'pending-import' || !record.operationId || !record.input || (!includeForeign && !draftStore.owns(record) && !mobileImport(record))) continue;
    const copies = grouped.get(record.operationId) || [];
    copies.push(record); grouped.set(record.operationId, copies);
  }
  return [...grouped.values()].map(copies => {
    copies.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    // An older window can retain a pre-submit draft after another session has
    // already admitted the paid job. Keep that job's input and receipt together.
    return copies[0].jobId ? copies[0] : copies.find(record => record.jobId) || copies[0];
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export const draftStore = {
  all: () => transaction('readonly', store => store.getAll()),
  owns: draft => !draft.owner || draft.owner === owner,
  // Mobile app processes may lose sessionStorage while IndexedDB survives.
  // Only mobile import receipts cross owner boundaries; graph edits stay local.
  recoverableImports,
  // Only graph data is accepted. API settings never enter this store.
  put: draft => transaction('readwrite', store => store.put({ id: `${owner}:${draft.graph.id}`, owner, graph: draft.graph, dirty: draft.dirty, saved: draft.saved, autoSavePaused: draft.autoSavePaused || false, recoveredAt: Date.now() })),
  remove: async graphId => {
    await transaction('readwrite', store => store.delete(`${owner}:${graphId}`));
    // Only the old, unnamespaced format uses a bare graph ID.
    await transaction('readwrite', store => store.delete(graphId));
  },
  discard: storageId => transaction('readwrite', store => store.delete(storageId)),
  putImport: operation => {
    const input = operation.input || {};
    // Account exports must be narrowed in memory before entering durable drafts.
    // Refuse malformed JSON too: a partly pasted archive can still contain chats.
    if (/^[\s\uFEFF]*[\[{]/.test(input.text || '') && inspectConversationFile(input.text).kind === 'archive') throw new Error('请先选择一个会话，再保存导入草稿。');
    // Explicit allowlist: temporary API configuration can never be persisted.
    const safe = { text: input.text || '', title: input.title || '', platform: input.platform || '', url: input.url || '', mode: input.mode || 'outline' };
    if (input.capture) safe.capture = { scope: input.capture.scope, complete: input.capture.complete, warnings: input.capture.warnings, capturedAt: input.capture.capturedAt };
    const value = { id: `import:${owner}:${operation.operationId}`, owner, kind: 'pending-import', operationId: operation.operationId, input: safe,
      mobileShareId: /^[a-f0-9-]{36}$/.test(operation.mobileShareId || '') ? operation.mobileShareId : null,
      mobileShareRevision: Number.isInteger(operation.mobileShareRevision) && operation.mobileShareRevision > 0 ? operation.mobileShareRevision : null,
      recoveredFrom: Array.isArray(operation.recoveredFrom) ? operation.recoveredFrom.filter(item => item && typeof item.id === 'string' && item.id.length <= 200 && Number.isSafeInteger(item.updatedAt)).slice(-100).map(item => ({ id: item.id, updatedAt: item.updatedAt, jobId: typeof item.jobId === 'string' ? item.jobId : null })) : [],
      targetGraphId: operation.targetGraphId || null, resultGraphId: operation.resultGraphId || null, jobId: operation.jobId || null, phase: operation.phase || 'draft', updatedAt: Date.now() };
    return transaction('readwrite', store => store.put(value));
  },
  removeImport: (operationId, mobileShareId, recoveredFrom = []) => transaction('readwrite', store => {
    const mobile = mobileImport({ mobileShareId });
    if (!mobile && !recoveredFrom.length) return store.delete(`import:${owner}:${operationId}`);
    const request = store.getAll();
    request.onsuccess = () => {
      for (const record of request.result) {
        if (record.kind !== 'pending-import' || record.operationId !== operationId) continue;
        if (mobile ? record.mobileShareId === mobileShareId : record.id === `import:${owner}:${operationId}`) store.delete(record.id);
        // Explicit adoption only cleans the source versions the user accepted.
        // A different window's newer input or retry receipt must survive.
        else if (!mobile && recoveredFrom.some(source => source.id === record.id && source.updatedAt === record.updatedAt && source.jobId === (record.jobId || null))) store.delete(record.id);
      }
    };
    return request;
  }),
};
