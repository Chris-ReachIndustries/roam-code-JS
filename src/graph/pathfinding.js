/**
 * K-shortest path finding (Yen's algorithm) for dependency trace.
 */

import { SYMBOL_BY_NAME, SYMBOL_BY_QUALIFIED, SEARCH_SYMBOLS, SYMBOL_BY_ID } from '../db/queries.js';

// Edge weights for path finding
const EDGE_WEIGHTS = { call: 1.0, uses: 1.0, inherits: 1.0, implements: 1.0, uses_trait: 1.0, template: 1.0, import: 1.1, reference: 1.2 };

/**
 * Find up to k shortest simple paths between source and target in a graphology graph.
 * Custom implementation of Yen's algorithm.
 */
export function findKPaths(G, sourceId, targetId, k = 3) {
  const src = String(sourceId);
  const tgt = String(targetId);

  if (!G.hasNode(src) || !G.hasNode(tgt)) return [];

  // BFS shortest path
  const firstPath = _bfsPath(G, src, tgt, false);
  if (!firstPath) {
    // Fallback: try undirected
    const undirPath = _bfsPath(G, src, tgt, true);
    return undirPath ? [undirPath.map(Number)] : [];
  }

  const A = [firstPath]; // accepted paths
  const B = [];          // candidate paths

  for (let i = 1; i < k; i++) {
    const prevPath = A[i - 1];

    for (let j = 0; j < prevPath.length - 1; j++) {
      const spurNode = prevPath[j];
      const rootPath = prevPath.slice(0, j + 1);

      // Temporarily remove edges that share the same root
      const removedEdges = [];
      for (const path of A) {
        if (path.length > j && _pathPrefix(path, rootPath)) {
          const u = path[j];
          const v = path[j + 1];
          G.forEachEdge(u, (edge, attrs, s, t) => {
            if (s === u && t === v) {
              removedEdges.push({ edge, attrs: { ...attrs }, source: s, target: t });
            }
          });
          for (const re of removedEdges) {
            try { G.dropEdge(re.edge); } catch { /* already removed */ }
          }
        }
      }

      // Temporarily remove root path nodes (except spur node)
      const removedNodes = new Set();
      for (const node of rootPath) {
        if (node !== spurNode) removedNodes.add(node);
      }

      const spurPath = _bfsPath(G, spurNode, tgt, false, removedNodes);

      // Restore edges
      for (const re of removedEdges) {
        try { G.addEdgeWithKey(re.edge, re.source, re.target, re.attrs); } catch { /* already exists */ }
      }

      if (spurPath) {
        const totalPath = [...rootPath.slice(0, -1), ...spurPath];
        const key = totalPath.join(',');
        if (!A.some(p => p.join(',') === key) && !B.some(p => p.join(',') === key)) {
          B.push(totalPath);
        }
      }
    }

    if (B.length === 0) break;

    // Sort candidates by path weight
    B.sort((a, b) => _pathWeight(G, a) - _pathWeight(G, b));
    A.push(B.shift());
  }

  return A.map(p => p.map(Number));
}

function _pathPrefix(path, prefix) {
  if (path.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

function _pathWeight(G, path) {
  let w = 0;
  for (let i = 0; i < path.length - 1; i++) {
    let minWeight = 2.0;
    G.forEachEdge(path[i], (edge, attrs, s, t) => {
      if (t === path[i + 1]) {
        const ew = EDGE_WEIGHTS[attrs.kind] || 1.0;
        minWeight = Math.min(minWeight, ew);
      }
    });
    w += minWeight;
  }
  return w;
}

function _bfsPath(G, src, tgt, undirected = false, excluded = new Set()) {
  const visited = new Set([src]);
  const parent = new Map();
  const queue = [src];

  while (queue.length) {
    const node = queue.shift();
    if (node === tgt) {
      const path = [tgt];
      let cur = tgt;
      while (parent.has(cur)) {
        cur = parent.get(cur);
        path.unshift(cur);
      }
      return path;
    }

    const neighbors = undirected
      ? G.neighbors(node)
      : G.outNeighbors(node);

    for (const nb of neighbors) {
      if (!visited.has(nb) && !excluded.has(nb)) {
        visited.add(nb);
        parent.set(nb, node);
        queue.push(nb);
      }
    }
  }
  return null;
}

/**
 * Find symbol IDs by name (exact → qualified → fuzzy).
 */
export function findSymbolId(db, name) {
  let rows = db.prepare(SYMBOL_BY_NAME).all(name);
  if (rows.length) return rows.map(r => r.id);

  rows = db.prepare(SYMBOL_BY_QUALIFIED).all(name);
  if (rows.length) return rows.map(r => r.id);

  rows = db.prepare(SEARCH_SYMBOLS).all(`%${name}%`, 5);
  return rows.map(r => r.id);
}

/**
 * Annotate path node IDs with symbol metadata.
 */
export function formatPath(path, db) {
  return path.map(id => {
    const row = db.prepare(SYMBOL_BY_ID).get(id);
    if (!row) return { id, name: `#${id}`, kind: '?', file_path: '?', line: null };
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      file_path: row.file_path,
      line: row.line_start,
    };
  });
}
