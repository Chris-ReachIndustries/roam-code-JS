/**
 * roam trace — Find shortest dependency paths between two symbols.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { buildSymbolGraph } from '../graph/builder.js';
import { findKPaths, findSymbolId, formatPath } from '../graph/pathfinding.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const k = opts.k || 3;

    const sourceIds = findSymbolId(db, opts.source);
    const targetIds = findSymbolId(db, opts.target);

    if (!sourceIds.length) {
      console.error(`Source symbol '${opts.source}' not found.`);
      process.exit(1);
    }
    if (!targetIds.length) {
      console.error(`Target symbol '${opts.target}' not found.`);
      process.exit(1);
    }

    const G = buildSymbolGraph(db);

    // Try all source→target combinations, collect best paths
    const allPaths = [];
    for (const sid of sourceIds) {
      for (const tid of targetIds) {
        if (sid === tid) continue;
        const paths = findKPaths(G, sid, tid, k);
        for (const p of paths) allPaths.push(p);
      }
    }

    // Dedup and sort by length
    const seen = new Set();
    const uniquePaths = [];
    for (const p of allPaths) {
      const key = p.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        uniquePaths.push(p);
      }
    }
    uniquePaths.sort((a, b) => a.length - b.length);
    const finalPaths = uniquePaths.slice(0, k);

    if (!finalPaths.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('trace', {
          summary: { source: opts.source, target: opts.target, paths: 0 },
          paths: [],
        })));
      } else {
        console.log(`No path found between '${opts.source}' and '${opts.target}'.`);
      }
      return;
    }

    // Annotate paths
    const annotated = finalPaths.map(p => formatPath(p, db));

    // Coupling classification based on shortest path length
    const shortest = finalPaths[0].length - 1; // hops
    let coupling = 'weak';
    if (shortest === 1) coupling = 'strong';
    else if (shortest === 2) coupling = 'moderate';
    else if (shortest <= 4) coupling = 'structural';

    // Hub detection: nodes with degree > 50
    const hubThreshold = 50;
    const hubNodes = new Set();
    for (const p of finalPaths) {
      for (const nodeId of p) {
        const nk = String(nodeId);
        if (G.hasNode(nk) && G.degree(nk) > hubThreshold) {
          hubNodes.add(nodeId);
        }
      }
    }

    // Path quality scoring
    const scoredPaths = annotated.map((path, idx) => {
      const hops = path.length - 1;
      const directness = hops > 0 ? 1 / hops : 1;
      const hubCount = finalPaths[idx].filter(n => hubNodes.has(n)).length;
      const hubPenalty = hubCount * 0.1;
      const couplingScore = coupling === 'strong' ? 1.0 : coupling === 'moderate' ? 0.7 : coupling === 'structural' ? 0.4 : 0.2;
      const quality = Math.max(0, couplingScore * 0.7 + directness * 0.3 - hubPenalty);
      return { path, hops, quality: Math.round(quality * 1000) / 1000, hubCount };
    });

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('trace', {
        summary: {
          source: opts.source,
          target: opts.target,
          paths: finalPaths.length,
          coupling,
          hubs: hubNodes.size,
        },
        paths: scoredPaths.map(sp => ({
          hops: sp.hops,
          quality: sp.quality,
          hub_count: sp.hubCount,
          steps: sp.path.map(n => ({
            name: n.name,
            kind: n.kind,
            location: loc(n.file_path, n.line),
          })),
        })),
      })));
    } else {
      console.log(`=== Trace: ${opts.source} → ${opts.target} ===\n`);
      console.log(`Coupling: ${coupling}  |  Paths found: ${finalPaths.length}  |  Hubs: ${hubNodes.size}\n`);

      for (let i = 0; i < scoredPaths.length; i++) {
        const sp = scoredPaths[i];
        console.log(`Path ${i + 1} (${sp.hops} hops, quality: ${sp.quality}):`);
        for (let j = 0; j < sp.path.length; j++) {
          const n = sp.path[j];
          const isHub = hubNodes.has(finalPaths[i][j]) ? ' [HUB]' : '';
          const arrow = j < sp.path.length - 1 ? ' →' : '';
          console.log(`  ${abbrevKind(n.kind)}  ${n.name}  ${loc(n.file_path, n.line)}${isHub}${arrow}`);
        }
        console.log('');
      }
    }
  } finally {
    db.close();
  }
}
