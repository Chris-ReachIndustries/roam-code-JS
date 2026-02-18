/**
 * Test helpers for creating graph fixtures.
 */

import Graph from 'graphology';

/**
 * Create a linear chain graph: 0 -> 1 -> 2 -> ... -> n-1
 */
export function chainGraph(n) {
  const G = new Graph({ type: 'directed' });
  for (let i = 0; i < n; i++) G.addNode(String(i));
  for (let i = 0; i < n - 1; i++) G.addEdge(String(i), String(i + 1));
  return G;
}

/**
 * Create a cycle graph: 0 -> 1 -> 2 -> ... -> n-1 -> 0
 */
export function cycleGraph(n) {
  const G = chainGraph(n);
  G.addEdge(String(n - 1), '0');
  return G;
}

/**
 * Create a diamond graph: 0 -> 1, 0 -> 2, 1 -> 3, 2 -> 3
 */
export function diamondGraph() {
  const G = new Graph({ type: 'directed' });
  G.addNode('0');
  G.addNode('1');
  G.addNode('2');
  G.addNode('3');
  G.addEdge('0', '1');
  G.addEdge('0', '2');
  G.addEdge('1', '3');
  G.addEdge('2', '3');
  return G;
}

/**
 * Create a star graph with a center node and `leaves` leaf nodes.
 */
export function starGraph(leaves) {
  const G = new Graph({ type: 'directed' });
  G.addNode('center');
  for (let i = 0; i < leaves; i++) {
    G.addNode(`leaf${i}`);
    G.addEdge('center', `leaf${i}`);
  }
  return G;
}

/**
 * Create a disconnected graph with two components.
 */
export function disconnectedGraph() {
  const G = new Graph({ type: 'directed' });
  // Component 1
  G.addNode('a');
  G.addNode('b');
  G.addEdge('a', 'b');
  // Component 2
  G.addNode('c');
  G.addNode('d');
  G.addEdge('c', 'd');
  return G;
}

/**
 * Create a complete directed graph with n nodes.
 */
export function completeGraph(n) {
  const G = new Graph({ type: 'directed' });
  for (let i = 0; i < n; i++) G.addNode(String(i));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) G.addEdge(String(i), String(j));
    }
  }
  return G;
}
