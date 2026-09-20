import test from 'node:test';
import assert from 'node:assert/strict';
import { descendantIds, reparentNode, reorderNode, removeNodes, timelineEvents } from '../public/editor-model.js';

function fixture() {
  return {
    nodes: [
      { id: 'root', type: 'topic', parentId: null, sourceIds: [] },
      { id: 'a', parentId: 'root', status: 'revised', sourceIds: ['m1', 'm3'] },
      { id: 'b', parentId: 'root', status: 'confirmed', sourceIds: ['m2'] },
      { id: 'child', parentId: 'a', status: 'open', sourceIds: [] },
    ],
    edges: [
      { id: 'e1', source: 'root', target: 'a', type: 'contains' },
      { id: 'e2', source: 'a', target: 'child', type: 'contains' },
      { id: 'e3', source: 'b', target: 'a', type: 'revises' },
    ],
    messages: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
    sessions: [{ id: 's1', nodeIds: ['root', 'a', 'b', 'child'], messageIds: ['m1', 'm2', 'm3'] }],
  };
}

test('reparent prevents cycles and preserves independent semantic relationships', () => {
  const graph = fixture(), original = structuredClone(graph);
  assert.deepEqual([...descendantIds(graph, 'a')], ['a', 'child']);
  assert.throws(() => reparentNode(graph, 'a', 'child', () => 'new'), /子节点/);
  assert.deepEqual(graph, original);
  reparentNode(graph, 'a', 'b', () => 'new');
  assert.equal(graph.nodes.find(node => node.id === 'a').parentId, 'b');
  assert.ok(!graph.edges.some(edge => edge.id === 'e1'));
  assert.ok(graph.edges.some(edge => edge.id === 'e3'));
  assert.ok(graph.edges.some(edge => edge.id === 'new' && edge.source === 'b' && edge.target === 'a'));
});

test('sibling reorder persists array order without moving descendants across parents', () => {
  const graph = fixture();
  assert.equal(reorderNode(graph, 'b', -1), true);
  assert.deepEqual(graph.nodes.filter(node => node.parentId === 'root').map(node => node.id), ['b', 'a']);
  assert.equal(graph.nodes.find(node => node.id === 'child').parentId, 'a');
  assert.equal(reorderNode(graph, 'b', -1), false);
});

test('batch deletion reparents surviving children and cleans session references', () => {
  const graph = fixture();
  removeNodes(graph, ['a'], () => 'reattached');
  assert.equal(graph.nodes.find(node => node.id === 'child').parentId, 'root');
  assert.ok(graph.edges.some(edge => edge.source === 'root' && edge.target === 'child'));
  assert.ok(graph.edges.every(edge => edge.source !== 'a' && edge.target !== 'a'));
  assert.deepEqual(graph.sessions[0].nodeIds, ['root', 'b', 'child']);
  const nested = fixture();
  removeNodes(nested, ['root', 'a'], () => 'new');
  assert.ok(nested.nodes.every(node => node.parentId === null));
});

test('timeline uses source order, retains relation direction, and leaves unsourced thoughts undated', () => {
  const events = timelineEvents(fixture());
  assert.equal(events[0].node.id, 'b');
  assert.equal(events[0].order, 1);
  assert.equal(events.at(-1).node.id, 'child');
  assert.equal(events.at(-1).order, -1);
  const revised = events.find(event => event.kind === 'revises');
  assert.equal(revised.node.id, 'b');
  assert.equal(revised.target.id, 'a');
  assert.equal(revised.order, 2);
});
