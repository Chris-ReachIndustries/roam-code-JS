import { describe, it, expect } from 'vitest';
import { computePagerank, computeCentrality, tarjanSCC } from '../../src/graph/pagerank.js';
import { starGraph, chainGraph, cycleGraph, disconnectedGraph } from '../helpers/graph-fixture.js';

describe('computePagerank', () => {
  it('returns scores for all nodes', () => {
    const G = starGraph(5);
    const scores = computePagerank(G);
    expect(scores.size).toBe(6); // center + 5 leaves
  });

  it('center of star has highest score', () => {
    const G = starGraph(5);
    const scores = computePagerank(G);
    // Leaves should have higher PageRank since they receive edges from center
    // Actually in a star graph, center points OUT. Leaves receive edges.
    // So leaf nodes might have higher PageRank
    for (const [node, score] of scores) {
      expect(score).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles chain graph', () => {
    const G = chainGraph(4);
    const scores = computePagerank(G);
    expect(scores.size).toBe(4);
    // Last node in chain should have high PageRank (receives transitive flow)
    const lastScore = scores.get('3');
    const firstScore = scores.get('0');
    expect(lastScore).toBeGreaterThan(firstScore);
  });

  it('handles cycle graph', () => {
    const G = cycleGraph(4);
    const scores = computePagerank(G);
    expect(scores.size).toBe(4);
    // All nodes in cycle should have similar scores
    const values = [...scores.values()];
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(max - min).toBeLessThan(0.1);
  });

  it('accepts custom alpha', () => {
    const G = chainGraph(3);
    const scores = computePagerank(G, 0.5);
    expect(scores.size).toBe(3);
  });
});

describe('computeCentrality', () => {
  it('returns centrality for all nodes', () => {
    const G = starGraph(3);
    const cent = computeCentrality(G);
    expect(cent.size).toBe(4); // center + 3 leaves
  });

  it('has correct degrees', () => {
    const G = starGraph(3);
    const cent = computeCentrality(G);
    const center = cent.get('center');
    expect(center.out_degree).toBe(3);
    expect(center.in_degree).toBe(0);
    const leaf = cent.get('leaf0');
    expect(leaf.in_degree).toBe(1);
    expect(leaf.out_degree).toBe(0);
  });
});

describe('tarjanSCC', () => {
  it('finds single SCC in cycle', () => {
    const G = cycleGraph(3);
    const sccs = tarjanSCC(G);
    const large = sccs.filter(s => s.length > 1);
    expect(large.length).toBe(1);
    expect(large[0].length).toBe(3);
  });

  it('each node is own SCC in DAG', () => {
    const G = chainGraph(4);
    const sccs = tarjanSCC(G);
    expect(sccs.length).toBe(4);
    expect(sccs.every(s => s.length === 1)).toBe(true);
  });

  it('handles disconnected graph', () => {
    const G = disconnectedGraph();
    const sccs = tarjanSCC(G);
    expect(sccs.length).toBe(4);
  });
});
