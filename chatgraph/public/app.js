import { descendantIds, reparentNode, reorderNode, removeNodes, timelineEvents } from './editor-model.js';
import { draftStore } from './draft-store.js';
import { inspectConversationFile, previewConversation } from './import-model.js';
import { registerMobile, pendingMobileShareId, readMobileShare, removeMobileShare, clearPendingMobileShare } from './mobile.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  sparkles: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 2v4M18 4h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  quote: '<path d="M4 12h5v7H3v-7c0-4 2-7 6-7M15 12h5v7h-6v-7c0-4 2-7 6-7"/>',
  settings: '<path d="m9 3-.7 2.4-2 .9L4 5.8l-2 3.4 1.6 1.8v2L2 14.8l2 3.4 2.3-.5 2 .9L9 21h4l.7-2.4 2-.9 2.3.5 2-3.4-1.6-1.8v-2L20 9.2l-2-3.4-2.3.5-2-.9L13 3H9Z"/><circle cx="11" cy="12" r="3"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>', chevronDown: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>', upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  code: '<path d="m7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18"/>', globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-6-6L3 21"/>',
  pencil: '<path d="m15 4 5 5M3 21l5-1L21 7a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16l-1 5Z"/>',
  arrowUpRight: '<path d="M6 18 18 6M6 6h12v12"/>',
  nodes: '<rect x="2" y="8" width="6" height="7" rx="1.5"/><rect x="16" y="2" width="6" height="7" rx="1.5"/><rect x="16" y="15" width="6" height="7" rx="1.5"/><path d="M8 11h4V5h4M12 11v7h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>', filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  maximize: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  undo: '<path d="M3 10h11a7 7 0 0 1 7 7v3M3 10l6-6M3 10l6 6"/>',
  link: '<path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  arrowRight: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/>',
  flag: '<path d="M4 22V3m0 0c5-4 10 4 16 0v11c-6 4-11-4-16 0"/>',
  shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
};
const TYPES = { topic: '主题', claim: '核心观点', evidence: '论证依据', question: '待解问题', action: '下一步' };
const STANCES = { user: '我的判断', ai: 'AI 提议', shared: '共同形成', unknown: '尚未归属' };
const STATUSES = { confirmed: '已确认', proposed: '提议中', rejected: '已否定', revised: '已修正', open: '未解决' };
const RELATIONS = { contains: '包含', supports: '支持', challenges: '反驳', revises: '修正', depends: '依赖' };
const TYPE_ICONS = { topic: 'nodes', claim: 'flag', evidence: 'link', question: 'question', action: 'check' };
const ROLE_NAMES = { user: '我', assistant: 'AI 助手', unknown: '未标注说话者' };
const state = { pendingImports: [], foreignImports: [], foreignDrafts: [], forceTreeLayout: false, autoSavePaused: false, redoHistory: [], multiSelected: new Set(), libraryQuery: '', conflictIds: new Set(), draftStorageFailed: false, graph: null, library: [], drafts: new Map(), view: innerWidth <= 700 ? 'outline' : 'graph', selected: null, dirty: false, saved: false, history: [], camera: { x: 0, y: 0, scale: 1 }, collapsed: new Set(), query: '', filterType: 'all', filterStatus: 'all', inspectorOpen: innerWidth > 880, api: { baseUrl: '', model: '', apiKey: '' }, config: {}, saving: false, importing: false, demo: null };
let toastTimer, drag, modalRestoreFocus, modalCleanup, autosaveTimer, liveEditKey;
const saveInFlight = new Map();
const deletingGraphs = new Set();

function el(tag, props = {}, children = []) {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') result.className = value;
    else if (key === 'text') result.textContent = value ?? '';
    else if (key === 'dataset') Object.assign(result.dataset, value);
    else if (key.startsWith('on')) result.addEventListener(key.slice(2), value);
    else if (key in result) result[key] = value;
    else result.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) if (child != null) result.append(child);
  return result;
}
function icon(name) {
  const wrapper = el('span', { class: 'icon-wrap', 'aria-hidden': 'true' });
  // Only fixed icon paths from this module are inserted as markup.
  wrapper.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.nodes}</svg>`;
  return wrapper;
}
function hydrateIcons(root = document) { $$('[data-icon]', root).forEach(node => node.replaceChildren(icon(node.dataset.icon))); }
function clone(value) { return structuredClone(value); }
function uid(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function button(label, action, className = 'secondary', iconName) { return el('button', { class: className, type: 'button', onclick: action }, [iconName ? icon(iconName) : null, el('span', { text: label })]); }
function toast(message, error = false) { clearTimeout(toastTimer); const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false; toastTimer = setTimeout(() => { node.hidden = true; }, error ? 7500 : 3600); }
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (response.status === 401) { showSessionExpired(); const error = new Error('登录已过期。请重新登录，再回到此页面重试；当前输入继续保留。'); error.status = 401; throw error; }
  if (response.ok) $('#session-expired')?.remove();
  if (!response.ok) { let data; try { data = await response.json(); } catch { data = {}; } const error = new Error(data.error || `请求失败（${response.status}），请确认本地服务仍在运行。`); error.status = response.status; throw error; }
  return response.json();
}
function showSessionExpired() {
  if ($('#session-expired')) return;
  const password = el('input', { type: 'password', autocomplete: 'current-password', required: true, placeholder: '工作区密码', 'aria-label': '重新登录工作区密码' });
  const submit = el('button', { type: 'submit', text: '重新登录' });
  const status = el('span', { role: 'status' });
  const banner = el('form', { id: 'session-expired', class: 'session-expired', 'aria-label': '登录过期后继续工作' }, [
    el('span', { text: '登录已过期，输入已保留。重新登录后可继续。' }), password, submit, status,
  ]);
  banner.addEventListener('submit', async event => {
    event.preventDefault(); submit.disabled = true; status.textContent = '';
    try {
      const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) });
      password.value = '';
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '暂时无法重新登录，请重试。'); }
      banner.remove(); scheduleSave(); toast('已重新登录，未完成的整理可继续。');
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  // Keep reauthentication reachable inside an active dialog's focus trap.
  ($('#modal-root .modal') || document.body).append(banner);
}
function graphMode(graph) { return graph?.sessions?.length > 1 ? `${graph.sessions.length} 次对话 · 持续积累` : graph?.mode === 'ai' ? 'AI 结构化' : graph?.mode === 'outline' ? '原文整理 · 非 AI 分析' : '示例图谱'; }
function modeExplanation(graph) {
  if (graph?.sessions?.length > 1) {
    const ai = graph.sessions.filter(session => session.mode === 'ai').length;
    const demo = graph.sessions.filter(session => session.mode === 'demo').length;
    return `已汇入 ${graph.sessions.length} 次对话，其中 ${ai} 次使用 AI 结构化${demo ? `、${demo} 次为演示数据` : ''}。每次对话保留独立来源，AI 提取的判断与关系仍需核对。`;
  }
  return graph?.mode === 'demo' ? '这是演示数据，用来体验观点归属与原文追溯。导入你的对话，开始自己的图谱。' : graph?.mode === 'outline' ? '当前为原文整理：按照输入对话组织节点，未调用 AI 分析。节点类型、归属与状态可以手动确认。' : 'AI 提取结果需要你的确认。“依据”表示对话内的论证材料，不代表经过外部事实核查。';
}
function matches(node) { const query = state.query.toLocaleLowerCase(); return (state.filterType === 'all' || node.type === state.filterType) && (state.filterStatus === 'all' || node.status === state.filterStatus) && (!query || [node.label, node.summary, node.note, TYPES[node.type], STANCES[node.stance], STATUSES[node.status]].join(' ').toLocaleLowerCase().includes(query)); }
function collapsedDescendants() {
  const hidden = new Set();
  if (!state.graph || !state.collapsed.size) return hidden;
  const children = new Map();
  for (const node of state.graph.nodes) {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node.id);
  }
  for (const root of state.collapsed) {
    const stack = [...(children.get(root) || [])], visited = new Set([root]);
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id); hidden.add(id); stack.push(...(children.get(id) || []));
    }
  }
  return hidden;
}
function visibleNodes() { const hidden = collapsedDescendants(); return state.graph?.nodes.filter(node => !hidden.has(node.id) && matches(node)) || []; }
function toggleBranch(id) {
  if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
  if (collapsedDescendants().has(state.selected)) state.selected = id;
  renderGraph(); renderInspector();
}
function selectedNode() { return state.graph?.nodes.find(node => node.id === state.selected); }
function remember() {
  if (!state.graph) return;
  const draft = { graph: clone(state.graph), dirty: state.dirty, saved: state.saved, autoSavePaused: state.autoSavePaused, history: clone(state.history), redoHistory: clone(state.redoHistory), camera: { ...state.camera }, selected: state.selected };
  state.drafts.set(state.graph.id, draft);
  if (draft.dirty) persistDraft(draft);
}
function persistDraft(draft) {
  draftStore.put(draft).catch(() => {
    if (!state.draftStorageFailed) toast('浏览器草稿空间不可用，请保持本地服务在线并保存或导出。', true);
    state.draftStorageFailed = true;
  });
}
function snapshot() {
  state.history.push(clone(state.graph));
  if (state.history.length > 35) state.history.shift();
  state.redoHistory = [];
}
function scheduleSave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    for (const [id, draft] of state.drafts) if (draft.dirty && !state.conflictIds.has(id) && !draft.autoSavePaused) saveGraphId(id, { silent: true });
  }, 1200);
}
function changed() {
  state.dirty = true; state.autoSavePaused = false; state.graph.updatedAt = new Date().toISOString();
  remember(); renderHeader(); renderLibrary(); scheduleSave();
}
function mutate(fn, options = {}) {
  if (!state.graph) return;
  snapshot();
  try { fn(state.graph); }
  catch (error) { state.graph = state.history.pop(); toast(error.message, true); return; }
  changed(); if (options.render !== false) render();
}
function undo() {
  if (!state.history.length) return toast('还没有可以撤销的修改');
  const revision = state.graph.revision;
  state.redoHistory.push(clone(state.graph)); state.graph = state.history.pop();
  if (revision !== undefined) state.graph.revision = revision;
  if (!selectedNode()) state.selected = null;
  state.multiSelected.clear(); changed(); render(); toast('已撤销上一步修改');
}
function redo() {
  if (!state.redoHistory.length) return toast('还没有可以重做的修改');
  const revision = state.graph.revision;
  state.history.push(clone(state.graph)); state.graph = state.redoHistory.pop();
  if (revision !== undefined) state.graph.revision = revision;
  state.multiSelected.clear(); changed(); render(); toast('已重做修改');
}
function resetLayout() {
  state.forceTreeLayout = true;
  mutate(graph => { for (const node of graph.nodes) { delete node.x; delete node.y; } });
  requestAnimationFrame(fitCanvas);
}

function layoutGraph() {
  const graph = state.graph;
  if (!graph) return;
  // The curated example has deliberately flat semantic ownership. Give its
  // many sibling ideas a balanced mind-map layout without changing hierarchy.
  if (graph.id === 'chatgraph-demo' && !state.forceTreeLayout) {
    const examplePositions = {
      'demo-root': [355, 260], 'demo-pain': [0, 0], 'demo-audience': [0, 130],
      'demo-abandoned': [0, 260], 'demo-output': [0, 390], 'demo-test': [0, 520],
      'demo-ownership': [710, 0], 'demo-evidence': [710, 130], 'demo-entry': [710, 260],
      'demo-archify': [710, 390], 'demo-platform': [710, 520],
    };
    for (const node of graph.nodes) {
      const position = examplePositions[node.id];
      if (position && !Number.isFinite(node.x)) node.x = position[0];
      if (position && !Number.isFinite(node.y)) node.y = position[1];
    }
  }
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const children = new Map();
  for (const node of graph.nodes) { const parentId = node.parentId && byId.has(node.parentId) && node.parentId !== node.id ? node.parentId : null; if (!children.has(parentId)) children.set(parentId, []); children.get(parentId).push(node); }
  let cursor = 0;
  const visited = new Set();
  const place = (node, depth = 0) => {
    if (visited.has(node.id)) return null;
    visited.add(node.id);
    const ys = (children.get(node.id) || []).map(child => place(child, depth + 1)).filter(value => value !== null);
    const y = ys.length ? (ys[0] + ys.at(-1)) / 2 : cursor++ * 155;
    if (!Number.isFinite(node.x)) node.x = 60 + depth * 345;
    if (!Number.isFinite(node.y)) node.y = 60 + y;
    return y;
  };
  for (const node of children.get(null) || []) place(node);
  for (const node of graph.nodes) if (!visited.has(node.id)) place(node);
}
function applyCamera() { $('#world').style.transform = `translate(${state.camera.x}px, ${state.camera.y}px) scale(${state.camera.scale})`; $('#zoom-value').textContent = `${Math.round(state.camera.scale * 100)}%`; }
function fitCanvas() {
  if (state.view !== 'graph') return;
  const nodes = visibleNodes(); if (!nodes.length) return;
  const bounds = $('#canvas').getBoundingClientRect();
  const minX = Math.min(...nodes.map(node => node.x)), maxX = Math.max(...nodes.map(node => node.x + (node.type === 'topic' ? 260 : 250)));
  const minY = Math.min(...nodes.map(node => node.y)), maxY = Math.max(...nodes.map(node => node.y + 130));
  const scale = Math.max(.13, Math.min(1.02, (bounds.width - 65) / (maxX - minX), (bounds.height - 114) / (maxY - minY)));
  state.camera = { scale, x: (bounds.width - (maxX - minX) * scale) / 2 - minX * scale, y: (bounds.height - (maxY - minY) * scale) / 2 - minY * scale - 1 };
  applyCamera();
}
function zoom(factor, point) {
  const bounds = $('#canvas').getBoundingClientRect();
  const pivot = point || { x: bounds.width / 2, y: bounds.height / 2 };
  const scale = Math.max(.13, Math.min(2.4, state.camera.scale * factor));
  const ratio = scale / state.camera.scale;
  state.camera.x = pivot.x - (pivot.x - state.camera.x) * ratio;
  state.camera.y = pivot.y - (pivot.y - state.camera.y) * ratio;
  state.camera.scale = scale; applyCamera();
}
function renderEdges() {
  const svg = $('#edges'); $$('g', svg).forEach(node => node.remove());
  if (!state.graph) return;
  const byId = new Map(visibleNodes().map(node => [node.id, node]));
  for (const edge of state.graph.edges) {
    const source = byId.get(edge.source), target = byId.get(edge.target); if (!source || !target) continue;
    const group = document.createElementNS(NS, 'g');
    const sameColumn = Math.abs(target.x - source.x) < 40;
    const rightward = target.x >= source.x;
    const start = { x: source.x + (rightward ? (source.type === 'topic' ? 260 : 250) : 0), y: source.y + 58 };
    const end = { x: target.x + (rightward ? 0 : (target.type === 'topic' ? 260 : 250)), y: target.y + 58 };
    const bend = Math.max(45, Math.abs(end.x - start.x) * .5);
    const direction = rightward ? 1 : -1;
    let d = `M${start.x},${start.y} C${start.x + bend * direction},${start.y} ${end.x - bend * direction},${end.y} ${end.x},${end.y}`;
    let labelX = (start.x + end.x) / 2;
    if (sameColumn) {
      const root = state.graph.nodes.find(node => node.type === 'topic');
      const inwardLeft = !root || source.x > root.x;
      const sideX = source.x + (inwardLeft ? 0 : (source.type === 'topic' ? 260 : 250));
      const controlX = sideX + (inwardLeft ? -58 : 58);
      d = `M${sideX},${start.y} C${controlX},${start.y} ${controlX},${end.y} ${sideX},${end.y}`;
      labelX = controlX;
    }
    const line = document.createElementNS(NS, 'path'); line.setAttribute('d', d); line.setAttribute('class', 'graph-edge');
    if (edge.type !== 'contains') { line.setAttribute('stroke-dasharray', edge.type === 'depends' ? '3 5' : '6 4'); line.setAttribute('marker-end', 'url(#arrow)'); }
    if (edge.type === 'challenges') line.style.stroke = '#c7ac95';
    if (edge.type === 'revises') line.style.stroke = '#b7a7c9';
    const hit = document.createElementNS(NS, 'path'); hit.setAttribute('d', d); hit.setAttribute('class', 'edge-hit'); hit.setAttribute('tabindex', '0'); hit.setAttribute('role', 'button'); hit.setAttribute('aria-label', `${source.label} ${RELATIONS[edge.type] || '关联'} ${target.label}，编辑关系`);
    hit.addEventListener('click', event => { event.stopPropagation(); openRelation(edge); });
    hit.addEventListener('keydown', event => { if (event.key === 'Enter') openRelation(edge); });
    group.append(line, hit);
    if (edge.type !== 'contains' || edge.label) { const text = document.createElementNS(NS, 'text'); text.setAttribute('x', String(labelX)); text.setAttribute('y', String((start.y + end.y) / 2 - 8)); text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'edge-label'); text.textContent = String(edge.label || RELATIONS[edge.type] || '').slice(0, 22); group.append(text); }
    svg.append(group);
  }
}
function renderGraph() {
  if (!state.graph) return;
  layoutGraph();
  const fragment = document.createDocumentFragment();
  const nodes = visibleNodes();
  for (const node of nodes) {
    const card = el('button', { class: `graph-node node-${Object.hasOwn(TYPES, node.type) ? node.type : 'claim'}${node.status === 'rejected' ? ' node-rejected' : ''}${node.id === state.selected ? ' selected' : ''}${state.multiSelected.has(node.id) ? ' multi-selected' : ''}`, type: 'button', dataset: { node: node.id }, 'aria-label': `${TYPES[node.type] || '观点'}：${node.label}，${STANCES[node.stance] || '待确认'}` });
    card.dataset.importance = String(node.importance || 3);
    card.setAttribute('aria-pressed', String(state.multiSelected.has(node.id)));
    card.style.left = `${node.x}px`; card.style.top = `${node.y}px`;
    card.append(el('div', { class: 'node-overline' }, [icon(TYPE_ICONS[node.type] || 'flag'), el('span', { text: TYPES[node.type] || '观点' }), el('span', { class: 'node-state', text: `${node.importance >= 4 ? '★ ' : ''}${STATUSES[node.status] || '待确认'}` })]), el('h3', { class: 'node-label', text: node.label }), el('div', { class: 'node-bottom' }, [icon(node.stance === 'ai' ? 'sparkles' : node.stance === 'shared' ? 'nodes' : 'user'), el('span', { text: STANCES[node.stance] || '尚未归属' }), el('span', { class: 'node-source-count' }, [icon('link'), el('span', { text: `${node.sourceIds?.length || 0} 处原文` })])]));
    card.addEventListener('pointerdown', event => startNodeDrag(event, node));
    card.addEventListener('click', event => { event.stopPropagation(); if (!card.dataset.wasDragged) selectNode(node.id, event.shiftKey || event.metaKey || event.ctrlKey); delete card.dataset.wasDragged; });
    fragment.append(card);
    const childCount = state.graph.nodes.filter(child => child.parentId === node.id).length;
    if (childCount) {
      const collapsed = state.collapsed.has(node.id);
      const toggle = button('', event => { event.stopPropagation(); toggleBranch(node.id); }, `node-collapse${collapsed ? ' collapsed' : ''}`, collapsed ? 'plus' : 'minus');
      toggle.dataset.collapseNode = node.id;
      toggle.setAttribute('aria-label', `${collapsed ? '展开' : '折叠'}子节点：${node.label}`);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.title = `${collapsed ? '展开' : '折叠'} ${childCount} 个直接子节点 · 仅影响当前图谱视图`;
      toggle.style.left = `${node.x + (node.type === 'topic' ? 260 : 250) + 7}px`;
      toggle.style.top = `${node.y + 45}px`;
      if (collapsed) toggle.lastChild.textContent = String(childCount);
      fragment.append(toggle);
    }
  }
  $('#nodes').replaceChildren(fragment);
  renderEdges(); applyCamera();
  $('#canvas-empty').textContent = state.graph.nodes.length ? '没有匹配的观点，试试其他搜索或筛选条件。' : '这片画布还是空的，添加一个观点开始吧。';
  $('#canvas-empty').hidden = nodes.length > 0;
  $('#filter-count').textContent = `${nodes.length} / ${state.graph.nodes.length} 个节点`;
}
function startNodeDrag(event, node) {
  if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
  event.stopPropagation();
  const card = event.currentTarget;
  drag = { kind: 'node', pointerId: event.pointerId, node, card, clientX: event.clientX, clientY: event.clientY, originX: node.x, originY: node.y, before: clone(state.graph), moved: false };
  card.setPointerCapture(event.pointerId);
  const move = next => {
    if (!drag || next.pointerId !== drag.pointerId) return;
    const dx = next.clientX - drag.clientX, dy = next.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true; card.classList.add('dragging');
    node.x = drag.originX + dx / state.camera.scale; node.y = drag.originY + dy / state.camera.scale;
    card.style.left = `${node.x}px`; card.style.top = `${node.y}px`; renderEdges();
    const toggle = $$('.node-collapse').find(button => button.dataset.collapseNode === node.id);
    if (toggle) { toggle.style.left = `${node.x + (node.type === 'topic' ? 260 : 250) + 7}px`; toggle.style.top = `${node.y + 45}px`; }
  };
  const end = next => {
    if (!drag || next.pointerId !== drag.pointerId) return;
    if (drag.moved) { state.redoHistory = []; state.history.push(drag.before); if (state.history.length > 35) state.history.shift(); card.dataset.wasDragged = 'true'; changed(); }
    card.classList.remove('dragging'); card.removeEventListener('pointermove', move); card.removeEventListener('pointerup', end); card.removeEventListener('pointercancel', end); drag = null;
  };
  card.addEventListener('pointermove', move); card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
}
function selectNode(id, additive = false) {
  if (additive) {
    if (!state.multiSelected.size && state.selected) state.multiSelected.add(state.selected);
    if (state.multiSelected.has(id)) state.multiSelected.delete(id); else state.multiSelected.add(id);
  } else state.multiSelected.clear();
  state.selected = id; state.inspectorOpen = true; renderInspector(); renderBatchBar();
  $$('.graph-node, .outline-card').forEach(node => {
    node.classList.toggle('selected', node.dataset.node === id);
    node.classList.toggle('multi-selected', state.multiSelected.has(node.dataset.node));
    if (node.matches('.graph-node')) node.setAttribute('aria-pressed', String(state.multiSelected.has(node.dataset.node)));
  });
}
function sourceExcerpt(message) {
  const index = state.graph.messages.findIndex(item => item.id === message.id) + 1;
  return el('div', { class: 'source-excerpt' }, [el('div', { class: 'excerpt-meta' }, [el('span', { class: 'excerpt-role' }, [icon(message.role === 'assistant' ? 'sparkles' : 'user'), el('span', { text: ROLE_NAMES[message.role] || '未标注' })]), el('span', { text: `对话 ${String(index).padStart(2, '0')}` })]), el('p', { text: message.content }), button('在完整对话中查看', () => showSource(message.id), 'text-button', 'arrowUpRight')]);
}
function field(label, control) { if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', label); return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), control]); }
function selectInput(values, value, change) { const select = el('select', { onchange: event => change(event.target.value) }); for (const [key, label] of Object.entries(values)) select.append(el('option', { value: key, text: label, selected: key === value })); return select; }
function editNode(key, value) { const node = selectedNode(); if (!node || node[key] === value) return; if (key === 'label' && !value.trim()) return toast('观点名称不能为空', true); mutate(graph => { graph.nodes.find(item => item.id === node.id)[key] = value; }); }
function hierarchyControls(node) {
  const section = el('div', { class: 'hierarchy-controls' });
  const invalid = descendantIds(state.graph, node.id);
  const choices = { '': '顶层观点', ...Object.fromEntries(state.graph.nodes.filter(item => !invalid.has(item.id)).map(item => [item.id, item.label])) };
  section.append(field('上级观点', selectInput(choices, node.parentId || '', parentId => {
    mutate(graph => {
      reparentNode(graph, node.id, parentId, () => uid('edge'));
      state.forceTreeLayout = true;
      for (const child of graph.nodes) { delete child.x; delete child.y; }
    });
    requestAnimationFrame(fitCanvas);
  })));
  const siblings = state.graph.nodes.filter(item => (item.parentId || null) === (node.parentId || null));
  const index = siblings.findIndex(item => item.id === node.id);
  const move = direction => mutate(graph => {
    reorderNode(graph, node.id, direction);
    state.forceTreeLayout = true;
    for (const item of graph.nodes) { delete item.x; delete item.y; }
  });
  const earlier = button('同级上移', () => move(-1), 'secondary compact'); earlier.disabled = index <= 0;
  const later = button('同级下移', () => move(1), 'secondary compact'); later.disabled = index >= siblings.length - 1;
  section.append(el('div', { class: 'hierarchy-order' }, [earlier, later]));
  return section;
}
function openHierarchy() {
  const node = selectedNode();
  if (!node) return toast('先选择一个观点，再调整它的上级与顺序。');
  state.inspectorOpen = true; renderInspector();
  $('.hierarchy-controls')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('[aria-label="上级观点"]')?.focus();
}
function renderBatchBar() {
  const bar = $('#batch-bar');
  if (!state.graph) return;
  state.multiSelected = new Set([...state.multiSelected].filter(id => state.graph.nodes.some(node => node.id === id)));
  bar.hidden = !state.multiSelected.size;
  if (bar.hidden) return;
  const count = el('span', { text: `已选择 ${state.multiSelected.size} 个观点` });
  const apply = (key, value) => {
    if (!value) return;
    mutate(graph => { for (const node of graph.nodes) if (state.multiSelected.has(node.id)) node[key] = key === 'importance' ? Number(value) : value; });
  };
  const status = selectInput({ '': '批量设置状态', ...STATUSES }, '', value => apply('status', value)); status.setAttribute('aria-label', '批量设置判断状态');
  const importance = selectInput({ '': '批量设置重要程度', 1:'1 · 背景',2:'2 · 补充',3:'3 · 一般',4:'4 · 重要',5:'5 · 核心' }, '', value => apply('importance', value)); importance.setAttribute('aria-label', '批量设置重要程度');
  bar.replaceChildren(count, status, importance, button('删除所选', () => {
    const ids = [...state.multiSelected];
    mutate(graph => { removeNodes(graph, ids, () => uid('edge')); state.multiSelected.clear(); state.selected = null; });
    toast(`已删除 ${ids.length} 个观点，可以撤销恢复。`);
  }, 'text-button'), button('取消选择', () => { state.multiSelected.clear(); render(); }, 'text-button'));
}
function openMultiSelect() {
  if (!state.graph) return;
  const dialog = modal('选择多个观点', '可以批量调整判断状态、重要程度，或删除。画布上也可以按住 Shift 点击多选。');
  for (const node of state.graph.nodes.filter(matches)) {
    const checkbox = el('input', { type: 'checkbox', value: node.id, checked: state.multiSelected.has(node.id) });
    dialog.body.append(el('label', { class: 'mode-choice compact-choice' }, [checkbox, el('span', {}, [el('strong', { text: node.label }), el('small', { text: `${STANCES[node.stance]} · ${STATUSES[node.status]}` })])]));
  }
  dialog.footer.append(button('全选', () => $$('input[type="checkbox"]', dialog.body).forEach(input => { input.checked = true; }), 'secondary'), button('确定选择', () => {
    state.multiSelected = new Set($$('input:checked', dialog.body).map(input => input.value)); closeModal(); render();
  }, 'primary', 'check'));
}
function renderTimeline() {
  if (!state.graph) return;
  const view = $('#timeline-view');
  view.replaceChildren(el('h2', { text: '看见判断如何形成' }), el('p', { class: 'document-lead', text: '按照关联原文的最后出现位置排列观点，展示已标注的判断状态与修正、反驳关系。这里不推断未记录的心理变化；同一观点的完整状态历史仍以原文为准。' }));
  const sessions = state.graph.sessions || [];
  if (sessions.length) {
    const strip = el('div', { class: 'session-strip' });
    sessions.forEach((session, index) => strip.append(el('span', { class: 'small-tag', text: `${index + 1} · ${session.title || '追加对话'} · ${session.mode === 'ai' ? 'AI 结构化' : session.mode === 'demo' ? '演示数据' : '原文整理'} · ${session.messageIds?.length || 0} 段原文` })));
    view.append(strip);
  }
  const events = timelineEvents(state.graph).filter(event => matches(event.node) || (event.target && matches(event.target)));
  for (const event of events) {
    const status = event.kind === 'judgment' ? STATUSES[event.node.status] : RELATIONS[event.kind];
    const card = el('article', { class: `timeline-event timeline-${event.kind === 'judgment' ? event.node.status : event.kind}` });
    card.append(el('div', { class: 'timeline-meta' }, [el('span', { class: 'small-tag', text: status || '待确认' }), el('span', { text: event.order >= 0 ? `截至原文 ${String(event.order + 1).padStart(2, '0')}` : '尚无原文定位' }), el('span', { text: STANCES[event.node.stance] })]));
    if (event.kind === 'judgment') {
      card.append(button(event.node.label, () => selectNode(event.node.id), 'timeline-title'), el('p', { text: event.node.summary || '尚未补充观点说明。' }));
    } else {
      card.append(el('div', { class: 'timeline-relation' }, [button(event.node.label, () => selectNode(event.node.id), 'timeline-title'), el('span', { text: `→ ${RELATIONS[event.kind]} →` }), button(event.target.label, () => selectNode(event.target.id), 'timeline-title')]), el('p', { text: event.edge.label || '这条关系来自当前图谱，可以在观点详情中核对与修改。' }));
    }
    const links = el('div', { class: 'message-node-links' });
    for (const id of event.sourceIds) {
      const index = state.graph.messages.findIndex(message => message.id === id);
      if (index >= 0) links.append(button(`原文 ${String(index + 1).padStart(2, '0')} · ${ROLE_NAMES[state.graph.messages[index].role] || '未知'}`, () => showSource(id), '', 'quote'));
    }
    card.append(links); view.append(card);
  }
  if (!events.length) view.append(el('p', { class: 'empty-note', text: '当前没有匹配的观点。导入对话或调整筛选后，可以在这里查看思考轨迹。' }));
}
function renderInspector() {
  const panel = $('#inspector'); panel.hidden = !state.inspectorOpen;
  if (!state.graph || !state.inspectorOpen) return;
  const node = selectedNode();
  const close = button('', () => { state.inspectorOpen = false; panel.hidden = true; }, 'icon-button', 'close'); close.setAttribute('aria-label', '关闭详情');
  const header = el('div', { class: 'inspector-header' }, [el('h2', {}, [icon(node ? 'panel' : 'nodes'), el('span', { text: node ? '观点详情' : '图谱概览' })]), close]);
  panel.replaceChildren(header);
  if (!node) {
    const body = el('div', { class: 'inspector-placeholder' }, [el('div', { class: 'placeholder-graphic' }, [el('span'), el('span'), el('span')]), el('h3', { text: '每个观点，都有来处' }), el('p', { text: '点击图谱中的任一节点，查看它由谁提出、如何形成，以及对应的对话原文。' })]);
    const stats = el('div', { class: 'overview-stat' });
    for (const [number, title] of [[state.graph.nodes.filter(item => item.type === 'claim').length, '核心观点'], [state.graph.messages.length, '段对话原文'], [state.graph.nodes.filter(item => item.status === 'open').length, '待解的问题'], [state.graph.edges.filter(item => item.type !== 'contains').length, '语义关系']]) stats.append(el('div', {}, [el('strong', { text: number }), el('span', { text: title })]));
    body.append(stats, el('p', { class: 'mode-note', text: modeExplanation(state.graph) }), button('添加观点之间的关系', () => openRelation(), 'secondary compact', 'link'), button('发现跨对话关联', openRelationSuggestions, 'secondary compact', 'sparkles'));
    panel.append(body); return;
  }
  const body = el('div', { class: 'inspector-content' });
  body.append(el('div', { class: 'inspector-kicker', text: 'FOLLOW THE THOUGHT' }), el('h3', { class: 'inspector-node-title', text: node.label }), el('div', { class: 'inspector-tags' }, [el('span', { class: 'small-tag', text: STANCES[node.stance] || '尚未归属' }), el('span', { class: 'small-tag neutral', text: STATUSES[node.status] || '待确认' })]));
  body.append(field('观点名称', el('input', { value: node.label, maxlength: 500, onchange: event => editNode('label', event.target.value), 'aria-label': '编辑观点名称' })));
  body.append(field('观点说明', el('textarea', { value: node.summary || '', rows: 3, onchange: event => editNode('summary', event.target.value), placeholder: '补充观点的完整含义…', 'aria-label': '编辑观点说明' })));
  body.append(el('div', { class: 'field-row' }, [field('节点类型', selectInput(TYPES, node.type, value => editNode('type', value))), field('观点归属', selectInput(STANCES, node.stance, value => editNode('stance', value)))]));
  body.append(field('判断状态', selectInput(STATUSES, node.status, value => editNode('status', value))));
  body.append(field('重要程度', selectInput({1:'1 · 背景信息',2:'2 · 次要补充',3:'3 · 一般观点',4:'4 · 重要观点',5:'5 · 核心判断'}, String(node.importance || 3), value => editNode('importance', Number(value)))));
  body.append(hierarchyControls(node));
  const sources = (node.sourceIds || []).map(id => state.graph.messages.find(message => message.id === id)).filter(Boolean);
  const sourceSection = el('div', { class: 'inspector-section' }, [el('h4', { class: 'section-title' }, [el('span', {}, [icon('quote'), el('span', { text: '来自对话的依据' })]), el('small', { text: `${sources.length} 处关联` })])]);
  sources.forEach(message => sourceSection.append(sourceExcerpt(message)));
  if (!sources.length) sourceSection.append(el('p', { class: 'empty-note', text: '这个节点尚未关联对话原文。手动新增的观点不会被标记为原文结论。' }));
  sourceSection.append(button('调整原文关联', () => openSourcePicker(node), 'text-button', 'link'));
  body.append(sourceSection);
  const relations = state.graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
  const relationSection = el('div', { class: 'inspector-section' }, [el('h4', { class: 'section-title' }, [el('span', {}, [icon('nodes'), el('span', { text: '观点之间的关系' })]), el('small', { text: `${relations.length} 条` })])]);
  relations.forEach(edge => {
    const source = state.graph.nodes.find(item => item.id === edge.source), target = state.graph.nodes.find(item => item.id === edge.target);
    if (!source || !target) return;
    const card = el('div', { class: 'relation-card' }, [el('div', { class: 'relation-names' }, [el('span', { text: source.label, title: source.label }), icon('arrowRight'), el('span', { text: target.label, title: target.label })])]);
    const type = selectInput(RELATIONS, edge.type, value => mutate(graph => { graph.edges.find(item => item.id === edge.id).type = value; })); type.setAttribute('aria-label', '修改关系类型');
    const label = el('input', { value: edge.label || '', placeholder: '关系说明', 'aria-label': '关系说明', onchange: event => mutate(graph => { graph.edges.find(item => item.id === edge.id).label = event.target.value; }) });
    const remove = button('', () => mutate(graph => { graph.edges = graph.edges.filter(item => item.id !== edge.id); }), 'icon-button', 'close'); remove.setAttribute('aria-label', '删除关系');
    card.append(el('div', { class: 'relation-controls' }, [type, label, remove])); relationSection.append(card);
  });
  relationSection.append(button('添加一条关系', () => openRelation(), 'text-button', 'plus')); body.append(relationSection);
  body.append(field('我的补充笔记', el('textarea', { value: node.note || '', rows: 2, placeholder: '留下下一次思考的起点…', onchange: event => editNode('note', event.target.value), 'aria-label': '我的补充笔记' })));
  body.append(el('div', { class: 'inspector-actions' }, [button('添加子观点', () => addNode(node.id), 'secondary', 'plus'), button('删除', () => removeNode(node.id), 'danger-button', 'trash')]));
  panel.append(body);
}
function renderOutline() {
  const view = $('#outline-view'); if (!state.graph) return;
  view.replaceChildren(el('h2', { text: state.graph.title }), el('p', { class: 'document-lead', text: `${graphMode(state.graph)} · 点击任一观点进行编辑和原文追溯。${state.graph.description ? '\n' + state.graph.description : ''}` }));
  // The outline remains complete: branch collapse only changes the canvas.
  const matching = new Set(state.graph.nodes.filter(matches).map(node => node.id));
  const seen = new Set();
  const renderItem = node => {
    if (seen.has(node.id)) return null; seen.add(node.id);
    const childItems = state.graph.nodes.filter(item => item.parentId === node.id).map(renderItem).filter(Boolean);
    if (!matching.has(node.id) && !childItems.length) return null;
    const wrap = el('div', { class: 'outline-item' });
    if (matching.has(node.id)) {
      const card = el('div', { class: `outline-card${node.id === state.selected ? ' selected' : ''}${state.multiSelected.has(node.id) ? ' multi-selected' : ''}`, dataset: { node: node.id }, role: 'button', tabIndex: 0, onclick: event => selectNode(node.id, event.shiftKey || event.metaKey || event.ctrlKey), onkeydown: event => { if (event.key === 'Enter') selectNode(node.id, event.shiftKey || event.metaKey || event.ctrlKey); } }, [el('h3', {}, [icon(TYPE_ICONS[node.type] || 'flag'), el('span', { text: node.label })]), el('p', { text: node.summary || '' }), el('div', { class: 'outline-meta', text: `${TYPES[node.type] || '观点'} · ${STANCES[node.stance] || '尚未归属'} · ${STATUSES[node.status] || '待确认'} · ${node.sourceIds?.length || 0} 处原文` })]); wrap.append(card);
    }
    if (childItems.length) wrap.append(el('div', { class: 'outline-children' }, childItems)); return wrap;
  };
  const byId = new Set(state.graph.nodes.map(node => node.id));
  const roots = state.graph.nodes.filter(node => !node.parentId || !byId.has(node.parentId));
  for (const node of [...roots, ...state.graph.nodes]) { const item = renderItem(node); if (item) view.append(item); }
  if (!matching.size) view.append(el('p', { class: 'empty-note', text: '没有匹配的观点。清除搜索或筛选后再试。' }));
}
function renderSources() {
  if (!state.graph) return;
  const view = $('#source-view');
  view.replaceChildren(el('h2', { text: '思考从这里开始' }), el('p', { class: 'document-lead', text: `${state.graph.messages.length} 段对话 · 按导入顺序保留原文。${state.graph.source?.complete === 'provided' ? '范围以本次提供的内容为准。' : '对话完整性尚未确认。'}来源链接仅作为出处保存。` }));
  let count = 0;
  state.graph.messages.forEach((message, index) => {
    if (state.query && !message.content.toLocaleLowerCase().includes(state.query.toLocaleLowerCase())) return;
    count++;
    const links = state.graph.nodes.filter(node => node.sourceIds?.includes(message.id));
    const section = el('article', { class: 'source-message', dataset: { message: message.id } }, [el('div', { class: `message-avatar ${message.role === 'assistant' ? 'assistant' : ''}`, text: message.role === 'assistant' ? 'AI' : message.role === 'user' ? '我' : '?' }), el('div', { class: 'message-meta' }, [el('span', { text: ROLE_NAMES[message.role] || '未标注' }), el('small', { text: `对话 ${String(index + 1).padStart(2, '0')}` }), el('small', { text: `${links.length} 个关联观点` })]), el('div', { class: 'message-body', text: message.content })]);
    if (links.length) section.append(el('div', { class: 'message-node-links' }, links.map(node => button(node.label, () => selectNode(node.id), '', 'link'))));
    view.append(section);
  });
  if (!count) view.append(el('p', { class: 'empty-note', text: state.query ? '没有找到包含这个关键词的原文。' : '此图谱还没有对话原文。' }));
}
function showSource(id) { state.query = ''; $('#search').value = ''; setView('source'); const message = $$('.source-message').find(node => node.dataset.message === id); if (message) { message.classList.add('message-highlight'); message.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
function setView(view) {
  const previous = state.view; state.view = view;
  $$('.view-tab').forEach(tab => { tab.classList.toggle('active', tab.dataset.view === view); tab.setAttribute('aria-selected', String(tab.dataset.view === view)); });
  $('#canvas').hidden = view !== 'graph'; $('#outline-view').hidden = view !== 'outline';
  $('#source-view').hidden = view !== 'source'; $('#timeline-view').hidden = view !== 'timeline';
  $('#search').placeholder = view === 'source' ? '搜索原文' : '搜索观点';
  if (view === 'outline') renderOutline();
  if (view === 'source') renderSources();
  if (view === 'timeline') renderTimeline();
  if (view === 'graph') { renderGraph(); if (previous !== 'graph') requestAnimationFrame(fitCanvas); }
}


function renderHeader() {
  if (!state.graph) return;
  const graph = state.graph;
  document.title = `${graph.title} · ChatGraph`;
  $('#graph-title').textContent = graph.title;
  $('#crumb-title').textContent = graph.title;
  $('#graph-description').textContent = graph.description || '将思考的结论、依据与未解问题，连接成可以继续使用的知识。';
  $('#mode-badge').textContent = graphMode(graph); $('#mode-badge').className = `meta-pill ${graph.mode === 'ai' ? 'ai' : graph.mode === 'outline' ? 'outline' : ''}`;
  $('#source-badge').textContent = graph.sessions?.length > 1 ? [...new Set(graph.sessions.map(session => session.source?.platform).filter(Boolean))].join(' / ') : graph.source?.platform || '手动导入';
  $('#node-count').textContent = `${graph.nodes.length} 个思考节点`;
  $('#source-count').textContent = `${graph.messages.length} 段原文`;
  $('#save-state').textContent = state.saving ? '保存中…' : state.dirty ? state.conflictIds.has(graph.id) ? '版本冲突 · 草稿已保留' : state.autoSavePaused ? '草稿 · 自动保存已暂停' : state.drafts.get(graph.id)?.saveFailed ? '草稿已保留 · 保存失败' : '草稿已保留 · 即将自动保存' : state.saved ? state.config.hosted ? '已保存到工作空间' : '已保存到本地' : graph.mode === 'demo' ? '示例 · 尚未保存' : '草稿 · 尚未保存';
  $('#save-state').classList.toggle('dirty', state.dirty || !state.saved);
  $('#provenance-hint').textContent = graph.sessions?.length > 1 ? '每次对话独立保留来源 · 在思考轨迹中核对归属与变化' : graph.mode === 'outline' ? '原文整理模式，未调用 AI · 判断状态由你确认' : graph.mode === 'demo' ? '演示数据 · 每条观点均可回到对应原文' : 'AI 结果待确认 · 对话内依据不等于外部事实核查';
  $$('[data-action="save"]').forEach(node => { node.disabled = state.saving; });
  $$('[data-action="undo"]').forEach(node => { node.disabled = !state.history.length; });
  $$('[data-action="redo"]').forEach(node => { node.disabled = !state.redoHistory.length; });
}
function renderLibrary() {
  renderPendingImports();
  const recover = $('#recover-drafts'), foreignCount = state.foreignDrafts.length + state.foreignImports.length; recover.hidden = !foreignCount; recover.textContent = `找回其他窗口的内容（${foreignCount}）`;
  const items = new Map(state.library.map(graph => [graph.id, { ...graph, saved: true }]));
  for (const [id, draft] of state.drafts) { if (draft.graph.mode === 'demo' && !draft.saved && !draft.dirty) continue; items.set(id, { ...draft.graph, saved: draft.saved, dirty: draft.dirty, nodeCount: draft.graph.nodes.length }); }
  if (state.graph && (state.graph.mode !== 'demo' || state.saved || state.dirty)) items.set(state.graph.id, { ...state.graph, saved: state.saved, dirty: state.dirty, nodeCount: state.graph.nodes.length });
  $('#graph-count').textContent = String(items.size);
  const list = $('#library-list'); list.replaceChildren();
  if (!items.size) { list.append(el('div', { class: 'library-empty', text: '保存第一张图谱，\n让思考在这里积累。' })); return; }
  [...items.values()].filter(graph => !state.libraryQuery || graph.title.toLocaleLowerCase().includes(state.libraryQuery.toLocaleLowerCase())).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).forEach(graph => {
    const link = button('', () => switchGraph(graph.id), 'library-link', 'document');
    link.lastChild.replaceChildren(el('span', { class: 'library-name', text: graph.title, title: graph.title }), el('small', { text: `${graph.nodeCount || 0} 个节点 · ${graph.recoveryRequired ? '需要恢复' : graph.dirty ? '有修改' : graph.saved ? '已保存' : '未保存草稿'}` }));
    const item = el('div', { class: `library-entry${state.graph?.id === graph.id ? ' selected' : ''}` }, [link]);
    if (graph.saved) { const remove = button('', () => confirmDelete(graph), 'library-remove', 'trash'); remove.setAttribute('aria-label', `删除图谱 ${graph.title}`); item.append(remove); }
    list.append(item);
  });
}
function render() { renderHeader(); renderGraph(); if (state.view === 'outline') renderOutline(); if (state.view === 'source') renderSources(); if (state.view === 'timeline') renderTimeline(); renderInspector(); renderLibrary(); renderBatchBar(); }
function setGraph(graph, options = {}) {
  remember();
  state.graph = clone(graph); state.selected = options.selected ?? null; state.dirty = options.dirty || false; state.saved = options.saved || false; state.autoSavePaused = options.autoSavePaused || false; state.saving = saveInFlight.has(graph.id); state.history = options.history || []; state.redoHistory = options.redoHistory || []; state.multiSelected.clear(); state.camera = options.camera || { x: 0, y: 0, scale: 1 };
  state.collapsed = new Set(); state.forceTreeLayout = false;
  state.query = ''; state.filterType = 'all'; state.filterStatus = 'all'; $('#search').value = ''; $('#filter-type').value = 'all'; $('#filter-status').value = 'all';
  render(); if (!options.camera) requestAnimationFrame(fitCanvas); remember(); if (state.dirty && !state.autoSavePaused) scheduleSave(); $('#sidebar').classList.remove('open');
}
async function switchGraph(id) {
  if (state.graph?.id === id) return;
  const summary = state.library.find(graph => graph.id === id);
  if (summary?.recoveryRequired) return openDamagedGraph(summary);
  try { const draft = state.drafts.get(id); if (draft) setGraph(draft.graph, draft); else setGraph(await request(`/api/graphs/${encodeURIComponent(id)}`), { saved: true }); }
  catch (error) { toast(error.message, true); }
}
async function openDamagedGraph(summary) {
  const dialog = modal('从历史版本找回图谱', '当前保存文件无法读取，可以恢复一个可用的历史版本。');
  dialog.body.append(el('p', { class: 'notice', text: `「${summary.title}」的当前文件无法读取。恢复时会保留损坏文件以便后续检查，并写入一个新的可用版本。` }));
  dialog.footer.append(button('关闭', closeModal, 'secondary'));
  try {
    const versions = await request(`/api/graphs/${encodeURIComponent(summary.id)}/history`);
    if (!versions.length) dialog.body.append(el('p', { class: 'empty-note', text: '尚未找到可用历史版本。可以尝试从知识库备份中恢复。' }));
    for (const version of versions) {
      const restore = button('恢复此版本', async () => {
        restore.disabled = true;
        try {
          const graph = await request(`/api/graphs/${encodeURIComponent(summary.id)}/restore`, { method: 'POST', body: JSON.stringify({ version: version.version, expectedRevision: null }) });
          state.library = await request('/api/graphs'); setGraph(graph, { saved: true }); closeModal(); toast('已找回图谱，原损坏文件已保留。');
        } catch (error) { formError(dialog.body, error.message); restore.disabled = false; }
      }, 'secondary compact', 'clock');
      dialog.body.append(el('div', { class: 'history-entry' }, [el('div', {}, [el('strong', { text: version.title }), el('p', { text: `${new Date(version.createdAt).toLocaleString('zh-CN')} · ${version.nodeCount} 个观点` })]), restore]));
    }
  } catch (error) { formError(dialog.body, error.message); }
}
async function openForeignDrafts() {
  const dialog = modal('找回其他窗口的内容', '图谱编辑恢复为副本；未完成的整理可接着处理原任务，不会自动新建模型任务。');
  dialog.body.append(el('p', { class: 'notice', text: '这里也可能包含仍在其他窗口编辑的内容。请根据保存时间选择需要找回的一份。' }));
  dialog.footer.append(button('关闭', closeModal, 'secondary'));
  try {
    const records = await draftStore.all();
    state.foreignDrafts = records.filter(draft => draft.dirty && draft.graph?.id && !draftStore.owns(draft));
    state.foreignImports = foreignImportReceipts(records);
    renderLibrary();
    for (const operation of state.foreignImports) {
      const resume = button('接着整理', async () => {
        resume.disabled = true;
        try {
          // Re-read immediately before adoption: a still-open window may have
          // admitted a paid job since this list was first displayed.
          const latestRecords = await draftStore.all();
          const latest = draftStore.recoverableImports(latestRecords, { includeForeign: true }).find(item => item.operationId === operation.operationId);
          if (!latest) throw new Error('这次整理已经完成或移除，请重新打开列表。');
          const sources = latestRecords.filter(item => item.kind === 'pending-import' && item.operationId === latest.operationId);
          const recoveredFrom = [...(latest.recoveredFrom || []), ...sources.filter(item => !draftStore.owns(item)).map(item => ({ id: item.id, updatedAt: item.updatedAt, jobId: item.jobId || null }))];
          const adopted = { ...latest, recoveredFrom };
          // Persist the adopted receipt before leaving the recovery list. The
          // original owner remains recoverable until the graph is safely saved.
          await retainImport(adopted);
          state.foreignImports = state.foreignImports.filter(item => item.operationId !== adopted.operationId); renderLibrary();
          openImport({ resume: adopted, autoResume: true });
        } catch (error) { formError(dialog.body, error.message); resume.disabled = false; }
      }, 'secondary compact', 'clock');
      dialog.body.append(el('article', { class: 'history-entry' }, [el('div', {}, [el('strong', { text: operation.input.title || '未命名的整理' }), el('p', { text: `${new Date(operation.updatedAt).toLocaleString('zh-CN')} · ${operation.jobId ? '原任务与原文已保留' : '尚未提交的原文草稿'}` })]), resume]));
    }
    for (const draft of [...state.foreignDrafts].sort((a, b) => b.recoveredAt - a.recoveredAt)) {
      const recover = button('打开为副本', async () => {
        recover.disabled = true;
        try {
          const graph = { ...clone(draft.graph), id: uid('graph'), revision: 0, title: `${draft.graph.title} · 恢复草稿` };
          setGraph(graph, { dirty: true }); await save();
          if (state.dirty) throw new Error('恢复副本尚未保存成功，原窗口的草稿仍然保留。');
          closeModal(); toast('已将这份草稿恢复为独立副本。原窗口草稿继续保留。');
        } catch (error) { formError(dialog.body, error.message); recover.disabled = false; }
      }, 'secondary compact', 'document');
      dialog.body.append(el('article', { class: 'history-entry' }, [el('div', {}, [el('strong', { text: draft.graph.title }), el('p', { text: `${new Date(draft.recoveredAt).toLocaleString('zh-CN')} · ${draft.graph.nodes.length} 个观点` })]), recover]));
    }
    if (!state.foreignDrafts.length && !state.foreignImports.length) dialog.body.append(el('p', { class: 'empty-note', text: '其他窗口的草稿已经保存，目前没有需要找回的内容。' }));
  } catch (error) { formError(dialog.body, error.message); }
}
async function openDemo() { try { const graph = state.demo || await request('/api/demo'); state.demo = graph; const draft = state.drafts.get(graph.id); if (state.graph?.id === graph.id) { toast('你正在查看示例图谱'); $('#sidebar').classList.remove('open'); return; } setGraph(draft?.graph || graph, draft || { selected: graph.nodes.find(node => node.type === 'claim' && node.status === 'confirmed')?.id || null }); } catch (error) { toast(error.message, true); } }
async function save() {
  if (!state.graph) return;
  document.activeElement?.blur(); state.autoSavePaused = false; remember();
  if (state.conflictIds.has(state.graph.id)) return openSaveConflict(state.graph.id);
  return saveGraphId(state.graph.id);
}
async function saveGraphId(id, { silent = false } = {}) {
  if (deletingGraphs.has(id)) return;
  if (saveInFlight.has(id)) return saveInFlight.get(id);
  const draft = state.drafts.get(id); if (!draft) return;
  const payload = clone(draft.graph);
  const saving = (async () => {
    if (state.graph?.id === id) { state.saving = true; renderHeader(); }
    try {
      const saved = await request('/api/graphs', { method: 'POST', body: JSON.stringify(payload) });
      const latest = state.drafts.get(id);
      const changedDuringSave = latest && JSON.stringify(latest.graph) !== JSON.stringify(payload);
      if (latest) {
        latest.graph = changedDuringSave ? { ...latest.graph, revision: saved.revision, schemaVersion: saved.schemaVersion } : saved;
        latest.saved = true; latest.dirty = Boolean(changedDuringSave); latest.saveFailed = false;
        if (state.graph?.id === id) { state.graph = clone(latest.graph); state.saved = true; state.dirty = latest.dirty; }
        if (latest.dirty) { persistDraft(latest); scheduleSave(); }
        else {
          await draftStore.remove(id).catch(() => {});
          for (const operation of [...state.pendingImports]) if (operation.resultGraphId === id) await clearImport(operation).catch(() => {});
        }
      }
      state.conflictIds.delete(id);
      state.library = await request('/api/graphs');
      if (!silent) toast(state.config.hosted ? '已保存到在线知识库' : '已保存到本地知识库');
    } catch (error) {
      if (error.status === 409) {
        state.conflictIds.add(id);
        toast('此图谱已有较新的保存版本。草稿已保留，点击保存处理冲突。', true);
      } else {
        const current = state.drafts.get(id);
        if (current) { current.saveFailed = true; persistDraft(current); }
        toast(`自动保存未完成，草稿保留在浏览器中。${error.message}`, true);
      }
    } finally {
      saveInFlight.delete(id);
      if (state.graph?.id === id) state.saving = false;
      renderHeader(); renderLibrary();
    }
  })();
  saveInFlight.set(id, saving);
  return saving;
}
async function openSaveConflict(id) {
  const draft = state.drafts.get(id); if (!draft) return;
  const dialog = modal('保留哪一份修改', '另一个页面或恢复操作已保存了更新的版本。你的草稿仍然完整保留。');
  dialog.body.append(el('p', { class: 'notice', text: `「${draft.graph.title}」有版本冲突。另存副本会同时保留两份；载入已保存版本会放弃当前草稿中的修改。` }));
  dialog.footer.append(button('稍后处理', closeModal, 'secondary'), button('载入已保存版本', async () => {
    try {
      const graph = await request(`/api/graphs/${encodeURIComponent(id)}`);
      state.conflictIds.delete(id); state.drafts.delete(id); await draftStore.remove(id);
      if (state.graph?.id === id) { state.graph = null; setGraph(graph, { saved: true }); }
      closeModal();
    } catch (error) { formError(dialog.body, error.message); }
  }, 'secondary'), button('将草稿另存为副本', async () => {
    const graph = { ...clone(draft.graph), id: uid('graph'), revision: 0, title: `${draft.graph.title} · 草稿副本` };
    for (const operation of state.pendingImports.filter(item => item.resultGraphId === id)) {
      operation.resultGraphId = graph.id; await retainImport(operation);
    }
    state.conflictIds.delete(id); state.drafts.delete(id); await draftStore.remove(id).catch(() => {});
    if (state.graph?.id === id) state.graph = null;
    setGraph(graph, { dirty: true }); closeModal(); await save();
  }, 'primary', 'document'));
}

async function exportGraph(format) {
  $('#export-menu').hidden = true;
  if (!state.graph) return;
  try {
    const response = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph: state.graph, format }) });
    if (response.status === 401) showSessionExpired();
    if (!response.ok) { let error; try { error = await response.json(); } catch { error = {}; } throw new Error(error.error || `导出失败（${response.status}）`); }
    const blob = await response.blob(), url = URL.createObjectURL(blob);
    const ext = { markdown: 'md', json: 'json', html: 'html', svg: 'svg', pptx: 'pptx' }[format];
    const anchor = el('a', { href: url, download: `${state.graph.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100)}.${ext}` }); document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(format === 'html' ? '已导出交互页面，可以将 HTML 文件分享给他人' : '导出完成，文件已开始下载');
  } catch (error) { toast(error.message, true); }
}
function addNode(parentId) {
  if (!state.graph) return;
  const parent = state.graph.nodes.find(node => node.id === (parentId || state.selected)) || state.graph.nodes.find(node => node.type === 'topic');
  const id = uid('node');
  mutate(graph => {
    if (parent) state.collapsed.delete(parent.id);
    graph.nodes.push({ id, label: '新的思考', summary: '', type: 'claim', stance: 'user', status: 'proposed', importance: 3, sourceIds: [], parentId: parent?.id || null, note: '', x: parent ? parent.x + 345 : 60, y: parent ? parent.y + 155 * (graph.nodes.filter(node => node.parentId === parent.id).length % 4) : 60 });
    if (parent) graph.edges.push({ id: uid('edge'), source: parent.id, target: id, type: 'contains', label: '' });
    state.selected = id; state.inspectorOpen = true;
  });
  requestAnimationFrame(() => { const input = $('[aria-label="编辑观点名称"]'); input?.focus(); input?.select(); });
  toast('已添加观点，可以在右侧编辑');
}
function removeNode(id) {
  const node = state.graph.nodes.find(item => item.id === id); if (!node) return;
  mutate(graph => { removeNodes(graph, [id], () => uid('edge')); state.selected = null; state.multiSelected.delete(id); });
  toast('已删除该观点，子观点保留。可点击撤销恢复。');
}

function closeModal() { if (state.importing) return; modalCleanup?.(); modalCleanup = null; $('#modal-root').replaceChildren(); modalRestoreFocus?.focus?.(); }
function modal(title, subtitle, options = {}) {
  modalCleanup?.(); modalCleanup = options.onClose || null;
  modalRestoreFocus = document.activeElement;
  const backdrop = el('div', { class: 'modal-backdrop' });
  const container = el('section', { class: `modal${options.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', tabIndex: -1 });
  const close = button('', closeModal, 'icon-button', 'close'); close.setAttribute('aria-label', '关闭对话框');
  const header = el('div', { class: 'modal-header' }, [el('div', {}, [el('h2', { id: 'modal-title', text: title }), subtitle ? el('p', { text: subtitle }) : null]), close]);
  const body = el('div', { class: 'modal-body' }), footer = el('div', { class: 'modal-footer' }); container.append(header, body, footer); backdrop.append(container);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(); });
  container.addEventListener('keydown', event => { if (event.key !== 'Tab') return; const focusables = $$('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]', container).filter(node => !node.hidden && node.offsetParent !== null); if (!focusables.length) return; const first = focusables[0], last = focusables.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } });
  // Focus after insertion, before returning control to the user. A deferred
  // autofocus callback can steal focus from text the user has already selected.
  $('#modal-root').replaceChildren(backdrop); container.focus();
  return { body, footer, container };
}
function formError(parent, message) { let error = $('.form-error', parent); if (!error) { error = el('div', { class: 'form-error', role: 'alert' }); parent.append(error); } error.textContent = message; error.scrollIntoView({ block: 'nearest' }); }
function editTitle() {
  if (!state.graph) return;
  const dialog = modal('给这次思考一个名字', '一个清楚的标题，更容易被未来的你找到。');
  const title = el('input', { value: state.graph.title, maxlength: 200, placeholder: '图谱标题' });
  const description = el('textarea', { value: state.graph.description || '', rows: 3, placeholder: '用一两句话描述这次思考…' });
  dialog.body.append(field('图谱标题', title), field('简短介绍', description));
  const submit = () => { if (!title.value.trim()) return formError(dialog.body, '请填写图谱标题。'); mutate(graph => { graph.title = title.value.trim(); graph.description = description.value.trim(); }); closeModal(); };
  dialog.footer.append(button('取消', closeModal, 'secondary'), button('保存修改', submit, 'primary', 'check')); title.addEventListener('keydown', event => { if (event.key === 'Enter') submit(); }); title.focus(); title.select();
}
function renderPendingImports() {
  const button = $('#resume-import'); if (!button) return;
  button.hidden = !state.pendingImports.length;
  button.textContent = `继续上次整理（${state.pendingImports.length}）`;
}
async function retainImport(operation) {
  const copy = clone(operation);
  await draftStore.putImport(copy);
  const index = state.pendingImports.findIndex(item => item.operationId === copy.operationId);
  if (index >= 0) state.pendingImports[index] = copy; else state.pendingImports.push(copy);
  renderPendingImports();
}
async function clearImport(operation) {
  // Called only after the graph is durably saved. Clear copies left by earlier
  // mobile processes, without touching other imports or graph-edit namespaces.
  if (operation.mobileShareId) await removeMobileShare(operation.mobileShareId, operation.mobileShareRevision).catch(() => toast('图谱已保存，收件箱原件暂未清除，可回收件箱手动删除。', true));
  await draftStore.removeImport(operation.operationId, operation.mobileShareId, operation.recoveredFrom);
  state.pendingImports = state.pendingImports.filter(item => item.operationId !== operation.operationId);
  renderPendingImports();
}
function foreignImportReceipts(records) {
  return draftStore.recoverableImports(records, { includeForeign: true }).filter(operation => !draftStore.owns(operation) && !operation.mobileShareId && !state.pendingImports.some(item => item.operationId === operation.operationId));
}
function openPendingImports() {
  if (!state.pendingImports.length) return toast('没有需要继续的整理。');
  if (state.pendingImports.length === 1) return openImport({ resume: state.pendingImports[0] });
  const dialog = modal('继续上次整理', '原文草稿与任务编号已保留。进行中的任务会继续读取，不会重复调用模型。');
  for (const operation of [...state.pendingImports].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    const phase = { draft: '原文草稿', submitting: '确认任务状态', running: '正在整理', completed: '结果待保存', failed: '等待重试', cancelled: '已停止，原文保留', unknown: '确认任务状态' }[operation.phase] || '可以继续';
    dialog.body.append(el('article', { class: 'history-entry' }, [el('div', {}, [el('strong', { text: operation.input.title || '未命名的对话' }), el('p', { text: `${phase} · ${operation.input.platform || '手动导入'}` })]), button('继续', () => openImport({ resume: operation }), 'secondary compact', 'clock')]));
  }
  dialog.footer.append(button('关闭', closeModal, 'secondary'));
}
function openImport(options = {}) {
  const resumed = options.resume ? clone(options.resume) : null;
  const append = resumed ? Boolean(resumed.targetGraphId) : options.append === true;
  if (append && !state.graph) return;
  const captured = options.capture;
  const mobile = options.mobile;
  let localSource = null, localCatalog = null, localPreview = null, roleOverrides = {}, conversationIndex, catalogQuery = '', selecting = false;
  let importCapture = captured?.capture || resumed?.input.capture;
  let autoFilledTitle = '', sourceUrlEdited = Boolean(mobile?.url || resumed?.input.url);
  const operation = resumed || { operationId: crypto.randomUUID(), mobileShareId: mobile?.id || null, mobileShareRevision: mobile?.revision || 1, targetGraphId: append ? state.graph.id : null, input: {}, jobId: null, phase: 'draft', updatedAt: Date.now() };
  const dialog = modal(append ? '继续这次思考' : '让这段对话，留下来', append ? '补充一段对话，保留已有观点与来源。' : '导入真实对话，整理你的判断、依据和下一步。', { wide: true, onClose: () => { localSource = localCatalog = localPreview = null; roleOverrides = {}; } });
  const title = el('input', { value: resumed?.input.title || captured?.title || mobile?.title || '', placeholder: append ? '例如：第二轮用户访谈后的反思' : '例如：我的 AI 产品方向探索', maxlength: 200 });
  const platform = selectInput({ ChatGPT: 'ChatGPT', DeepSeek: 'DeepSeek', Claude: 'Claude', Gemini: 'Gemini', 其他: '其他 / 手动输入' }, resumed?.input.platform || captured?.platform || 'ChatGPT', () => {});
  const url = el('input', { type: 'url', value: resumed?.input.url || captured?.url || mobile?.url || '', placeholder: 'https://…（可选，仅记录出处）' });
  const text = el('textarea', { value: resumed?.input.text || (captured ? JSON.stringify({ messages: captured.messages }, null, 2) : ''), placeholder: '我：我想做一个能保留 AI 对话思考过程的工具。\nAI：可以先尝试面向研究者和产品经理。\n我：我更倾向于先验证独立开发者，范围更小。', rows: 9, spellcheck: false, 'aria-label': '对话内容' });
  const modes = el('div', { class: 'import-modes' });
  const defaultMode = resumed?.input.mode || (state.config.aiConfigured || state.api.apiKey ? 'ai' : 'outline');
  for (const [value, label, help] of [['outline', '原文整理', '按原文组织，不推断个人立场。'], ['ai', 'AI 深度结构化', '提取判断、变化与依据，使用已配置模型。']]) modes.append(el('label', { class: 'mode-choice' }, [el('input', { type: 'radio', name: 'import-mode', value, checked: value === defaultMode }), el('span', {}, [el('strong', { text: label }), el('small', { text: help })])]));
  const file = el('input', { type: 'file', accept: '.txt,.md,.json,text/plain,text/markdown,application/json', 'aria-label': '选择对话文件或 ChatGPT 账号导出' });
  const fileInfo = el('small', { text: '账号导出请先解压并选择 conversations.json · 本地文件最多 25 MB，选定对话最多 2 MB，图谱最多 8 MB' });
  const previewPanel = el('section', { class: 'import-selection', hidden: true, 'aria-label': '导入内容预览' });
  const prepare = button('检查导入内容', () => prepareImport(text.value), 'secondary compact', 'search');
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]; if (!selected) return;
    if (selected.size > 25 * 1024 * 1024) return formError(dialog.body, '文件超过 25 MB，请选择较小的导出文件。');
    const startedAt = formRevision;
    submit.disabled = true;
    try {
      const content = await selected.text();
      if (!dialog.container.isConnected) return;
      if (formRevision !== startedAt) return formError(dialog.body, '读取文件期间你修改了原文，已保留当前输入。需要替换时请重新选择文件。');
      fileInfo.textContent = selected.name; prepareImport(content);
    }
    catch { formError(dialog.body, '无法读取文件，请尝试复制内容后粘贴。'); }
    finally { file.value = ''; if (dialog.container.isConnected) submit.disabled = selecting || state.importing; }
  });
  dialog.body.append(modes);
  if (mobile) dialog.body.append(el('p', { class: 'notice mobile-import-notice', text: mobile.kind === 'link' ? '这次分享只有链接，没有对话原文。链接已记为出处，请粘贴原文或选择导出文件后再整理。' : '来自手机收件箱。请确认说话者和消息范围；点击“开始整理”后才发送选定内容。收件箱原件在此浏览器临时保留，成功整理后删除。' }));
  if (append && (state.graph.mode === 'demo' || state.graph.sessions?.some(session => session.mode === 'demo'))) dialog.body.append(el('p', { class: 'notice', text: '当前图谱包含演示数据。追加后这些示例观点会继续保留；也可以关闭此窗口，用“整理新的对话”建立独立图谱。' }));
  if (captured) dialog.body.append(el('p', { class: 'notice capture-notice', text: `来自浏览器的 ${captured.messages.length} 段对话。捕获范围是当前页面已加载的分支，完整性尚未确认，请先检查原文。${(captured.capture?.warnings || []).join(' ')}` }));
  dialog.body.append(field('这次思考的标题', title), field('对话内容', text), el('div', { class: 'upload-row' }, [el('label', { class: 'file-label' }, [icon('upload'), el('span', { text: '选择对话文件' }), file]), prepare, fileInfo]), previewPanel, el('div', { class: 'field-row' }, [field('对话来自', platform), field('原始对话链接', url)]), el('p', { class: 'modal-note', text: '可在本机打开 ChatGPT 账号导出，选择一个会话及连续范围，再开始整理。账号导出原文件仅临时保留在当前窗口；只有应用后的选定内容会保存为草稿，并在开始整理后发给服务端。AI 模式会将选定对话发送至配置的模型服务。' }));
  const progress = el('div', { class: 'import-progress', hidden: true, role: 'status' });
  const progressText = el('p', { text: '正在准备…' }), progressBar = el('progress', { max: 100 });
  progress.append(progressText, progressBar); dialog.body.append(progress);
  let activeJob = operation.jobId && !['failed', 'cancelled'].includes(operation.phase) ? operation.jobId : null;
  let cancelled = false, fallbackController = null, formRevision = 0;
  const readInput = () => ({ text: text.value, title: title.value.trim(), platform: platform.value, url: url.value.trim(), mode: $('input[name="import-mode"]:checked', dialog.body).value,
    ...(importCapture ? { capture: importCapture } : {}) });
  const modeLimit = () => $('input[name="import-mode"]:checked', dialog.body).value === 'ai' ? 500 : 199;
  const importBytes = input => new TextEncoder().encode(JSON.stringify(input)).byteLength;
  function withinImportLimit(input, kind) {
    if (kind !== 'graph') return importBytes(input) <= 2 * 1024 * 1024;
    // A saved graph carries authored relationships and sources, not a new AI
    // transcript. Account for pretty-printing separately from canonical size.
    return new TextEncoder().encode(JSON.stringify(JSON.parse(input.text.replace(/^\uFEFF/, '')))).byteLength <= 8 * 1024 * 1024 && importBytes(input) <= 32 * 1024 * 1024;
  }
  function safeToRetain() {
    if (selecting) return false;
    try {
      const kind = /^[\s\uFEFF]*[\[{]/.test(text.value) ? inspectConversationFile(text.value).kind : 'conversation';
      return kind !== 'archive' && withinImportLimit(readInput(), kind);
    } catch { return false; } // Incomplete pasted archives also stay out of browser storage.
  }
  function resetSelection() {
    localSource = localCatalog = localPreview = null; roleOverrides = {}; conversationIndex = undefined; catalogQuery = ''; selecting = false;
    previewPanel.hidden = true; previewPanel.replaceChildren(); text.closest('.field').hidden = false; submit.disabled = false;
  }
  function prepareImport(content) {
    if (state.importing || activeJob) return;
    $('.form-error', dialog.body)?.remove();
    try {
      const catalog = inspectConversationFile(content);
      localSource = content; localCatalog = catalog; roleOverrides = {}; conversationIndex = undefined; catalogQuery = ''; localPreview = null;
      selecting = true; submit.disabled = true;
      text.closest('.field').hidden = true;
      // Never leave the whole account archive in the persistable transcript field.
      if (catalog.kind === 'archive' && text.value === content) text.value = '';
      renderSelection();
    } catch (error) { formError(dialog.body, error.message); }
  }
  function renderSelection() {
    previewPanel.hidden = false; previewPanel.replaceChildren();
    previewPanel.append(el('h3', { text: localCatalog.kind === 'archive' ? '先选择一个会话' : '确认这次整理的内容' }), el('p', { class: 'modal-note', text: '预览在当前浏览器内完成。选择范围并确认后，再开始整理。' }));
    if (localCatalog.kind === 'archive') {
      const filter = el('input', { type: 'search', value: catalogQuery, placeholder: '输入关键词查找这次讨论', 'aria-label': '查找会话标题' });
      const catalogSelect = el('select', { 'aria-label': '选择要导入的会话' });
      const populate = () => {
        const matches = item => (item.title || `会话 ${item.index + 1}`).toLocaleLowerCase().includes(catalogQuery.trim().toLocaleLowerCase());
        const filtered = localCatalog.conversations.filter(matches);
        catalogSelect.replaceChildren(el('option', { value: '', text: `找到 ${filtered.length} / ${localCatalog.conversations.length} 个会话，请选择一个`, selected: conversationIndex === undefined }));
        for (const item of localCatalog.conversations.filter(item => matches(item) || conversationIndex === item.index)) catalogSelect.append(el('option', { value: String(item.index), text: `${item.title || `会话 ${item.index + 1}`}${item.updatedAt && Number.isFinite(Date.parse(item.updatedAt)) ? ` · ${new Date(item.updatedAt).toLocaleDateString('zh-CN')}` : ''}${!matches(item) ? '（当前已选）' : ''}`, selected: conversationIndex === item.index }));
      };
      filter.addEventListener('input', () => { catalogQuery = filter.value; populate(); }); populate();
      catalogSelect.addEventListener('change', () => { conversationIndex = catalogSelect.value === '' ? undefined : Number(catalogSelect.value); roleOverrides = {}; localPreview = null; renderSelection(); });
      previewPanel.append(field('查找会话标题', filter), field('账号中的会话', catalogSelect));
    }
    const cancelSelection = button('取消选择', () => { resetSelection(); keepForm(); }, 'secondary compact');
    if (localCatalog.kind === 'archive' && conversationIndex === undefined) { previewPanel.append(cancelSelection); return; }
    try {
      const firstPreview = !localPreview;
      localPreview = previewConversation(localSource, { conversationIndex, ...(localPreview?.kind === 'conversation' ? { from: localPreview.from, to: localPreview.to } : {}), roles: roleOverrides });
      if (firstPreview && localPreview.kind === 'conversation' && localPreview.selectedCount > modeLimit()) localPreview = previewConversation(localSource, { conversationIndex, from: localPreview.from, to: localPreview.from + modeLimit() - 1, roles: roleOverrides });
    } catch (error) {
      previewPanel.append(el('p', { class: 'form-error', role: 'alert', text: error.message }));
      if (Number.isSafeInteger(error.totalMessages) && error.totalMessages > 0) {
        const from = el('input', { type: 'number', min: 1, max: error.totalMessages, step: 1, value: 1, 'aria-label': '起始消息编号' });
        const to = el('input', { type: 'number', min: 1, max: error.totalMessages, step: 1, value: Math.min(modeLimit(), error.totalMessages), 'aria-label': '结束消息编号' });
        previewPanel.append(el('p', { class: 'modal-note', text: `会话共有 ${error.totalMessages} 条消息。可选择其他范围后重新预览。` }), el('div', { class: 'import-range' }, [field('从第几条开始', from), field('到第几条结束', to), button('更新预览', () => {
          try { localPreview = previewConversation(localSource, { conversationIndex, from: Number(from.value), to: Number(to.value), roles: roleOverrides }); renderSelection(); }
          catch (nextError) { formError(previewPanel, nextError.message); }
        }, 'secondary compact')]));
      }
      previewPanel.append(cancelSelection); return;
    }
    const preview = localPreview;
    const selectionStatus = el('p', { class: 'import-selection-status', role: 'status', text: preview.kind === 'graph' ? '已识别 ChatGraph 图谱，将保留图谱结构与原文。' : `已选择 ${preview.selectedCount} / ${preview.totalMessages} 条消息 · ${preview.unknownRoles} 条说话者未标注${preview.complete === 'partial' ? ' · 部分对话' : ''}` });
    previewPanel.append(selectionStatus);
    if (preview.kind === 'conversation') {
      const from = el('input', { type: 'number', min: 1, max: preview.totalMessages, step: 1, value: preview.from, 'aria-label': '起始消息编号' });
      const to = el('input', { type: 'number', min: 1, max: preview.totalMessages, step: 1, value: preview.to, 'aria-label': '结束消息编号' });
      const changeRange = () => {
        try {
          localPreview = previewConversation(localSource, { conversationIndex, from: Number(from.value), to: Number(to.value), roles: roleOverrides }); renderSelection();
        } catch (error) { formError(previewPanel, error.message); }
      };
      previewPanel.append(el('div', { class: 'import-range' }, [field('从第几条开始', from), field('到第几条结束', to), button('更新预览', changeRange, 'secondary compact')]), el('p', { class: 'modal-note', text: `消息编号从 1 开始，连续选择。${modeLimit() === 199 ? '原文整理每次最多 199 条；AI 深度结构化最多 500 条。' : 'AI 深度结构化每次最多 500 条。'}可在消息旁修正说话者。` }));
      from.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); changeRange(); } });
      to.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); changeRange(); } });
      for (const input of [from, to]) input.addEventListener('input', () => { apply.disabled = true; selectionStatus.textContent = '范围已修改，请先点击“更新预览”检查选定内容。'; });
      const messages = el('div', { class: 'import-message-list', 'aria-label': '选定的对话消息' });
      for (const [index, message] of preview.messages.entries()) {
        const number = preview.from + index;
        const speaker = selectInput(ROLE_NAMES, message.role, value => { roleOverrides[message.id] = value; renderSelection(); });
        speaker.setAttribute('aria-label', `第 ${number} 条消息的说话者`);
        messages.append(el('article', { class: `import-message${message.role === 'unknown' ? ' unknown-role' : ''}` }, [el('div', { class: 'import-message-meta' }, [el('strong', { text: `第 ${number} 条` }), speaker]), el('p', { text: message.content })]));
      }
      previewPanel.append(messages);
    }
    for (const warning of preview.warnings || []) previewPanel.append(el('p', { class: 'notice', text: warning }));
    const apply = button(preview.kind === 'graph' ? '使用这张图谱' : '使用选中的对话', () => {
      const nextTitle = !title.value.trim() || title.value === autoFilledTitle ? preview.title.slice(0, 200) || title.value.trim() : title.value.trim();
      const nextUrl = sourceUrlEdited ? url.value.trim() : preview.url || '';
      const payload = { ...readInput(), text: preview.text, title: nextTitle, platform: preview.platform || platform.value, url: nextUrl };
      if (!withinImportLimit(payload, preview.kind)) return formError(previewPanel, preview.kind === 'graph' ? '图谱内容超过 8 MB，请按主题拆分后导入。' : '选定内容超过 2 MB，请缩小消息范围。');
      if (preview.kind === 'conversation' && preview.selectedCount > modeLimit()) return formError(previewPanel, `当前模式每次最多整理 ${modeLimit()} 条消息，请缩小范围或切换整理模式。`);
      text.value = preview.text;
      if (preview.kind === 'graph') $('input[name="import-mode"][value="outline"]', dialog.body).checked = true;
      if (!title.value.trim() || title.value === autoFilledTitle) autoFilledTitle = nextTitle;
      title.value = nextTitle;
      if (preview.platform) platform.value = [...platform.options].some(option => option.value === preview.platform) ? preview.platform : '其他';
      url.value = nextUrl;
      importCapture = preview.kind === 'conversation' ? { ...(importCapture || {}), complete: preview.complete, warnings: preview.warnings || [] } : undefined;
      const summary = preview.kind === 'graph' ? '已选定图谱' : `已选定 ${preview.selectedCount} 条消息${preview.complete === 'partial' ? '（部分对话）' : ''}`;
      resetSelection(); fileInfo.textContent = `${summary} · 可再次检查或调整`; keepForm(); text.focus();
    }, 'primary compact', 'check');
    selectionStatus.after(el('div', { class: 'import-selection-actions' }, [cancelSelection, apply]));
  }
  const keepForm = () => {
    formRevision++;
    if (state.importing || activeJob) return;
    if (!safeToRetain()) return;
    operation.input = readInput(); operation.updatedAt = Date.now();
    if (operation.input.text || operation.input.title) retainImport(operation).catch(() => toast('导入草稿未能保存到浏览器，请保留原文后再刷新。', true));
  };
  dialog.body.addEventListener('input', event => {
    if (event.target === text && selecting) resetSelection();
    if (event.target === url) sourceUrlEdited = true;
    if (!previewPanel.contains(event.target)) keepForm();
  });
  dialog.body.addEventListener('change', event => {
    if (event.target !== file && !previewPanel.contains(event.target)) keepForm();
    if (event.target.name === 'import-mode' && selecting) renderSelection();
  });
  const lockForm = locked => $$('input,textarea,select,button', dialog.body).forEach(control => { control.disabled = locked; });
  if (activeJob) {
    lockForm(true);
    dialog.body.append(el('p', { class: 'notice', text: '已找回这次整理的原文与任务编号。继续时只读取同一个任务，不会再次调用模型。' }));
  }
  if (captured) keepForm();
  const cancel = button('取消', async () => {
    if (!state.importing) return closeModal();
    cancelled = true; cancel.disabled = true;
    let phase = activeJob ? 'unknown' : 'cancelled';
    try {
      if (activeJob) {
        const job = await request(`/api/jobs/${encodeURIComponent(activeJob)}`, { method: 'DELETE' });
        phase = job.status === 'completed' ? 'completed' : ['cancelled', 'canceled', 'failed'].includes(job.status) ? job.status : 'unknown';
      }
      fallbackController?.abort();
    } catch (error) { if (error.status !== 404) toast(`取消请求未确认，原任务编号已保留，可继续查询：${error.message}`, true); }
    operation.phase = phase; await retainImport(operation).catch(() => {});
    state.importing = false; closeModal();
  }, 'secondary');
  const submit = button(activeJob ? '继续上次整理' : append ? '追加到图谱' : '开始整理', async () => {
    if (!activeJob && selecting) return formError(dialog.body, '请先确认要导入的会话与消息范围。');
    if (!activeJob && !text.value.trim()) return formError(dialog.body, '请先粘贴对话内容，或上传对话文件。');
    if (!activeJob && url.value && !/^https?:\/\//i.test(url.value)) return formError(dialog.body, '出处链接应以 http:// 或 https:// 开头。');
    if (!activeJob) {
      try {
        const catalog = inspectConversationFile(text.value);
        if (catalog.kind === 'archive') { prepareImport(text.value); return; }
        const checked = previewConversation(text.value);
        if (checked.kind === 'conversation' && checked.totalMessages > modeLimit()) { prepareImport(text.value); return formError(previewPanel, `当前模式每次最多整理 ${modeLimit()} 条消息，请先选择范围。`); }
        if (!withinImportLimit(readInput(), checked.kind)) { prepareImport(text.value); return formError(previewPanel, checked.kind === 'graph' ? '图谱内容超过 8 MB，请按主题拆分后导入。' : '导入内容超过 2 MB，请先选择较小的范围。'); }
        if (checked.kind === 'graph') $('input[name="import-mode"][value="outline"]', dialog.body).checked = true;
      } catch (error) { return formError(dialog.body, error.message); }
    }
    const recovering = Boolean(activeJob);
    if (!recovering) operation.input = readInput();
    const mode = operation.input.mode;
    state.importing = true; cancelled = false; submit.disabled = true; lockForm(true);
    submit.lastChild.textContent = recovering ? '正在继续原任务…' : mode === 'ai' ? '正在提取思考路径…' : '正在整理原文…';
    dialog.container.classList.add('busy'); $('.form-error', dialog.body)?.remove(); progress.hidden = false; cancel.lastChild.textContent = '停止整理';
    try {
      // Await durable original text before any paid request can be admitted.
      await retainImport(operation);
      if (cancelled) return;
      let payload, graph, baseGraph;
      if (!recovering) {
        if (append) {
          const id = operation.targetGraphId;
          const draft = state.drafts.get(id);
          if (draft?.dirty) await saveGraphId(id, { silent: true });
          if (cancelled) return;
          if (state.conflictIds.has(id) || state.drafts.get(id)?.dirty) throw new Error('请先成功保存当前图谱并处理版本冲突，再追加对话。');
          baseGraph = state.graph?.id === id ? clone(state.graph) : clone(state.drafts.get(id)?.graph || await request(`/api/graphs/${encodeURIComponent(id)}`));
        }
        payload = { ...operation.input, ...(append ? { graph: baseGraph } : {}) };
        if (mode === 'ai' && (state.api.apiKey || state.api.baseUrl || state.api.model)) payload.api = { ...state.api };
        if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 32 * 1024 * 1024) throw new Error('包含已有图谱的完整请求超过 32 MB，请减少内容或建立新图谱。');
      }
      if (mode === 'ai') {
        let job;
        if (recovering) {
          try { job = await request(`/api/jobs/${encodeURIComponent(activeJob)}`); }
          catch (error) {
            if (error.status === 404) {
              operation.phase = 'unknown'; activeJob = null; await retainImport(operation);
              throw new Error('尚未找到这次任务。原文已保留；点击“重新整理”会使用同一任务编号确认提交，避免重复调用。');
            }
            throw error;
          }
        } else {
          const previousUnknown = operation.phase === 'unknown' && operation.jobId;
          operation.jobId = previousUnknown || crypto.randomUUID(); operation.phase = 'submitting';
          activeJob = operation.jobId;
          await retainImport(operation);
          if (cancelled) return;
          job = await request('/api/jobs', { method: 'POST', body: JSON.stringify({ id: activeJob, kind: append ? 'append' : 'import', input: payload }) });
          operation.jobId = activeJob = job.id;
          if (cancelled) {
            operation.phase = 'unknown';
            try {
              const stopped = await request(`/api/jobs/${encodeURIComponent(activeJob)}`, { method: 'DELETE' });
              operation.phase = stopped.status === 'completed' ? 'completed' : ['cancelled', 'canceled', 'failed'].includes(stopped.status) ? stopped.status : 'unknown';
            } catch (error) { toast(`后台整理尚未确认停止，原任务编号已保留：${error.message}`, true); }
            await retainImport(operation); return;
          }
        }
        operation.phase = 'running'; await retainImport(operation);
        while (!cancelled) {
          progressText.textContent = job.message || '正在整理对话…';
          if (Number.isFinite(job.progress)) progressBar.value = Math.max(0, Math.min(100, job.progress)); else progressBar.removeAttribute('value');
          if (job.status === 'completed') { graph = job.result; operation.phase = 'completed'; await retainImport(operation); break; }
          if (['failed', 'cancelled', 'canceled'].includes(job.status)) {
            operation.phase = job.status === 'failed' ? 'failed' : 'cancelled'; activeJob = null; await retainImport(operation);
            throw new Error(job.error?.message || job.error || job.message || '整理已停止，原文仍然保留。');
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!cancelled) job = await request(`/api/jobs/${encodeURIComponent(activeJob)}`);
        }
      } else {
        fallbackController = new AbortController();
        graph = await request(append ? '/api/append' : '/api/import', { method: 'POST', body: JSON.stringify(payload), signal: fallbackController.signal });
      }
      if (cancelled) return;
      if (saveInFlight.has(graph.id)) await saveInFlight.get(graph.id);
      if (cancelled) return;
      const before = append && state.graph?.id === graph.id ? clone(state.graph) : null;
      state.inspectorOpen = innerWidth > 880;
      setView(innerWidth <= 700 ? 'outline' : 'graph');
      setGraph(graph, { dirty: true, saved: append && state.library.some(item => item.id === graph.id), history: before ? [...state.history, before].slice(-35) : [] });
      // Retain both the task receipt and graph draft until the result is saved.
      await draftStore.put(state.drafts.get(graph.id));
      operation.phase = 'completed'; operation.resultGraphId = graph.id; await retainImport(operation);
      await saveGraphId(graph.id, { silent: true });
      if (!state.dirty) await clearImport(operation);
      state.importing = false; closeModal();
      toast(state.dirty ? '整理结果与原文已保留，完成保存或处理版本冲突后即可继续。' : append ? '新对话已追加，已有观点与原文继续保留。请核对新形成的关系。' : mode === 'ai' ? 'AI 结构化完成，请核对观点归属和原文依据' : '原文整理完成，未调用 AI。可手动补充关系与判断。');
    } catch (error) {
      if (cancelled) return;
      state.importing = false; formError(dialog.body, error.message); submit.disabled = false;
      submit.lastChild.textContent = activeJob ? '继续上次整理' : '重新整理'; cancel.lastChild.textContent = '取消'; progress.hidden = true;
      lockForm(Boolean(activeJob)); dialog.container.classList.remove('busy');
    }
  }, 'primary', 'sparkles');
  dialog.footer.append(cancel, submit); title.focus();
  if (mobile?.text) prepareImport(mobile.text);
  if (options.autoResume && activeJob) submit.click();
  return operation;
}

function openSettings() {
  const dialog = modal('模型与设置', '兼容 OpenAI 格式的模型服务，用于深度结构化。');
  const baseUrl = el('input', { value: state.api.baseUrl, type: 'url', placeholder: '留空使用服务端配置，例如 https://api.openai.com/v1', autocomplete: 'off' });
  const model = el('input', { value: state.api.model, placeholder: state.config.model || '填写供应商提供的模型名称', autocomplete: 'off' });
  const key = el('input', { value: state.api.apiKey, type: 'password', placeholder: state.config.aiConfigured ? '服务端已有配置，可留空' : '输入你的 API Key', autocomplete: 'off', spellcheck: false });
  dialog.body.append(el('div', { class: 'notice', text: state.config.aiConfigured ? '服务端已配置 AI 模型。你也可以在下面为当前页面临时指定另一组设置。' : '当前未检测到服务端 AI 配置。原文整理可直接使用；AI 深度结构化需要在此填写配置，或在启动服务时设置环境变量。' }), field('API Base URL', baseUrl), field('模型名称', model), field('API Key', key), el('p', { class: 'modal-note', text: '这些设置仅保存在当前页面内存，刷新或关闭后清除。API Key 不会写入图谱、浏览器本地存储或导出文件。导入时填写的对话内容将经本地服务发送给你配置的模型服务。' }));
  dialog.footer.append(button('清除临时设置', () => { state.api = { baseUrl: '', model: '', apiKey: '' }; updateModelStatus(); closeModal(); toast('已清除当前页面的临时模型设置'); }, 'secondary'), button('应用到本次会话', () => { if (baseUrl.value && !/^https?:\/\//i.test(baseUrl.value)) return formError(dialog.body, 'API Base URL 应以 http:// 或 https:// 开头。'); state.api = { baseUrl: baseUrl.value.trim(), model: model.value.trim(), apiKey: key.value.trim() }; updateModelStatus(); closeModal(); toast('设置已临时生效，刷新页面后清除'); }, 'primary', 'check'));
  if (state.config.hosted) dialog.body.append(button('退出在线工作空间', async () => {
    try { await request('/api/logout', { method: 'POST', body: '{}' }); state.api = { baseUrl: '', model: '', apiKey: '' }; location.assign('/login'); }
    catch (error) { formError(dialog.body, error.message); }
  }, 'text-button'));
}
function updateModelStatus() { $('.local-badge').textContent = state.config.hosted ? '在线' : '本地'; const footerText = [...$('.sidebar-footer').childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()); if (footerText) footerText.textContent = state.config.hosted ? '私人在线工作空间' : '本地工作空间'; $('#model-status').textContent = state.api.apiKey ? '临时模型已配置' : state.config.aiConfigured ? `已配置 · ${state.api.model || state.config.model || 'AI 模型'}` : '原文模式可用 · AI 待配置'; }
async function openHistory() {
  if (!state.graph) return;
  const id = state.graph.id;
  const dialog = modal('版本历史', '每次保存都留下一个版本。恢复会生成新版本，保留此前的记录。');
  dialog.body.append(el('p', { class: 'empty-note', text: '正在读取历史版本…' }));
  dialog.footer.append(button('关闭', closeModal, 'secondary'));
  try {
    if (state.dirty && !state.conflictIds.has(id)) { remember(); await saveGraphId(id, { silent: true }); }
    const history = await request(`/api/graphs/${encodeURIComponent(id)}/history`);
    dialog.body.replaceChildren();
    if (!history.length) dialog.body.append(el('p', { class: 'empty-note', text: '还没有保存版本。保存这张图谱后，会在这里留下记录。' }));
    for (const item of history) {
      const restore = button('恢复此版本', async () => {
        restore.disabled = true;
        try {
          if (saveInFlight.has(id)) await saveInFlight.get(id);
          const graph = await request(`/api/graphs/${encodeURIComponent(id)}/restore`, { method: 'POST', body: JSON.stringify({ version: item.version, expectedRevision: state.graph.revision ?? 0 }) });
          const before = clone(state.graph);
          state.conflictIds.delete(id); state.drafts.delete(id); await draftStore.remove(id).catch(() => {});
          state.graph = null;
          setGraph(graph, { saved: true, history: [before] });
          state.library = await request('/api/graphs'); renderLibrary(); closeModal(); toast('已恢复历史版本，旧记录仍然保留。');
        } catch (error) { formError(dialog.body, error.message); restore.disabled = false; }
      }, 'secondary compact', 'clock');
      dialog.body.append(el('article', { class: 'history-entry' }, [el('div', {}, [el('strong', { text: item.title }), el('p', { text: `${new Date(item.createdAt).toLocaleString('zh-CN')} · ${item.nodeCount} 个节点 · 版本 ${item.version}` })]), restore]));
    }
  } catch (error) { dialog.body.replaceChildren(); formError(dialog.body, error.message); }
}
function openLibrarySearch() {
  const dialog = modal('搜索你的知识库', '查找已保存图谱中的观点与对话原文。当前输入关键词进行搜索。');
  const input = el('input', { type: 'search', placeholder: '例如：用户访谈、产品定位、我否定的方案', value: state.libraryQuery });
  const semantic = el('input', { type: 'checkbox', 'aria-label': 'AI 关联检索' });
  const semanticNote = el('p', { class: 'modal-note', hidden: true, text: '将已保存的观点摘要发送给当前模型查找相关内容。点击“搜索”后才会调用模型，相关结果仍需结合原文判断。' });
  const results = el('div', { class: 'knowledge-results', 'aria-live': 'polite' });
  let timer, sequence = 0;
  const search = async () => {
    const current = ++sequence, query = input.value.trim();
    results.replaceChildren();
    if (!query) { results.append(el('p', { class: 'empty-note', text: '输入关键词，查找过去留下的思考。' })); return; }
    results.append(el('p', { class: 'empty-note', text: '正在搜索…' }));
    try {
      const payload = { query };
      if (state.api.apiKey || state.api.baseUrl || state.api.model) payload.api = { ...state.api };
      const found = semantic.checked
        ? await request('/api/search', { method: 'POST', body: JSON.stringify(payload) })
        : await request(`/api/search?q=${encodeURIComponent(query)}`);
      const hits = found.flatMap(hit => hit.graphId ? [hit] : [
        ...(hit.nodes || []).map(node => ({ graphId: hit.id, title: hit.title, nodeId: node.id, label: node.label, excerpt: node.summary })),
        ...(hit.messages || []).map(message => ({ graphId: hit.id, title: hit.title, messageId: message.id, label: '对话原文', excerpt: message.excerpt })),
        ...(!(hit.nodes?.length || hit.messages?.length) ? [{ graphId: hit.id, title: hit.title, label: hit.title, excerpt: hit.description || '' }] : []),
      ]);
      if (current !== sequence || !dialog.container.isConnected) return;
      results.replaceChildren(el('p', { class: 'empty-note', text: `找到 ${hits.length} 个匹配结果` }));
      for (const hit of hits) results.append(button('', async () => {
        await switchGraph(hit.graphId); closeModal();
        if (state.graph?.id === hit.graphId && hit.messageId) showSource(hit.messageId);
        if (state.graph?.id === hit.graphId && hit.nodeId) { setView('outline'); selectNode(hit.nodeId); $$('.outline-card').find(card => card.dataset.node === hit.nodeId)?.scrollIntoView({ block: 'center' }); }
      }, 'knowledge-result'));
      $$('.knowledge-result', results).forEach((entry, index) => {
        const hit = hits[index]; entry.replaceChildren(el('small', { text: hit.title }), el('strong', { text: hit.label || '对话原文' }), el('p', { text: hit.excerpt || '' }));
      });
    } catch (error) { if (current === sequence) { results.replaceChildren(); formError(results, error.message); } }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer); sequence++;
    if (semantic.checked) results.replaceChildren(el('p', { class: 'empty-note', text: '输入想找的内容，然后点击搜索。' }));
    else timer = setTimeout(search, 300);
  });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { clearTimeout(timer); search(); } });
  semantic.addEventListener('change', () => {
    clearTimeout(timer); sequence++; semanticNote.hidden = !semantic.checked;
    if (semantic.checked) results.replaceChildren(el('p', { class: 'empty-note', text: '输入一个问题或想法，然后点击搜索。' }));
    else search();
  });
  dialog.body.append(field('搜索全部观点与原文', input), el('label', { class: 'mode-choice compact-choice' }, [semantic, el('span', {}, [el('strong', { text: 'AI 关联检索' }), el('small', { text: '用意思相近的表达，找回相关观点。' })])]), semanticNote, results);
  dialog.footer.append(button('关闭', closeModal, 'secondary'), button('搜索', () => { clearTimeout(timer); search(); }, 'primary', 'search')); search(); input.focus();
}
function openRelationSuggestions() {
  if (!state.graph || state.graph.nodes.length < 2) return toast('至少需要两个观点才能查找关联。');
  const graphId = state.graph.id;
  const dialog = modal('发现跨对话关联', '让模型寻找支持、反驳、修正和依赖关系，由你决定是否加入图谱。');
  const results = el('div');
  dialog.body.append(el('p', { class: 'notice', text: '查找时会将当前图谱的观点与关联原文发送至已配置模型。建议不会自动改变已有观点、判断状态或关系。' }), results);
  const submit = button('查找关联', async () => {
    submit.disabled = true; submit.lastChild.textContent = '正在寻找关联…'; results.replaceChildren();
    try {
      const payload = { graph: state.graph };
      if (state.api.apiKey || state.api.baseUrl || state.api.model) payload.api = { ...state.api };
      const response = await request('/api/relations/suggest', { method: 'POST', body: JSON.stringify(payload) });
      if (!dialog.container.isConnected || state.graph.id !== graphId) return;
      if (!response.relations?.length) results.append(el('p', { class: 'empty-note', text: '暂未发现可以明确表达的新关系。你仍可以手动连接观点。' }));
      for (const suggestion of response.relations || []) {
        const source = state.graph.nodes.find(node => node.id === suggestion.source), target = state.graph.nodes.find(node => node.id === suggestion.target);
        if (!source || !target || !['supports', 'challenges', 'revises', 'depends'].includes(suggestion.type)) continue;
        const card = el('article', { class: 'relation-suggestion' }, [el('h3', { text: `${source.label} → ${RELATIONS[suggestion.type]} → ${target.label}` }), el('p', { text: suggestion.explanation || suggestion.label || '' })]);
        const evidence = el('div', { class: 'suggestion-evidence' });
        for (const id of suggestion.evidenceIds || []) {
          const index = state.graph.messages.findIndex(message => message.id === id);
          if (index >= 0) evidence.append(el('details', {}, [el('summary', { text: `原文 ${String(index + 1).padStart(2, '0')} · ${ROLE_NAMES[state.graph.messages[index].role] || '未标注'}` }), el('p', { text: state.graph.messages[index].content })]));
        }
        const add = button('添加此关系', () => {
          if (state.graph.edges.some(edge => edge.source === suggestion.source && edge.target === suggestion.target && edge.type === suggestion.type)) { add.disabled = true; add.lastChild.textContent = '已有此关系'; return; }
          mutate(graph => graph.edges.push({ id: uid('edge'), source: suggestion.source, target: suggestion.target, type: suggestion.type, label: String(suggestion.label || suggestion.explanation || '').slice(0, 500) }));
          add.disabled = true; add.lastChild.textContent = '已添加'; toast('已添加这条关系，可以撤销。');
        }, 'secondary compact', 'plus');
        card.append(evidence, add); results.append(card);
      }
    } catch (error) { formError(results, error.message); }
    finally { submit.disabled = false; submit.lastChild.textContent = '重新查找'; }
  }, 'primary', 'sparkles');
  dialog.footer.append(button('关闭', closeModal, 'secondary'), submit);
}
async function downloadResponse(path, filename) {
  const response = await fetch(path);
  if (response.status === 401) showSessionExpired();
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' && data.error.trim() ? data.error : `下载失败（${response.status}）`);
  }
  const blob = await response.blob(), url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: filename }); document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function openBackup() {
  const dialog = modal('备份与恢复', '把整个知识库带走，或从备份恢复到当前工作空间。');
  dialog.body.append(el('p', { class: 'notice', text: '备份包含已保存图谱及其对话原文。恢复时遇到同名 ID 会创建副本，已有图谱会保留。请妥善保管包含私人对话的备份文件。' }));
  const download = button('下载完整知识库备份', async () => {
    download.disabled = true;
    try {
      remember();
      await Promise.all([...state.drafts].filter(([, draft]) => draft.dirty).map(([id]) => state.conflictIds.has(id) ? Promise.reject(new Error('请先解决图谱的保存冲突再备份。')) : saveGraphId(id, { silent: true })));
      if ([...state.drafts.values()].some(draft => draft.dirty)) throw new Error('仍有未成功保存的草稿，请先保存或单独导出。');
      await downloadResponse('/api/backup', `ChatGraph-备份-${new Date().toISOString().slice(0, 10)}.json`); toast('知识库备份已开始下载');
    } catch (error) { formError(dialog.body, error.message); }
    finally { download.disabled = false; }
  }, 'primary compact', 'upload');
  const file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': '选择知识库备份文件' });
  const preview = el('p', { class: 'empty-note', text: '选择 ChatGraph 导出的知识库备份文件。' });
  let backup = null;
  const restore = button('恢复备份', async () => {
    if (!backup) return formError(dialog.body, '请先选择有效备份文件。');
    restore.disabled = true;
    try {
      if (new TextEncoder().encode(JSON.stringify({ backup })).byteLength > 50 * 1024 * 1024) throw new Error('完整备份请求超过 50 MB，请使用文件目录备份恢复。');
      const result = await request('/api/backup', { method: 'POST', body: JSON.stringify({ backup }) });
      state.library = await request('/api/graphs'); renderLibrary(); closeModal(); toast(`已恢复 ${result.count ?? result.restored?.length ?? result.restored ?? 0} 张图谱`);
    } catch (error) { formError(dialog.body, error.message); restore.disabled = false; }
  }, 'primary', 'shield'); restore.disabled = true;
  file.addEventListener('change', async () => {
    backup = null; restore.disabled = true;
    try {
      const selected = file.files?.[0]; if (!selected) return;
      if (selected.size > 50 * 1024 * 1024) throw new Error('备份超过 50 MB，请使用文件目录备份恢复。');
      const candidate = JSON.parse(await selected.text());
      if (candidate.format !== 'chatgraph-backup' || !Array.isArray(candidate.graphs)) throw new Error('请选择完整知识库备份，单张图谱请使用对话导入。');
      backup = candidate; preview.textContent = `${selected.name} · ${backup.graphs.length} 张图谱 · 点击恢复后写入知识库`; restore.disabled = false;
    } catch (error) { formError(dialog.body, error.message); }
  });
  dialog.body.append(download, field('从文件恢复', file), preview);
  dialog.footer.append(button('关闭', closeModal, 'secondary'), restore);
}
async function openShare() {
  if (!state.graph) return;
  const dialog = modal('分享这次思考', '创建只读分享，设置有效期，并随时撤销。');
  const include = el('input', { type: 'checkbox' });
  const expiry = selectInput({1:'1 天',7:'7 天',30:'30 天'}, '7', () => {});
  dialog.body.append(el('label', { class: 'mode-choice' }, [include, el('span', {}, [el('strong', { text: '同时分享对话原文' }), el('small', { text: '默认只分享图谱。勾选前请检查原文是否包含私人内容。' })])]), field('分享有效期', expiry));
  const result = el('div', { class: 'share-result' }); dialog.body.append(result);
  const create = button('创建只读链接', async () => {
    create.disabled = true;
    try {
      const share = await request('/api/shares', { method: 'POST', body: JSON.stringify({ graph: state.graph, includeSources: include.checked, expiresInDays: Number(expiry.value) }) });
      const address = el('input', { readOnly: true, value: share.url, 'aria-label': '只读分享链接' });
      result.replaceChildren(el('p', { class: 'notice', text: share.scope === 'public' ? `公开只读链接，有效期至 ${new Date(share.expiresAt).toLocaleString('zh-CN')}。` : '当前为本地服务，这个链接只能在运行 ChatGraph 的同一台电脑打开。向他人发送内容可使用交互式 HTML 导出，或部署在线工作空间。' }), address, button('复制链接', async () => {
        try { await navigator.clipboard.writeText(share.url); toast('链接已复制'); }
        catch { address.select(); toast('请复制已选中的链接'); }
      }, 'secondary compact', 'link'), button('撤销此链接', async () => {
        try { await request(`/api/shares/${encodeURIComponent(share.token)}`, { method: 'DELETE' }); result.replaceChildren(el('p', { class: 'notice', text: '链接已撤销，无法继续访问。' })); }
        catch (error) { formError(result, error.message); }
      }, 'text-button'));
    } catch (error) { formError(result, error.message); }
    finally { create.disabled = false; }
  }, 'primary', 'link');
  const existing = el('div', { class: 'share-existing' }); dialog.body.append(existing);
  try {
    const shares = await request('/api/shares');
    for (const share of shares.filter(item => item.graphId === state.graph.id)) {
      const row = el('div', { class: 'history-entry' }, [el('span', { text: `现有链接 · ${new Date(share.expiresAt).toLocaleDateString('zh-CN')} 到期` })]);
      row.append(button('撤销', async () => { try { await request(`/api/shares/${encodeURIComponent(share.token)}`, { method: 'DELETE' }); row.remove(); toast('已撤销分享链接'); } catch (error) { formError(existing, error.message); } }, 'text-button')); existing.append(row);
    }
  } catch (error) { formError(existing, error.message); }
  dialog.footer.append(button('关闭', closeModal, 'secondary'), create);
}
function openRelation(edge) {
  if (!state.graph || state.graph.nodes.length < 2) return toast('至少需要两个观点才能添加关系');
  const dialog = modal(edge ? '编辑观点关系' : '连接两条思路', '让支持、反驳和修正关系清楚地表达出来。');
  const nodes = Object.fromEntries(state.graph.nodes.map(node => [node.id, node.label]));
  const initialSource = edge?.source || state.selected || state.graph.nodes[0].id;
  const source = selectInput(nodes, initialSource, () => {});
  const target = selectInput(nodes, edge?.target || state.graph.nodes.find(node => node.id !== initialSource).id, () => {});
  const type = selectInput(RELATIONS, edge?.type || 'supports', () => {});
  const label = el('input', { value: edge?.label || '', placeholder: '可选：一句话描述这条关系', maxlength: 200 });
  dialog.body.append(field('起点观点', source), field('关系', type), field('终点观点', target), field('补充说明', label), el('p', { class: 'modal-note', text: '关系按“起点 → 终点”读取，例如“用户反馈 支持 产品定位”。语义关系独立于大纲的父子层级。' }));
  dialog.footer.append(button('取消', closeModal, 'secondary'), button(edge ? '保存关系' : '添加关系', () => { if (source.value === target.value) return formError(dialog.body, '请选择两个不同的观点。'); const value = { id: edge?.id || uid('edge'), source: source.value, target: target.value, type: type.value, label: label.value.trim() }; mutate(graph => { if (edge) graph.edges = graph.edges.map(item => item.id === edge.id ? value : item); else graph.edges.push(value); }); closeModal(); }, 'primary', 'link'));
}
function openSourcePicker(node) {
  const dialog = modal('关联对话原文', '选择支撑这个节点的原文，不会修改原始对话。');
  if (!state.graph.messages.length) dialog.body.append(el('p', { class: 'empty-note', text: '这张图谱没有可关联的对话原文。' }));
  state.graph.messages.forEach((message, index) => {
    const checkbox = el('input', { type: 'checkbox', value: message.id, checked: node.sourceIds?.includes(message.id) || false });
    const choice = el('label', { class: 'mode-choice', style: 'margin-bottom:10px' }, [checkbox, el('span', {}, [el('strong', { text: `${String(index + 1).padStart(2, '0')} · ${ROLE_NAMES[message.role] || '未标注'}` }), el('small', { text: message.content.slice(0, 600) + (message.content.length > 600 ? '…' : '') })])]); dialog.body.append(choice);
  });
  dialog.footer.append(button('取消', closeModal, 'secondary'), button('确认关联', () => { const ids = $$('input[type="checkbox"]:checked', dialog.body).map(input => input.value); mutate(graph => { graph.nodes.find(item => item.id === node.id).sourceIds = ids; }); closeModal(); }, 'primary', 'check'));
}
function confirmDelete(graph) {
  const dialog = modal('删除本地图谱', '这会删除知识库中的保存文件。');
  dialog.body.append(el('p', { class: 'notice', text: `即将删除「${graph.title}」。建议先导出需要保留的内容。当前打开的内容会保留为未保存草稿。` }));
  const remove = button('删除已保存文件', async () => {
    remove.disabled = true; deletingGraphs.add(graph.id);
    try {
      // Finish a previously admitted write before deleting; block new autosaves
      // until the retained draft has been marked as explicitly paused.
      if (saveInFlight.has(graph.id)) await saveInFlight.get(graph.id);
      await request(`/api/graphs/${encodeURIComponent(graph.id)}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision: state.drafts.get(graph.id)?.graph.revision ?? graph.revision }) });
      state.library = state.library.filter(item => item.id !== graph.id);
      state.conflictIds.delete(graph.id);
      if (state.graph?.id === graph.id) {
        state.saved = false; state.dirty = true; state.autoSavePaused = true; state.graph.revision = 0; remember();
      } else { state.drafts.delete(graph.id); await draftStore.remove(graph.id).catch(() => {}); }
      renderHeader(); renderLibrary(); closeModal(); toast('已删除保存文件，当前打开的草稿不会自动重新保存。');
    } catch (error) { formError(dialog.body, error.message); remove.disabled = false; }
    finally { deletingGraphs.delete(graph.id); }
  }, 'danger-button', 'trash');
  dialog.footer.append(button('取消', closeModal, 'secondary'), remove);
}

const actions = { import: () => openImport(), append: () => openImport({ append: true }), redo, autoLayout: resetLayout, reparent: openHierarchy, selectAll: openMultiSelect, history: openHistory, resumeImport: openPendingImports, recoverDrafts: openForeignDrafts, suggestRelations: openRelationSuggestions, searchLibrary: openLibrarySearch, backup: openBackup, share: openShare, settings: openSettings, save, demo: openDemo, editTitle, undo, fit: fitCanvas, zoomIn: () => zoom(1.2), zoomOut: () => zoom(1 / 1.2), addNode: () => addNode(), toggleExport: () => { $('#export-menu').hidden = !$('#export-menu').hidden; }, toggleFilters: () => { $('#filter-bar').hidden = !$('#filter-bar').hidden; }, resetFilters: () => { state.filterType = 'all'; state.filterStatus = 'all'; state.query = ''; $('#filter-type').value = 'all'; $('#filter-status').value = 'all'; $('#search').value = ''; render(); }, toggleInspector: () => { state.inspectorOpen = !state.inspectorOpen; renderInspector(); }, toggleSidebar: () => $('#sidebar').classList.toggle('open'), library: () => { if (innerWidth <= 700) $('#sidebar').classList.add('open'); $('#library-list').scrollIntoView({ block: 'nearest' }); toast(state.library.length ? '在左侧选择一张图谱继续思考' : '保存一张图谱后，会显示在左侧知识库中'); } };
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]'); if (action) actions[action.dataset.action]?.();
  const format = event.target.closest('[data-format]'); if (format) exportGraph(format.dataset.format);
  const view = event.target.closest('[data-view]'); if (view) setView(view.dataset.view);
  if (!event.target.closest('.export-wrapper')) $('#export-menu').hidden = true;
  if (innerWidth <= 700 && !event.target.closest('#sidebar') && !event.target.closest('[data-action="toggleSidebar"]')) $('#sidebar').classList.remove('open');
});
document.addEventListener('input', event => {
  if (!event.target.closest('#inspector')) return;
  const key = { '编辑观点名称': 'label', '编辑观点说明': 'summary', '我的补充笔记': 'note' }[event.target.getAttribute('aria-label')];
  const node = selectedNode();
  if (!key || !node) return;
  const value = event.target.value;
  if (node[key] === value || (key === 'label' && !value.trim())) return;
  const editing = `${state.graph.id}:${node.id}:${key}`;
  // One undo snapshot per field editing session; persist every actual keystroke.
  if (liveEditKey !== editing) { snapshot(); liveEditKey = editing; }
  node[key] = value; changed();
  renderGraph();
  if (state.view === 'outline') renderOutline();
  if (state.view === 'timeline') renderTimeline();
  if (key === 'label') $('.inspector-node-title').textContent = value;
});
document.addEventListener('focusout', event => { if (event.target.closest('#inspector')) liveEditKey = null; });
$('#library-search').addEventListener('input', event => { state.libraryQuery = event.target.value; renderLibrary(); });
window.addEventListener('online', scheduleSave);
window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'chatgraph:import' || event.data.version !== 1) return;
  const capture = event.data.capture;
  const acknowledge = (ok, error) => window.postMessage({ type: 'chatgraph:import:ack', version: 1, requestId: event.data.requestId, ok, ...(error ? { error } : {}) }, location.origin);
  if (state.importing || $('#modal-root').children.length) return acknowledge(false, '请先完成或关闭当前对话框。');
  if (!capture || !Array.isArray(capture.messages) || !capture.messages.length || capture.messages.length > 500 || capture.messages.some(message => !message || typeof message.content !== 'string' || !['user','assistant','unknown'].includes(message.role)) || new TextEncoder().encode(JSON.stringify(capture)).byteLength > 2 * 1024 * 1024) return acknowledge(false, '捕获数据无效或超过导入范围。');
  const operation = openImport({ capture: { ...capture, title: String(capture.title || '').slice(0, 200), url: /^https?:\/\//i.test(capture.url || '') ? capture.url : '', capture: { ...capture.capture, warnings: Array.isArray(capture.capture?.warnings) ? capture.capture.warnings.filter(value => typeof value === 'string') : [] } } });
  try { await retainImport(operation); acknowledge(true); }
  catch { acknowledge(false, '浏览器无法持久保存收到的原文，请复制或下载备份后重试。'); }
});
$('#search').addEventListener('input', event => { state.query = event.target.value; renderGraph(); if (state.view === 'outline') renderOutline(); if (state.view === 'source') renderSources(); if (state.view === 'timeline') renderTimeline(); });
$('.search-control').addEventListener('click', () => { $('.search-control').classList.add('expanded'); $('#search').focus(); });
$('#search').addEventListener('blur', () => $('.search-control').classList.remove('expanded'));
$('#filter-type').addEventListener('change', event => { state.filterType = event.target.value; renderGraph(); if (state.view === 'outline') renderOutline(); if (state.view === 'timeline') renderTimeline(); });
$('#filter-status').addEventListener('change', event => { state.filterStatus = event.target.value; renderGraph(); if (state.view === 'outline') renderOutline(); if (state.view === 'timeline') renderTimeline(); });
$('#canvas').addEventListener('wheel', event => { event.preventDefault(); const rect = $('#canvas').getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), { x: event.clientX - rect.left, y: event.clientY - rect.top }); }, { passive: false });
$('#canvas').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('button') || event.target.closest('.edge-hit')) return;
  const canvas = $('#canvas');
  const initial = { x: event.clientX, y: event.clientY, cameraX: state.camera.x, cameraY: state.camera.y, moved: false, pointerId: event.pointerId };
  canvas.setPointerCapture(event.pointerId); canvas.classList.add('panning');
  const move = next => { if (next.pointerId !== initial.pointerId) return; const dx = next.clientX - initial.x, dy = next.clientY - initial.y; if (Math.hypot(dx, dy) > 4) initial.moved = true; state.camera.x = initial.cameraX + dx; state.camera.y = initial.cameraY + dy; applyCamera(); };
  const end = next => { if (next.pointerId !== initial.pointerId) return; canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', end); canvas.removeEventListener('pointercancel', end); canvas.classList.remove('panning'); if (!initial.moved) { state.selected = null; state.multiSelected.clear(); renderBatchBar(); renderInspector(); $$('.graph-node').forEach(node => node.classList.remove('selected', 'multi-selected')); } };
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
});
document.addEventListener('keydown', event => {
  const editable = event.target.closest('input,textarea,select,[contenteditable="true"]');
  if (event.key === 'Escape') { if ($('#modal-root').children.length) closeModal(); else { $('#export-menu').hidden = true; $('#sidebar').classList.remove('open'); } }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!$('#modal-root').children.length) save(); }
  if (!editable && !$('#modal-root').children.length && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  if (!editable && !$('#modal-root').children.length && event.key === '/') { event.preventDefault(); $('#search').focus(); }
});
window.addEventListener('beforeunload', event => { remember(); if (state.draftStorageFailed && [...state.drafts.values()].some(draft => draft.dirty)) { event.preventDefault(); event.returnValue = ''; } });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.graph) fitCanvas(); }, 150); });

async function boot() {
  hydrateIcons();
  setView(state.view);
  const results = await Promise.allSettled([request('/api/demo'), request('/api/graphs'), request('/api/config'), draftStore.all()]);
  if (results[1].status === 'fulfilled') state.library = results[1].value; else toast(`知识库读取失败：${results[1].reason.message}`, true);
  if (results[2].status === 'fulfilled') state.config = results[2].value; else state.config = { aiConfigured: false };
  updateModelStatus();
  if (results[0].status === 'fulfilled') state.demo = results[0].value;
  const chooseSelection = graph => graph.nodes.find(node => node.id === 'demo-ownership')?.id || graph.nodes.find(node => node.type === 'claim' && node.status === 'confirmed')?.id || graph.nodes.find(node => node.type === 'claim')?.id || null;
  if (results[3].status === 'fulfilled') {
    state.pendingImports = draftStore.recoverableImports(results[3].value);
    state.foreignImports = foreignImportReceipts(results[3].value);
    const validDrafts = results[3].value.filter(draft => draft?.dirty && draft.graph?.id && Array.isArray(draft.graph.nodes) && Array.isArray(draft.graph.messages));
    state.foreignDrafts = validDrafts.filter(draft => !draftStore.owns(draft));
    const candidates = validDrafts.filter(draft => draftStore.owns(draft));
    const recovered = [];
    for (const draft of candidates) {
      const savedSummary = state.library.find(graph => graph.id === draft.graph.id);
      if (savedSummary && (savedSummary.revision || 0) > (draft.graph.revision || 0)) {
        try {
          const saved = await request(`/api/graphs/${encodeURIComponent(draft.graph.id)}`);
          const signature = graph => JSON.stringify({ ...graph, revision: 0, updatedAt: '', schemaVersion: 2 });
          if (signature(saved) === signature(draft.graph)) { await draftStore.remove(draft.graph.id); continue; }
        } catch { /* Preserve draft if server data cannot be read. */ }
        state.conflictIds.add(draft.graph.id);
      }
      state.drafts.set(draft.graph.id, { ...draft, history: [], redoHistory: [] }); recovered.push(draft);
    }
    const latestDraft = recovered.sort((a, b) => b.recoveredAt - a.recoveredAt)[0];
    if (latestDraft) {
      setGraph(latestDraft.graph, { ...latestDraft, selected: chooseSelection(latestDraft.graph) });
      toast(state.conflictIds.has(latestDraft.graph.id) ? '已找回浏览器草稿。知识库有更新版本，请点击保存处理冲突。' : '已找回上次尚未保存的草稿。');
      return;
    }
  } else { state.draftStorageFailed = true; toast('浏览器草稿恢复不可用，请及时保存或导出。', true); }
  // Read the saved graph itself before marking anything as saved. In particular,
  // a modified saved demo must never be replaced by the pristine demo on reload.
  const latest = [...state.library].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (latest) {
    try { const graph = await request(`/api/graphs/${encodeURIComponent(latest.id)}`); setGraph(graph, { selected: chooseSelection(graph), saved: true }); return; }
    catch (error) { toast(`已保存图谱读取失败，正在展示未保存的示例：${error.message}`, true); }
  }
  if (state.demo) setGraph(state.demo, { selected: chooseSelection(state.demo), saved: false });
  else { $('#graph-title').textContent = '暂时无法打开示例'; $('#graph-description').textContent = results[0].reason.message; $('#crumb-title').textContent = '加载失败'; $('#save-state').textContent = '服务连接异常'; $('#canvas-empty').textContent = '请确认本地服务可用后刷新页面，或尝试导入一段对话。'; $('#canvas-empty').hidden = false; toast(results[0].reason.message, true); renderLibrary(); }
}
registerMobile().catch(() => { /* The online editor remains usable without installation. */ });
boot().then(async () => {
  const id = pendingMobileShareId();
  if (!id) return;
  try {
    const mobile = await readMobileShare(id);
    const existing = state.pendingImports.find(item => item.mobileShareId === id && (!mobile || item.mobileShareRevision === mobile.revision));
    if (existing) return openImport({ resume: existing });
    if (mobile) openImport({ mobile });
    else { clearPendingMobileShare(id); toast('这条手机导入已处理或过期，请回到手机收件箱重新选择。'); }
  } catch { toast('无法打开手机收件箱，请回到收件箱重试或直接选择对话文件。', true); }
});
