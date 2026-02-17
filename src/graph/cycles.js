/**
 * Tarjan SCC / cycle detection for the symbol graph.
 */

import { batchedIn } from '../db/connection.js';
import { tarjanSCC } from './pagerank.js';

/**
 * Return strongly connected components with at least minSize members.
 * Components are sorted by size descending, each sorted internally.
 */
export function findCycles(G, minSize = 2) {
  if (G.order === 0) return [];

  const sccs = tarjanSCC(G)
    .filter(c => c.length >= minSize)
    .map(c => c.map(Number).sort((a, b) => a - b));

  sccs.sort((a, b) => b.length - a.length);
  return sccs;
}

/**
 * Annotate each cycle with symbol names and file paths.
 */
export function formatCycles(cycles, db) {
  if (!cycles.length) return [];

  const allIds = new Set();
  for (const cycle of cycles) {
    for (const sid of cycle) allIds.add(sid);
  }
  if (!allIds.size) return [];

  const rows = batchedIn(
    db,
    'SELECT s.id, s.name, s.kind, f.path AS file_path ' +
    'FROM symbols s JOIN files f ON s.file_id = f.id ' +
    'WHERE s.id IN ({ph})',
    [...allIds],
  );

  const lookup = new Map();
  for (const r of rows) {
    lookup.set(r.id, { id: r.id, name: r.name, kind: r.kind, file_path: r.file_path });
  }

  return cycles.map(cycle => {
    const symbols = cycle.filter(sid => lookup.has(sid)).map(sid => lookup.get(sid));
    const files = [...new Set(symbols.map(s => s.file_path))].sort();
    return { symbols, files, size: cycle.length };
  });
}

/**
 * Compute Propagation Cost (MacCormack et al. 2006).
 * PC = fraction of system potentially affected by a change.
 * Returns value in [0, 1].
 */
export function propagationCost(G) {
  const n = G.order;
  if (n <= 1) return 0;

  // BFS from each node to compute transitive closure size
  let totalReachable = 0;
  G.forEachNode(start => {
    const visited = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      G.forEachOutNeighbor(current, nb => {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      });
    }
    totalReachable += visited.size - 1; // exclude self
  });

  return Math.round(totalReachable / (n * (n - 1)) * 10000) / 10000;
}

/**
 * Compute algebraic connectivity (Fiedler value).
 * Returns 0.0 — full implementation requires eigenvector computation.
 * Graceful degradation per plan.
 */
export function algebraicConnectivity(G) {
  // Full implementation would need a Laplacian eigensolver.
  // Return 0.0 as graceful degradation (noted in the architecture plan).
  return 0.0;
}

/**
 * Find the single edge in an SCC whose removal most likely breaks the cycle.
 * Uses degree-based heuristic.
 */
export function findWeakestEdge(G, sccMembers) {
  const memberSet = new Set(sccMembers.map(String));
  if (memberSet.size < 2) return null;

  // Collect internal edges
  const internalEdges = [];
  G.forEachEdge((edge, attrs, src, tgt) => {
    if (memberSet.has(String(src)) && memberSet.has(String(tgt))) {
      internalEdges.push([src, tgt]);
    }
  });
  if (!internalEdges.length) return null;

  // For small SCCs, use edge betweenness approximation via degree heuristic
  // (graphology doesn't have built-in edge betweenness)
  const outDeg = new Map();
  const inDeg = new Map();
  for (const [u, v] of internalEdges) {
    outDeg.set(u, (outDeg.get(u) || 0) + 1);
    inDeg.set(v, (inDeg.get(v) || 0) + 1);
  }

  let bestEdge = null;
  let bestScore = [-1, -1];
  for (const [u, v] of internalEdges) {
    const score = [outDeg.get(u) || 0, inDeg.get(v) || 0];
    if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
      bestScore = score;
      bestEdge = [u, v];
    }
  }

  if (!bestEdge) return null;

  const [u, v] = bestEdge;
  const srcOut = outDeg.get(u) || 0;
  const tgtIn = inDeg.get(v) || 0;
  const reason = `source has ${srcOut} outgoing edge${srcOut !== 1 ? 's' : ''} in cycle, ` +
    `target has ${tgtIn} incoming`;
  return [Number(u), Number(v), reason];
}
