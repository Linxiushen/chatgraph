import { randomUUID } from 'node:crypto';
import { validateGraph } from './conversations.mjs';

function sessionsFor(graph) {
  return graph.sessions?.length ? graph.sessions : [{
    id: `session-${randomUUID()}`, title: graph.title, createdAt: graph.createdAt,
    mode: graph.mode, source: graph.source, sourceGraphId: graph.id,
    ...(graph.analysis ? { analysis: graph.analysis } : {}),
    messageIds: graph.messages.map(message => message.id), nodeIds: graph.nodes.map(node => node.id),
  }];
}

/** Only identical leaf assertions with identical evidence can merge automatically. */
function conceptKey(node, messages) {
  if (!node.sourceIds.length || node.type === 'topic') return null;
  const evidence = [...new Set(node.sourceIds.map(id => messages.get(id)).map(message => JSON.stringify([message.role, message.content])))].sort();
  return JSON.stringify([node.type, node.stance, node.status, node.label, node.summary, node.note, node.importance, evidence]);
}

/** Append actual supplied conversations, preserving both judgments and exact source text. */
export function appendGraphs(existingValue, incomingValue) {
  const existing = validateGraph(existingValue);
  const incoming = validateGraph(incomingValue);
  const prefix = `append-${randomUUID()}`;
  const messageMap = new Map(incoming.messages.map((message, index) => [message.id, `${prefix}-m${index + 1}`]));
  const nodeMap = new Map();
  const existingMessages = new Map(existing.messages.map(message => [message.id, message]));
  const incomingMessages = new Map(incoming.messages.map(message => [message.id, message]));
  const existingParents = new Set(existing.nodes.map(node => node.parentId).filter(Boolean));
  const incomingParents = new Set(incoming.nodes.map(node => node.parentId).filter(Boolean));
  const concepts = new Map();
  for (const node of existing.nodes) {
    if (existingParents.has(node.id)) continue;
    const key = conceptKey(node, existingMessages);
    // Ambiguity is preserved as separate nodes rather than selecting a match arbitrarily.
    if (key) concepts.set(key, concepts.has(key) ? null : node);
  }
  const newNodes = [];
  for (const [index, node] of incoming.nodes.entries()) {
    const key = !incomingParents.has(node.id) && conceptKey(node, incomingMessages);
    const matched = key && concepts.get(key);
    if (matched) {
      nodeMap.set(node.id, matched.id);
      matched.sourceIds = [...new Set([...matched.sourceIds, ...node.sourceIds.map(id => messageMap.get(id))])];
    } else {
      const id = `${prefix}-n${index + 1}`;
      nodeMap.set(node.id, id);
      newNodes.push({ ...node, id, sourceIds: node.sourceIds.map(id => messageMap.get(id)) });
    }
  }
  for (const node of newNodes) {
    node.parentId = node.parentId === null ? null : nodeMap.get(node.parentId);
    // Let the new branch receive an automatic layout without touching manual positions.
    delete node.x;
    delete node.y;
  }
  const root = existing.nodes.find(node => node.parentId === null && node.type === 'topic') || existing.nodes.find(node => node.parentId === null);
  const newRoots = newNodes.filter(node => node.parentId === null);
  if (root) for (const node of newRoots) node.parentId = root.id;
  const edges = [...existing.edges];
  const edgeKeys = new Set(edges.map(edge => JSON.stringify([edge.source, edge.target, edge.type, edge.label])));
  function addEdge(edge) {
    const key = JSON.stringify([edge.source, edge.target, edge.type, edge.label]);
    if (edge.source !== edge.target && !edgeKeys.has(key)) { edges.push(edge); edgeKeys.add(key); }
  }
  for (const [index, edge] of incoming.edges.entries()) addEdge({ ...edge, id: `${prefix}-e${index + 1}`, source: nodeMap.get(edge.source), target: nodeMap.get(edge.target) });
  if (root) for (const [index, node] of newRoots.entries()) addEdge({ id: `${prefix}-branch${index + 1}`, source: root.id, target: node.id, type: 'contains', label: '后续对话' });
  const sessions = [
    ...sessionsFor(existing),
    ...sessionsFor(incoming).map((session, index) => ({ ...session, id: `${prefix}-s${index + 1}`, messageIds: session.messageIds.map(id => messageMap.get(id)), nodeIds: [...new Set(session.nodeIds.map(id => nodeMap.get(id)))] })),
  ];
  const result = {
    ...existing, updatedAt: new Date().toISOString(),
    messages: [...existing.messages, ...incoming.messages.map(message => ({ ...message, id: messageMap.get(message.id) }))],
    nodes: [...existing.nodes, ...newNodes], edges, sessions,
  };
  // No source text is dropped if the resulting graph exceeds the bounded local format.
  return validateGraph(result);
}
