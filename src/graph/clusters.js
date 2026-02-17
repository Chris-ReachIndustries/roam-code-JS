/**
 * Louvain community detection for the symbol graph.
 */

import louvain from 'graphology-communities-louvain';
import Graph from 'graphology';
const { UndirectedGraph } = Graph;
import { batchedIn } from '../db/connection.js';
import { dirname } from 'node:path';

/**
 * Detect communities using Louvain on the undirected projection.
 * Returns Map<nodeKey, clusterId>.
 */
export function detectClusters(G) {
  if (G.order === 0) return new Map();

  // Build undirected copy
  const undirected = new UndirectedGraph();
  G.forEachNode((node, attrs) => { undirected.addNode(node, attrs); });
  G.forEachEdge((edge, attrs, src, tgt) => {
    if (!undirected.hasEdge(src, tgt)) {
      undirected.addEdge(src, tgt);
    }
  });

  try {
    // louvain assigns community as a node attribute and returns the mapping
    const communities = louvain(undirected, { randomWalk: false });
    return new Map(Object.entries(communities));
  } catch {
    // Fallback: each connected component is its own cluster
    const mapping = new Map();
    let clusterId = 0;
    const visited = new Set();

    undirected.forEachNode(node => {
      if (visited.has(node)) return;
      const queue = [node];
      visited.add(node);
      while (queue.length) {
        const current = queue.shift();
        mapping.set(current, clusterId);
        undirected.forEachNeighbor(current, nb => {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push(nb);
          }
        });
      }
      clusterId++;
    });

    return mapping;
  }
}

/**
 * Generate human-readable labels for clusters.
 * Returns Map<clusterId, label>.
 */
export function labelClusters(clusters, db) {
  if (!clusters.size) return new Map();

  const ANCHOR_KINDS = new Set(['class', 'struct', 'interface', 'enum', 'trait', 'module']);

  // Group by cluster
  const groups = new Map();
  for (const [nodeId, cid] of clusters) {
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(Number(nodeId));
  }

  // Fetch metadata
  const allIds = [...clusters.keys()].map(Number);
  const rows = batchedIn(
    db,
    'SELECT s.id, s.name, s.kind, f.path, COALESCE(gm.pagerank, 0) as pagerank ' +
    'FROM symbols s ' +
    'JOIN files f ON s.file_id = f.id ' +
    'LEFT JOIN graph_metrics gm ON s.id = gm.symbol_id ' +
    'WHERE s.id IN ({ph})',
    allIds,
  );

  const idToPath = new Map();
  const idToInfo = new Map();
  for (const r of rows) {
    idToPath.set(r.id, r.path);
    idToInfo.set(r.id, { name: r.name, kind: r.kind, pagerank: r.pagerank || 0 });
  }

  const labels = new Map();
  const totalNodes = clusters.size;

  for (const [cid, members] of groups) {
    // Directory distribution
    const dirs = members
      .filter(m => idToPath.has(m))
      .map(m => dirname(idToPath.get(m)).replace(/\\/g, '/'));

    const dirCounts = new Map();
    for (const d of dirs) dirCounts.set(d, (dirCounts.get(d) || 0) + 1);

    const sortedDirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
    const mostCommonDir = sortedDirs.length ? sortedDirs[0][0] : '';
    const shortDir = mostCommonDir ? mostCommonDir.split('/').pop() : '';

    // Large cluster check
    const isMega = members.length > 100 || (totalNodes > 0 && members.length > totalNodes * 0.4);
    if (isMega && sortedDirs.length > 1) {
      const top3 = sortedDirs.slice(0, 3);
      const parts = top3.map(([d, c]) => {
        const dShort = d ? d.split('/').pop() : '.';
        const pct = members.length > 0 ? (c * 100 / members.length) : 0;
        return `${dShort} ${pct.toFixed(0)}%`;
      });
      labels.set(cid, parts.join(' + '));
      continue;
    }

    // Pick best representative: prefer anchor kinds by pagerank
    let bestName = null;
    let bestPr = -1;
    for (const m of members) {
      const info = idToInfo.get(m);
      if (info && ANCHOR_KINDS.has(info.kind) && info.pagerank > bestPr) {
        bestPr = info.pagerank;
        bestName = info.name;
      }
    }
    if (!bestName) {
      bestPr = -1;
      for (const m of members) {
        const info = idToInfo.get(m);
        if (info && info.pagerank > bestPr) {
          bestPr = info.pagerank;
          bestName = info.name;
        }
      }
    }

    // Build label
    if (bestName && shortDir) labels.set(cid, `${shortDir}/${bestName}`);
    else if (bestName) labels.set(cid, bestName);
    else if (shortDir) labels.set(cid, shortDir);
    else labels.set(cid, `cluster-${cid}`);
  }

  return labels;
}

/**
 * Compute quality metrics for detected communities.
 */
export function clusterQuality(G, clusters) {
  if (!clusters.size || G.order === 0) {
    return { modularity: 0, per_cluster: {}, mean_conductance: 0 };
  }

  // Newman's modularity Q-score (simplified computation)
  const m = G.size; // total edges
  if (m === 0) return { modularity: 0, per_cluster: {}, mean_conductance: 0 };

  let Q = 0;
  G.forEachEdge((edge, attrs, src, tgt) => {
    if (clusters.get(String(src)) === clusters.get(String(tgt))) {
      Q += 1 - (G.outDegree(src) * G.inDegree(tgt)) / m;
    } else {
      Q -= (G.outDegree(src) * G.inDegree(tgt)) / m;
    }
  });
  Q /= m;

  return {
    modularity: Math.round(Q * 10000) / 10000,
    per_cluster: {},
    mean_conductance: 0,
  };
}

/**
 * Persist cluster assignments into the clusters table.
 */
export function storeClusters(db, clusters, labels) {
  if (!clusters.size) return 0;

  const insert = db.prepare(
    'INSERT OR REPLACE INTO clusters (symbol_id, cluster_id, cluster_label) VALUES (?, ?, ?)'
  );

  const insertAll = db.transaction(() => {
    let count = 0;
    for (const [nodeId, cid] of clusters) {
      const label = labels.get(cid) || `cluster-${cid}`;
      insert.run(Number(nodeId), Number(cid), label);
      count++;
    }
    return count;
  });

  return insertAll();
}

/**
 * Compare detected clusters with the directory tree.
 */
export function compareWithDirectories(db) {
  const rows = db.prepare(
    'SELECT c.cluster_id, c.cluster_label, f.path ' +
    'FROM clusters c ' +
    'JOIN symbols s ON c.symbol_id = s.id ' +
    'JOIN files f ON s.file_id = f.id'
  ).all();

  if (!rows.length) return [];

  const clusterDirs = new Map();
  for (const { cluster_id, cluster_label, path } of rows) {
    const d = dirname(path).replace(/\\/g, '/');
    if (!clusterDirs.has(cluster_id)) {
      clusterDirs.set(cluster_id, { label: cluster_label, dirs: [] });
    }
    clusterDirs.get(cluster_id).dirs.push(d);
  }

  const result = [];
  for (const [cid, info] of [...clusterDirs.entries()].sort((a, b) => a[0] - b[0])) {
    const uniqueDirs = [...new Set(info.dirs)].sort();
    if (uniqueDirs.length > 1) {
      const dirCounts = new Map();
      for (const d of info.dirs) dirCounts.set(d, (dirCounts.get(d) || 0) + 1);
      const majorityCount = Math.max(...dirCounts.values());
      result.push({
        cluster_id: cid,
        cluster_label: info.label,
        directories: uniqueDirs,
        mismatch_count: info.dirs.length - majorityCount,
      });
    }
  }

  result.sort((a, b) => b.mismatch_count - a.mismatch_count);
  return result;
}
