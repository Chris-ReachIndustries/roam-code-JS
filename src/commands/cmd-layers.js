/**
 * roam layers — Show topological dependency layers with architecture analysis.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { buildSymbolGraph } from '../graph/builder.js';
import { detectLayers, findViolations, formatLayers, condensation, topoSort } from '../graph/layers.js';
import { dirname } from 'node:path';
import { batchedIn } from '../db/connection.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;

    const G = buildSymbolGraph(db);
    if (G.order === 0) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('layers', { summary: { layers: 0 }, layers: [] })));
      } else {
        console.log('No symbols found. Run `roam index` first.');
      }
      return;
    }

    const layers = detectLayers(G);
    const violations = findViolations(G, layers);
    const formatted = formatLayers(layers, db);

    const maxLayer = Math.max(0, ...layers.values());
    const totalSymbols = G.order;

    // Architecture classification
    let archType = 'flat';
    if (maxLayer >= 6) archType = 'well-layered';
    else if (maxLayer >= 3) archType = 'moderate';

    // Per-layer directory breakdown + top-5 symbols by PageRank
    const layerDetails = [];
    for (const layerGroup of formatted) {
      const dirs = new Map();
      for (const s of layerGroup.symbols) {
        const d = dirname(s.file_path).replace(/\\/g, '/');
        dirs.set(d, (dirs.get(d) || 0) + 1);
      }
      const sortedDirs = [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

      // Get PageRank for top symbols
      const symIds = layerGroup.symbols.map(s => s.id);
      let topByPr = [];
      if (symIds.length) {
        topByPr = batchedIn(
          db,
          'SELECT s.id, s.name, s.kind, f.path as file_path, COALESCE(gm.pagerank, 0) as pagerank ' +
          'FROM symbols s JOIN files f ON s.file_id = f.id ' +
          'LEFT JOIN graph_metrics gm ON s.id = gm.symbol_id ' +
          'WHERE s.id IN ({ph}) ORDER BY COALESCE(gm.pagerank, 0) DESC LIMIT 5',
          symIds,
        );
      }

      layerDetails.push({
        layer: layerGroup.layer,
        count: layerGroup.symbols.length,
        directories: sortedDirs,
        topSymbols: topByPr,
      });
    }

    // Deepest dependency chain via condensation DAG
    const { sccAdj, sccPreds, sccCount } = condensation(G);
    const order = topoSort(sccAdj, sccPreds, sccCount);
    // Longest path in condensation DAG
    const dist = new Map();
    for (const scc of order) dist.set(scc, 0);
    for (const scc of order) {
      for (const nb of sccAdj.get(scc)) {
        dist.set(nb, Math.max(dist.get(nb), dist.get(scc) + 1));
      }
    }
    const deepestChainLength = Math.max(0, ...dist.values());

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('layers', {
        summary: {
          layers: maxLayer + 1,
          total_symbols: totalSymbols,
          violations: violations.length,
          architecture: archType,
          deepest_chain: deepestChainLength,
        },
        layers: layerDetails.map(ld => ({
          layer: ld.layer,
          count: ld.count,
          directories: Object.fromEntries(ld.directories),
          top_symbols: ld.topSymbols.map(s => ({
            name: s.name,
            kind: s.kind,
            pagerank: s.pagerank,
          })),
        })),
        violations: violations.slice(0, 50).map(v => {
          const srcNode = G.getNodeAttributes(v.source);
          const tgtNode = G.getNodeAttributes(v.target);
          return {
            source: srcNode?.name || `#${v.source}`,
            target: tgtNode?.name || `#${v.target}`,
            source_layer: v.source_layer,
            target_layer: v.target_layer,
            severity: v.severity,
          };
        }),
      })));
    } else {
      console.log(`=== Dependency Layers (${maxLayer + 1} layers, ${totalSymbols} symbols) ===\n`);
      console.log(`Architecture: ${archType}  |  Deepest chain: ${deepestChainLength}  |  Violations: ${violations.length}\n`);

      // Layer summary
      for (const ld of layerDetails) {
        console.log(`Layer ${ld.layer} (${ld.count} symbols):`);
        if (ld.directories.length) {
          const dirStr = ld.directories.map(([d, c]) => `${d} (${c})`).join(', ');
          console.log(`  dirs: ${dirStr}`);
        }
        if (ld.topSymbols.length) {
          const symStr = ld.topSymbols.map(s => `${abbrevKind(s.kind)} ${s.name}`).join(', ');
          console.log(`  top:  ${symStr}`);
        }
        console.log('');
      }

      // Violations
      if (violations.length) {
        console.log(`--- Layer Violations (${violations.length}) ---\n`);
        const vHeaders = ['Source', 'Target', 'From', 'To', 'Severity'];
        const vRows = violations.slice(0, 20).map(v => {
          const srcNode = G.getNodeAttributes(v.source);
          const tgtNode = G.getNodeAttributes(v.target);
          return [
            srcNode?.name || `#${v.source}`,
            tgtNode?.name || `#${v.target}`,
            `L${v.source_layer}`,
            `L${v.target_layer}`,
            v.severity.toFixed(3),
          ];
        });
        console.log(formatTable(vHeaders, vRows));
        if (violations.length > 20) console.log(`(+${violations.length - 20} more violations)`);
      }
    }
  } finally {
    db.close();
  }
}
