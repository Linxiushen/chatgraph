// Pure graph operations shared by the editor and its regression tests.
export function descendantIds(graph, id) {
  const result = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const node of graph.nodes) if (result.has(node.parentId) && !result.has(node.id)) {
      result.add(node.id); added = true;
    }
  }
  return result;
}

export function reparentNode(graph, id, parentId, makeId) {
  const node = graph.nodes.find(item => item.id === id);
  if (!node) throw new Error('找不到这个观点。');
  if (parentId && !graph.nodes.some(item => item.id === parentId)) throw new Error('找不到上级观点。');
  if (parentId && descendantIds(graph, id).has(parentId)) throw new Error('不能将观点移入自己或自己的子节点。');
  const previousParent = node.parentId;
  node.parentId = parentId || null;
  graph.edges = graph.edges.filter(edge => !(edge.type === 'contains' && edge.target === id && edge.source === previousParent));
  if (parentId && !graph.edges.some(edge => edge.type === 'contains' && edge.source === parentId && edge.target === id)) {
    graph.edges.push({ id: makeId(), source: parentId, target: id, type: 'contains', label: '' });
  }
  // Array order is the durable sibling order used by outline and exports.
  graph.nodes = graph.nodes.filter(item => item.id !== id);
  const siblings = graph.nodes.map((item, index) => ({ item, index })).filter(({ item }) => item.parentId === node.parentId);
  graph.nodes.splice(siblings.length ? siblings.at(-1).index + 1 : graph.nodes.length, 0, node);
}

export function reorderNode(graph, id, direction) {
  const node = graph.nodes.find(item => item.id === id);
  if (!node) return false;
  const siblings = graph.nodes.filter(item => (item.parentId || null) === (node.parentId || null));
  const sibling = siblings[siblings.indexOf(node) + direction];
  if (!sibling) return false;
  const a = graph.nodes.indexOf(node), b = graph.nodes.indexOf(sibling);
  [graph.nodes[a], graph.nodes[b]] = [graph.nodes[b], graph.nodes[a]];
  return true;
}

export function removeNodes(graph, ids, makeId) {
  const removed = new Set(ids), byId = new Map(graph.nodes.map(node => [node.id, node]));
  if (graph.nodes.every(node => removed.has(node.id))) throw new Error('图谱需要至少保留一个观点。若不再需要这张图谱，可以在知识库中删除整张图谱。');
  for (const node of graph.nodes) {
    if (removed.has(node.id) || !removed.has(node.parentId)) continue;
    let parentId = node.parentId;
    const seen = new Set();
    while (removed.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId); parentId = byId.get(parentId)?.parentId || null;
    }
    node.parentId = seen.has(parentId) ? null : parentId;
    if (node.parentId && !graph.edges.some(edge => edge.type === 'contains' && edge.source === node.parentId && edge.target === node.id)) {
      graph.edges.push({ id: makeId(), source: node.parentId, target: node.id, type: 'contains', label: '' });
    }
  }
  graph.nodes = graph.nodes.filter(node => !removed.has(node.id));
  graph.edges = graph.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target));
  for (const session of graph.sessions || []) session.nodeIds = (session.nodeIds || []).filter(id => !removed.has(id));
}

export function timelineEvents(graph) {
  const messageOrder = new Map(graph.messages.map((message, index) => [message.id, index]));
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const orderOf = node => Math.max(-1, ...(node.sourceIds || []).map(id => messageOrder.get(id) ?? -1));
  const events = [];
  for (const node of graph.nodes) {
    if (node.type === 'topic') continue;
    events.push({ kind: 'judgment', node, order: orderOf(node), sourceIds: node.sourceIds || [] });
  }
  for (const edge of graph.edges) {
    if (!['revises', 'challenges'].includes(edge.type)) continue;
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target) continue;
    events.push({ kind: edge.type, edge, node: source, target, order: Math.max(orderOf(source), orderOf(target)), sourceIds: [...new Set([...(source.sourceIds || []), ...(target.sourceIds || [])])] });
  }
  return events.sort((a, b) => (a.order < 0 ? Infinity : a.order) - (b.order < 0 ? Infinity : b.order));
}
