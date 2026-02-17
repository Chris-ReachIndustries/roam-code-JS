/**
 * roam clusters — Show Louvain community clusters with cohesion metrics.
 */

import { openDb } from '../db/connection.js';
import { ALL_CLUSTERS, CLUSTER_MEMBERS } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind } from '../output/formatter.js';
import { buildSymbolGraph } from '../graph/builder.js';
import { detectClusters, clusterQuality, compareWithDirectories } from '../graph/clusters.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const minSize = opts.minSize || 2;

    // Load stored clusters from DB
    const rawClusters = db.prepare(ALL_CLUSTERS).all();
    if (!rawClusters.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('clusters', { summary: { clusters: 0 }, clusters: [] })));
      } else {
        console.log('No clusters found. Run `roam index` first.');
      }
      return;
    }

    // Filter by minSize
    const clusters = rawClusters.filter(c => c.size >= minSize);

    // Compute cohesion: build graph and check intra vs inter edges
    const G = buildSymbolGraph(db);
    const clusterMap = new Map();
    for (const c of rawClusters) {
      const members = db.prepare(CLUSTER_MEMBERS).all(c.cluster_id);
      for (const m of members) {
        clusterMap.set(String(m.id), c.cluster_id);
      }
    }

    // Cohesion per cluster
    const cohesionMap = new Map();
    for (const c of clusters) {
      const memberIds = new Set();
      const members = db.prepare(CLUSTER_MEMBERS).all(c.cluster_id);
      for (const m of members) memberIds.add(String(m.id));

      let intra = 0, total = 0;
      for (const mid of memberIds) {
        if (!G.hasNode(mid)) continue;
        G.forEachOutEdge(mid, (edge, attrs, src, tgt) => {
          total++;
          if (memberIds.has(tgt)) intra++;
        });
      }
      cohesionMap.set(c.cluster_id, total > 0 ? Math.round(intra / total * 100) : 0);
    }

    // Detect mega-clusters
    const totalSymbols = rawClusters.reduce((s, c) => s + c.size, 0);
    const megaClusters = clusters.filter(c => c.size > 100 || (totalSymbols > 0 && c.size > totalSymbols * 0.4));

    // Directory mismatches
    const mismatches = compareWithDirectories(db);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('clusters', {
        summary: {
          clusters: clusters.length,
          total_symbols: totalSymbols,
          mega_clusters: megaClusters.length,
          mismatches: mismatches.length,
        },
        clusters: clusters.map(c => ({
          cluster_id: c.cluster_id,
          label: c.cluster_label,
          size: c.size,
          cohesion_pct: cohesionMap.get(c.cluster_id) || 0,
          is_mega: megaClusters.some(m => m.cluster_id === c.cluster_id),
        })),
        mismatches: mismatches.slice(0, 20),
      })));
    } else {
      console.log(`=== Code Clusters (${clusters.length} clusters, ${totalSymbols} symbols) ===\n`);

      // Main table
      const headers = ['ID', 'Label', 'Size', 'Cohesion'];
      const rows = clusters.map(c => [
        c.cluster_id,
        c.cluster_label,
        c.size,
        `${cohesionMap.get(c.cluster_id) || 0}%`,
      ]);
      console.log(formatTable(headers, rows));

      // Mega clusters detail
      if (megaClusters.length) {
        console.log(`\n--- Mega Clusters (${megaClusters.length}) ---\n`);
        for (const mc of megaClusters) {
          const pct = totalSymbols > 0 ? Math.round(mc.size / totalSymbols * 100) : 0;
          console.log(`  ${mc.cluster_label}: ${mc.size} symbols (${pct}% of total)`);
          // Show top 5 members
          const members = db.prepare(CLUSTER_MEMBERS).all(mc.cluster_id);
          const top = members.slice(0, 5);
          for (const m of top) {
            console.log(`    ${abbrevKind(m.kind)}  ${m.name}  (PR: ${(m.pagerank || 0).toFixed(4)})`);
          }
          if (members.length > 5) console.log(`    (+${members.length - 5} more)`);
        }
      }

      // Mismatches
      if (mismatches.length) {
        console.log(`\n--- Directory Mismatches (${mismatches.length}) ---\n`);
        const mHeaders = ['Cluster', 'Mismatches', 'Directories'];
        const mRows = mismatches.slice(0, 15).map(m => [
          m.cluster_label,
          m.mismatch_count,
          m.directories.slice(0, 3).join(', ') + (m.directories.length > 3 ? ` +${m.directories.length - 3}` : ''),
        ]);
        console.log(formatTable(mHeaders, mRows));
      }
    }
  } finally {
    db.close();
  }
}
