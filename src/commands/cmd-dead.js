/**
 * roam dead — Find unreferenced exported symbols (dead code detection).
 */

import { openDb } from '../db/connection.js';
import { UNREFERENCED_EXPORTS } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { batchedIn } from '../db/connection.js';
import { isTest } from '../index/file-roles.js';
import { dirname } from 'node:path';

// Exclusion patterns
const EXCLUDED_NAMES = new Set(['__init__', '__main__', 'main', 'setup', 'teardown']);
const EXCLUDED_PREFIXES = ['_', 'test_', 'Test'];

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const showAll = opts.all || false;
    const byDirectory = opts.byDirectory || false;
    const byKind = opts.byKind || false;
    const summaryOnly = opts.summary || false;
    const showAging = opts.aging || false;
    const showEffort = opts.effort || false;
    const showDecay = opts.decay || false;
    const showClusters = opts.clusters || false;

    let candidates = db.prepare(UNREFERENCED_EXPORTS).all();

    // Filter out test symbols and excluded names
    if (!showAll) {
      candidates = candidates.filter(s => {
        if (isTest(s.file_path)) return false;
        if (EXCLUDED_NAMES.has(s.name)) return false;
        if (EXCLUDED_PREFIXES.some(p => s.name.startsWith(p))) return false;
        return true;
      });
    }

    // Confidence scoring
    for (const s of candidates) {
      s._confidence = _computeConfidence(db, s);
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b._confidence - a._confidence);

    // Aging: check git blame age
    if (showAging) {
      for (const s of candidates) {
        s._age_days = _getSymbolAge(db, s);
      }
    }

    // Effort estimation
    if (showEffort) {
      for (const s of candidates) {
        const lineCount = (s.line_end || 0) - (s.line_start || 0) + 1;
        s._effort_minutes = Math.max(1, Math.round(lineCount * 0.5));
      }
    }

    // Decay priority (age × size × confidence)
    if (showDecay) {
      for (const s of candidates) {
        const age = s._age_days || _getSymbolAge(db, s);
        const lineCount = (s.line_end || 0) - (s.line_start || 0) + 1;
        s._decay_score = Math.round((age / 365) * lineCount * (s._confidence / 100) * 10) / 10;
      }
      candidates.sort((a, b) => (b._decay_score || 0) - (a._decay_score || 0));
    }

    // Dead-code clusters (connected components)
    let deadClusters = [];
    if (showClusters) {
      deadClusters = _findDeadClusters(db, candidates);
    }

    // Group by directory
    const dirGroups = new Map();
    for (const s of candidates) {
      const d = dirname(s.file_path).replace(/\\/g, '/');
      if (!dirGroups.has(d)) dirGroups.set(d, []);
      dirGroups.get(d).push(s);
    }

    // Group by kind
    const kindGroups = new Map();
    for (const s of candidates) {
      if (!kindGroups.has(s.kind)) kindGroups.set(s.kind, []);
      kindGroups.get(s.kind).push(s);
    }

    // Total effort
    const totalLineCount = candidates.reduce((sum, s) => sum + ((s.line_end || 0) - (s.line_start || 0) + 1), 0);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('dead', {
        summary: {
          dead_symbols: candidates.length,
          total_lines: totalLineCount,
          directories: dirGroups.size,
          kinds: Object.fromEntries([...kindGroups.entries()].map(([k, v]) => [k, v.length])),
        },
        symbols: candidates.map(s => ({
          name: s.name,
          qualified_name: s.qualified_name,
          kind: s.kind,
          location: loc(s.file_path, s.line_start),
          confidence: s._confidence,
          line_count: (s.line_end || 0) - (s.line_start || 0) + 1,
          ...(showAging ? { age_days: s._age_days } : {}),
          ...(showEffort ? { effort_minutes: s._effort_minutes } : {}),
          ...(showDecay ? { decay_score: s._decay_score } : {}),
        })),
        ...(showClusters ? { clusters: deadClusters } : {}),
      })));
      return;
    }

    console.log(`=== Dead Code (${candidates.length} unreferenced exports, ~${totalLineCount} lines) ===\n`);

    if (summaryOnly) {
      // Just show summary counts
      console.log(`By kind:`);
      for (const [kind, items] of [...kindGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  ${kind}: ${items.length}`);
      }
      console.log(`\nBy directory (top 10):`);
      const sortedDirs = [...dirGroups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
      for (const [dir, items] of sortedDirs) {
        console.log(`  ${dir}: ${items.length}`);
      }
      return;
    }

    if (byDirectory) {
      for (const [dir, items] of [...dirGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n${dir} (${items.length}):`);
        const headers = ['Kind', 'Name', 'Confidence', 'Lines'];
        const rows = items.map(s => [
          abbrevKind(s.kind), s.name, `${s._confidence}%`,
          `L${s.line_start}-${s.line_end || s.line_start}`,
        ]);
        console.log(formatTable(headers, rows, 20));
      }
    } else if (byKind) {
      for (const [kind, items] of [...kindGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n${kind} (${items.length}):`);
        const headers = ['Name', 'Confidence', 'Location'];
        const rows = items.map(s => [s.name, `${s._confidence}%`, loc(s.file_path, s.line_start)]);
        console.log(formatTable(headers, rows, 20));
      }
    } else {
      // Flat list
      const headers = ['Kind', 'Name', 'Conf', 'Location'];
      const extraHeaders = [];
      if (showAging) extraHeaders.push('Age');
      if (showEffort) extraHeaders.push('Effort');
      if (showDecay) extraHeaders.push('Decay');

      const rows = candidates.map(s => {
        const row = [
          abbrevKind(s.kind), s.name, `${s._confidence}%`, loc(s.file_path, s.line_start),
        ];
        if (showAging) row.push(`${s._age_days || '?'}d`);
        if (showEffort) row.push(`${s._effort_minutes || '?'}m`);
        if (showDecay) row.push(`${s._decay_score || 0}`);
        return row;
      });
      console.log(formatTable([...headers, ...extraHeaders], rows, 50));
    }

    // Dead clusters
    if (showClusters && deadClusters.length) {
      console.log(`\n--- Dead Code Clusters (${deadClusters.length}) ---\n`);
      for (const cluster of deadClusters.slice(0, 10)) {
        console.log(`  Cluster (${cluster.members.length} symbols): ${cluster.members.map(m => m.name).join(', ')}`);
      }
    }
  } finally {
    db.close();
  }
}

function _computeConfidence(db, sym) {
  // 100% = no incoming edges at all
  const incoming = db.prepare('SELECT COUNT(*) as cnt FROM edges WHERE target_id = ?').get(sym.id);
  if (incoming.cnt === 0) {
    // Check if it's used in any string/dynamic reference
    const nameRefs = db.prepare(
      "SELECT COUNT(*) as cnt FROM edges WHERE target_id IN (SELECT id FROM symbols WHERE name = ? AND id != ?)"
    ).get(sym.name, sym.id);
    if (nameRefs.cnt > 0) return 70; // might be used via another symbol with same name
    return 100;
  }
  // Has some edges but only import edges = 80%
  const nonImport = db.prepare(
    "SELECT COUNT(*) as cnt FROM edges WHERE target_id = ? AND kind != 'import'"
  ).get(sym.id);
  if (nonImport.cnt === 0) return 80;
  return 60;
}

function _getSymbolAge(db, sym) {
  try {
    const row = db.prepare(
      `SELECT MIN(gc.timestamp) as oldest
       FROM git_file_changes gfc
       JOIN git_commits gc ON gfc.commit_id = gc.id
       WHERE gfc.file_id = ?`
    ).get(sym.file_id);
    if (row && row.oldest) {
      return Math.floor((Date.now() / 1000 - row.oldest) / 86400);
    }
  } catch { /* git data may not exist */ }
  return 0;
}

function _findDeadClusters(db, candidates) {
  if (candidates.length === 0) return [];

  const deadIds = new Set(candidates.map(s => s.id));
  const idToSym = new Map(candidates.map(s => [s.id, s]));

  // Build adjacency among dead symbols only
  const adj = new Map();
  for (const id of deadIds) adj.set(id, new Set());

  const allIds = [...deadIds];
  const edges = batchedIn(
    db,
    'SELECT source_id, target_id FROM edges WHERE source_id IN ({ph}) OR target_id IN ({ph})',
    [...allIds, ...allIds],
  );

  for (const e of edges) {
    if (deadIds.has(e.source_id) && deadIds.has(e.target_id)) {
      adj.get(e.source_id).add(e.target_id);
      adj.get(e.target_id).add(e.source_id);
    }
  }

  // Connected components
  const visited = new Set();
  const clusters = [];
  for (const id of deadIds) {
    if (visited.has(id)) continue;
    const component = [];
    const queue = [id];
    visited.add(id);
    while (queue.length) {
      const cur = queue.shift();
      component.push(idToSym.get(cur));
      for (const nb of adj.get(cur)) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    if (component.length >= 2) {
      clusters.push({
        members: component.map(s => ({ name: s.name, kind: s.kind, file_path: s.file_path })),
      });
    }
  }

  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters;
}
