import { describe, it, expect } from 'vitest';
import { detectClusters, clusterQuality } from '../../src/graph/clusters.js';
import { disconnectedGraph, chainGraph, completeGraph } from '../helpers/graph-fixture.js';
import Graph from 'graphology';

describe('detectClusters', () => {
  it('detects separate components', () => {
    const G = disconnectedGraph(); // a->b, c->d
    const clusters = detectClusters(G);
    expect(clusters.size).toBe(4);
    // a and b should be in same cluster
    expect(clusters.get('a')).toBe(clusters.get('b'));
    // c and d should be in same cluster
    expect(clusters.get('c')).toBe(clusters.get('d'));
    // The two components should be different clusters
    expect(clusters.get('a')).not.toBe(clusters.get('c'));
  });

  it('returns clusters for single node', () => {
    const G = new Graph({ type: 'directed' });
    G.addNode('x');
    const clusters = detectClusters(G);
    expect(clusters.size).toBe(1);
    expect(clusters.has('x')).toBe(true);
  });

  it('handles empty graph', () => {
    const G = new Graph({ type: 'directed' });
    const clusters = detectClusters(G);
    expect(clusters.size).toBe(0);
  });

  it('assigns clusters to chain', () => {
    const G = chainGraph(5);
    const clusters = detectClusters(G);
    expect(clusters.size).toBe(5);
  });

  it('assigns clusters to complete graph', () => {
    const G = completeGraph(4);
    const clusters = detectClusters(G);
    expect(clusters.size).toBe(4);
    // In a complete graph, Louvain may put all in one cluster
    const clusterIds = new Set(clusters.values());
    expect(clusterIds.size).toBeGreaterThanOrEqual(1);
  });
});

describe('clusterQuality', () => {
  it('returns modularity metrics', () => {
    const G = disconnectedGraph();
    const clusters = detectClusters(G);
    const quality = clusterQuality(G, clusters);
    expect(quality).toHaveProperty('modularity');
    expect(typeof quality.modularity).toBe('number');
  });
});
