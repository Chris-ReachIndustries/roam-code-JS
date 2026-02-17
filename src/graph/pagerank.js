/**
 * PageRank and centrality metrics for the symbol graph.
 */

import pagerank from 'graphology-metrics/centrality/pagerank.js';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness.js';

/**
 * Choose PageRank damping factor based on graph cyclicity.
 * DAG-like → 0.92, fully cyclic → 0.82.
 */
function optimalAlpha(G) {
  const sccList = tarjanSCC(G);
  const sccNodes = sccList
    .filter(c => c.length > 1)
    .reduce((sum, c) => sum + c.length, 0);
  const cycleRatio = G.order > 0 ? sccNodes / G.order : 0;
  return Math.round((0.92 - 0.10 * cycleRatio) * 1000) / 1000;
}

/**
 * Simple Tarjan's SCC for alpha calculation.
 * Returns array of arrays of node keys.
 */
function tarjanSCC(G) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlinks = new Map();
  const sccs = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    G.forEachOutNeighbor(v, w => {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    });

    if (lowlinks.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  G.forEachNode(v => {
    if (!indices.has(v)) strongconnect(v);
  });

  return sccs;
}

/**
 * Compute PageRank scores for every node.
 * Returns Map<nodeKey, score>.
 */
export function computePagerank(G, alpha = null) {
  if (G.order === 0) return new Map();
  if (alpha === null) alpha = optimalAlpha(G);

  try {
    const scores = pagerank(G, { alpha, maxIterations: 100, tolerance: 1e-6 });
    return new Map(Object.entries(scores));
  } catch {
    // Fallback: degree-based ranking
    const maxDeg = Math.max(1, ...G.mapNodes(n => G.degree(n)));
    const result = new Map();
    G.forEachNode(n => { result.set(n, G.degree(n) / maxDeg); });
    return result;
  }
}

/**
 * Compute in-degree, out-degree, and betweenness centrality.
 * Returns Map<nodeKey, {in_degree, out_degree, betweenness}>.
 */
export function computeCentrality(G) {
  if (G.order === 0) return new Map();

  // Adaptive sampling for betweenness
  const n = G.order;
  let bw;
  try {
    if (n <= 1000) {
      bw = betweennessCentrality(G, { normalized: false });
    } else {
      // graphology betweenness doesn't support k-sampling, use full but with reasonable graph sizes
      bw = betweennessCentrality(G, { normalized: false });
    }
  } catch {
    bw = {};
  }

  const result = new Map();
  G.forEachNode(node => {
    result.set(node, {
      in_degree: G.inDegree(node),
      out_degree: G.outDegree(node),
      betweenness: bw[node] || 0,
    });
  });
  return result;
}

/**
 * Compute and persist all graph metrics into the graph_metrics table.
 * Returns the number of rows written.
 */
export function storeMetrics(db, G) {
  if (G.order === 0) return 0;

  const pr = computePagerank(G);
  const centrality = computeCentrality(G);

  const insert = db.prepare(
    'INSERT OR REPLACE INTO graph_metrics ' +
    '(symbol_id, pagerank, in_degree, out_degree, betweenness) ' +
    'VALUES (?, ?, ?, ?, ?)'
  );

  const insertAll = db.transaction(() => {
    let count = 0;
    G.forEachNode(node => {
      const c = centrality.get(node) || {};
      insert.run(
        Number(node),
        pr.get(node) || 0,
        c.in_degree || 0,
        c.out_degree || 0,
        c.betweenness || 0,
      );
      count++;
    });
    return count;
  });

  return insertAll();
}

// Export tarjanSCC for use by cycles.js
export { tarjanSCC };
