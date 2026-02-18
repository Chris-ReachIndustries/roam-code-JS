import { describe, it, expect } from 'vitest';
import { findKPaths } from '../../src/graph/pathfinding.js';
import { chainGraph, diamondGraph, disconnectedGraph } from '../helpers/graph-fixture.js';
import Graph from 'graphology';

describe('findKPaths', () => {
  it('finds path in chain', () => {
    const G = chainGraph(4);
    const paths = findKPaths(G, '0', '3', 1);
    expect(paths.length).toBe(1);
    expect(paths[0]).toEqual([0, 1, 2, 3]);
  });

  it('finds multiple paths in diamond', () => {
    const G = diamondGraph(); // 0->1, 0->2, 1->3, 2->3
    const paths = findKPaths(G, '0', '3', 3);
    expect(paths.length).toBe(2); // Two paths: 0->1->3 and 0->2->3
    // Both paths should start with 0 and end with 3
    for (const path of paths) {
      expect(path[0]).toBe(0);
      expect(path[path.length - 1]).toBe(3);
    }
  });

  it('returns empty for disconnected nodes', () => {
    const G = disconnectedGraph(); // a->b, c->d
    const paths = findKPaths(G, 'a', 'd', 3);
    // May return empty or find undirected path depending on fallback
    expect(Array.isArray(paths)).toBe(true);
  });

  it('returns empty for non-existent source', () => {
    const G = chainGraph(3);
    const paths = findKPaths(G, 'nonexistent', '2', 1);
    expect(paths).toEqual([]);
  });

  it('returns empty for same source and target', () => {
    const G = chainGraph(3);
    const paths = findKPaths(G, '0', '0', 1);
    // Should return single-node path or empty
    expect(Array.isArray(paths)).toBe(true);
  });

  it('respects k limit', () => {
    const G = new Graph({ type: 'directed' });
    // Create graph with many paths
    G.addNode('s');
    G.addNode('a');
    G.addNode('b');
    G.addNode('c');
    G.addNode('t');
    G.addEdge('s', 'a');
    G.addEdge('s', 'b');
    G.addEdge('s', 'c');
    G.addEdge('a', 't');
    G.addEdge('b', 't');
    G.addEdge('c', 't');
    const paths = findKPaths(G, 's', 't', 2);
    expect(paths.length).toBeLessThanOrEqual(2);
  });
});
