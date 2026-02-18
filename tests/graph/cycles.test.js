import { describe, it, expect } from 'vitest';
import { findCycles, propagationCost } from '../../src/graph/cycles.js';
import { cycleGraph, chainGraph, diamondGraph, disconnectedGraph } from '../helpers/graph-fixture.js';

describe('findCycles', () => {
  it('finds a simple cycle', () => {
    const G = cycleGraph(3); // 0 -> 1 -> 2 -> 0
    const cycles = findCycles(G);
    expect(cycles.length).toBe(1);
    expect(cycles[0].length).toBe(3);
  });

  it('returns empty for DAG', () => {
    const G = chainGraph(5); // 0 -> 1 -> 2 -> 3 -> 4
    const cycles = findCycles(G);
    expect(cycles).toEqual([]);
  });

  it('returns empty for empty graph', async () => {
    const Graph = (await import('graphology')).default;
    const G = new Graph({ type: 'directed' });
    const cycles = findCycles(G);
    expect(cycles).toEqual([]);
  });

  it('filters by minSize', () => {
    const G = cycleGraph(3);
    const cycles = findCycles(G, 5); // min size 5
    expect(cycles).toEqual([]);
  });

  it('finds cycles in diamond with back-edge', () => {
    const G = diamondGraph(); // 0->1, 0->2, 1->3, 2->3
    G.addEdge('3', '0'); // Create cycle
    const cycles = findCycles(G);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });
});

describe('propagationCost', () => {
  it('returns 0 for empty graph', async () => {
    const Graph = (await import('graphology')).default;
    const G = new Graph({ type: 'directed' });
    expect(propagationCost(G)).toBe(0);
  });

  it('returns high cost for fully connected cycle', () => {
    const G = cycleGraph(4);
    const cost = propagationCost(G);
    expect(cost).toBeGreaterThan(0.5);
    expect(cost).toBeLessThanOrEqual(1);
  });

  it('returns lower cost for chain', () => {
    const G = chainGraph(5);
    const cost = propagationCost(G);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  it('returns lower cost for disconnected graph', () => {
    const G = disconnectedGraph();
    const cost = propagationCost(G);
    expect(cost).toBeLessThan(0.5);
  });
});
