/**
 * Adjacency list builders and BFS traversal for graph-heavy commands.
 */

/**
 * Build forward adjacency: source_id -> Set of target_ids.
 */
export function buildForwardAdj(db) {
  const adj = new Map();
  const rows = db.prepare('SELECT source_id, target_id FROM edges').all();
  for (const r of rows) {
    if (!adj.has(r.source_id)) adj.set(r.source_id, new Set());
    adj.get(r.source_id).add(r.target_id);
  }
  return adj;
}

/**
 * Build reverse adjacency: target_id -> Set of source_ids.
 */
export function buildReverseAdj(db) {
  const adj = new Map();
  const rows = db.prepare('SELECT source_id, target_id FROM edges').all();
  for (const r of rows) {
    if (!adj.has(r.target_id)) adj.set(r.target_id, new Set());
    adj.get(r.target_id).add(r.source_id);
  }
  return adj;
}

/**
 * BFS through an adjacency map from a set of starting nodes.
 * Returns Set of all reachable node IDs (excluding start).
 */
export function bfsReachable(adj, startIds, maxDepth = 10) {
  const visited = new Set();
  let frontier = new Set(startIds);

  for (let depth = 0; depth < maxDepth; depth++) {
    const next = new Set();
    for (const id of frontier) {
      const neighbors = adj.get(id);
      if (!neighbors) continue;
      for (const nb of neighbors) {
        if (!visited.has(nb) && !startIds.has(nb)) {
          visited.add(nb);
          next.add(nb);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return visited;
}
