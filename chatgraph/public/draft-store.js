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

export const draftStore = {
  all: () => transaction('readonly', store => store.getAll()),
  owns: draft => !draft.owner || draft.owner === owner,
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
    // Explicit allowlist: temporary API configuration can never be persisted.
    const safe = { text: input.text || '', title: input.title || '', platform: input.platform || '', url: input.url || '', mode: input.mode || 'outline' };
    if (input.capture) safe.capture = { scope: input.capture.scope, complete: input.capture.complete, warnings: input.capture.warnings, capturedAt: input.capture.capturedAt };
    const value = { id: `import:${owner}:${operation.operationId}`, owner, kind: 'pending-import', operationId: operation.operationId, input: safe,
      targetGraphId: operation.targetGraphId || null, resultGraphId: operation.resultGraphId || null, jobId: operation.jobId || null, phase: operation.phase || 'draft', updatedAt: Date.now() };
    return transaction('readwrite', store => store.put(value));
  },
  removeImport: operationId => transaction('readwrite', store => store.delete(`import:${owner}:${operationId}`)),
};
