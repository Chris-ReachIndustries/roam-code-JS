/**
 * Topological layer detection and violation finding.
 */

import { tarjanSCC } from './pagerank.js';
import { batchedIn } from '../db/connection.js';

/**
 * Build condensation DAG from SCC decomposition.
 * Returns { nodeToScc, sccAdj, sccCount }.
 */
function condensation(G) {
  const sccs = tarjanSCC(G);

  // Map each node to its SCC index
  const nodeToScc = new Map();
  sccs.forEach((scc, idx) => {
    for (const node of scc) {
      nodeToScc.set(String(node), idx);
    }
  });

  // Build adjacency list for the condensed DAG
  const sccAdj = new Map(); // sccId -> Set<sccId>
  const sccPreds = new Map(); // sccId -> Set<sccId>
  for (let i = 0; i < sccs.length; i++) {
    sccAdj.set(i, new Set());
    sccPreds.set(i, new Set());
  }

  G.forEachEdge((edge, attrs, src, tgt) => {
    const srcScc = nodeToScc.get(String(src));
    const tgtScc = nodeToScc.get(String(tgt));
    if (srcScc !== tgtScc) {
      sccAdj.get(srcScc).add(tgtScc);
      sccPreds.get(tgtScc).add(srcScc);
    }
  });

  return { nodeToScc, sccAdj, sccPreds, sccCount: sccs.length };
}

/**
 * Kahn's topological sort on the condensed DAG.
 * Returns array of sccIds in topological order.
 */
function topoSort(sccAdj, sccPreds, sccCount) {
  const inDegree = new Map();
  for (let i = 0; i < sccCount; i++) {
    inDegree.set(i, sccPreds.get(i).size);
  }

  const queue = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const order = [];
  while (queue.length) {
    const current = queue.shift();
    order.push(current);
    for (const nb of sccAdj.get(current)) {
      inDegree.set(nb, inDegree.get(nb) - 1);
      if (inDegree.get(nb) === 0) queue.push(nb);
    }
  }

  return order;
}

/**
 * Assign a layer number to every node using longest-path from sources.
 * Cycles are handled by condensing the graph into a DAG of SCCs.
 * Returns Map<nodeKey, layerNumber>.
 */
export function detectLayers(G) {
  if (G.order === 0) return new Map();

  const { nodeToScc, sccAdj, sccPreds, sccCount } = condensation(G);

  // Compute layers on the condensed DAG
  const sccLayers = new Map();
  const order = topoSort(sccAdj, sccPreds, sccCount);

  for (const sccNode of order) {
    const preds = sccPreds.get(sccNode);
    if (!preds || preds.size === 0) {
      sccLayers.set(sccNode, 0);
    } else {
      let maxLayer = 0;
      for (const p of preds) {
        maxLayer = Math.max(maxLayer, sccLayers.get(p) || 0);
      }
      sccLayers.set(sccNode, maxLayer + 1);
    }
  }

  // Map back to original nodes
  const layers = new Map();
  G.forEachNode(node => {
    const sccId = nodeToScc.get(String(node));
    layers.set(String(node), sccLayers.get(sccId) || 0);
  });

  return layers;
}

/**
 * Find edges that go upward from a higher layer to a lower layer.
 * Returns array of violation objects with severity.
 */
export function findViolations(G, layers) {
  const violations = [];
  const maxLayer = Math.max(1, ...layers.values());

  G.forEachEdge((edge, attrs, src, tgt) => {
    const srcLayer = layers.get(String(src));
    const tgtLayer = layers.get(String(tgt));
    if (srcLayer == null || tgtLayer == null) return;

    if (srcLayer > tgtLayer) {
      const distance = srcLayer - tgtLayer;
      violations.push({
        source: Number(src),
        target: Number(tgt),
        source_layer: srcLayer,
        target_layer: tgtLayer,
        layer_distance: distance,
        severity: Math.round(distance / maxLayer * 1000) / 1000,
      });
    }
  });

  return violations;
}

/**
 * Annotate layer assignments with symbol metadata.
 */
export function formatLayers(layers, db) {
  if (!layers.size) return [];

  const allIds = [...layers.keys()].map(Number);
  const lookup = new Map();

  const rows = batchedIn(
    db,
    'SELECT s.id, s.name, s.kind, f.path AS file_path ' +
    'FROM symbols s JOIN files f ON s.file_id = f.id ' +
    'WHERE s.id IN ({ph})',
    allIds,
  );
  for (const r of rows) {
    lookup.set(r.id, { id: r.id, name: r.name, kind: r.kind, file_path: r.file_path });
  }

  // Group by layer
  const layerGroups = new Map();
  for (const [nodeId, layer] of layers) {
    const id = Number(nodeId);
    if (!lookup.has(id)) continue;
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer).push(lookup.get(id));
  }

  return [...layerGroups.keys()]
    .sort((a, b) => a - b)
    .map(layer => ({
      layer,
      symbols: layerGroups.get(layer).sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
