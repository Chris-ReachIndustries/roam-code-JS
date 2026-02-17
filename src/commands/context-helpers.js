/**
 * Data-gathering helpers for context, preflight, and diff commands.
 * No CLI logic — pure data retrieval from the indexed database.
 */

import { SYMBOL_METRICS, METRICS_FOR_SYMBOL, CALLERS_OF, CALLEES_OF,
  FILE_STATS_BY_ID, COCHANGE_FOR_FILE, CLUSTER_FOR_SYMBOL, CLUSTER_MEMBERS,
  SYMBOL_BY_ID, SYMBOLS_IN_FILE } from '../db/queries.js';
import { batchedIn } from '../db/connection.js';
import { buildReverseAdj, bfsReachable } from './graph-helpers.js';
import { isTest } from '../index/file-roles.js';

// ---------------------------------------------------------------------------
// Single-value lookups
// ---------------------------------------------------------------------------

export function getSymbolMetrics(db, symId) {
  const row = db.prepare(SYMBOL_METRICS).get(symId);
  if (!row) return null;
  return {
    cognitive_complexity: row.cognitive_complexity,
    nesting_depth: row.nesting_depth,
    param_count: row.param_count,
    line_count: row.line_count,
    return_count: row.return_count,
    bool_op_count: row.bool_op_count,
    callback_depth: row.callback_depth,
    cyclomatic_density: row.cyclomatic_density,
    halstead_volume: row.halstead_volume,
    halstead_difficulty: row.halstead_difficulty,
    halstead_effort: row.halstead_effort,
    halstead_bugs: row.halstead_bugs,
  };
}

export function getGraphMetrics(db, symId) {
  const row = db.prepare(METRICS_FOR_SYMBOL).get(symId);
  if (!row) return { pagerank: 0, in_degree: 0, out_degree: 0, betweenness: 0 };
  return {
    pagerank: row.pagerank || 0,
    in_degree: row.in_degree || 0,
    out_degree: row.out_degree || 0,
    betweenness: row.betweenness || 0,
  };
}

export function getFileChurn(db, fileId) {
  const row = db.prepare(FILE_STATS_BY_ID).get(fileId);
  if (!row) return { commit_count: 0, total_churn: 0, distinct_authors: 0, complexity: 0 };
  return {
    commit_count: row.commit_count || 0,
    total_churn: row.total_churn || 0,
    distinct_authors: row.distinct_authors || 0,
    complexity: row.complexity || 0,
  };
}

// ---------------------------------------------------------------------------
// Coupling (temporal co-change)
// ---------------------------------------------------------------------------

export function getCoupling(db, fileId, limit = 10) {
  const rows = db.prepare(COCHANGE_FOR_FILE).all(fileId, fileId, fileId, limit);
  return rows.map(r => ({
    path: r.path,
    count: r.cochange_count,
    strength: r.cochange_count >= 10 ? 'high' : r.cochange_count >= 3 ? 'medium' : 'low',
  }));
}

// ---------------------------------------------------------------------------
// Test discovery via reverse BFS
// ---------------------------------------------------------------------------

export function getAffectedTestsBfs(db, symIds, maxHops = 8) {
  if (!Array.isArray(symIds)) symIds = [symIds];
  const revAdj = buildReverseAdj(db);
  const startSet = new Set(symIds);
  const reachable = bfsReachable(revAdj, startSet, maxHops);

  if (reachable.size === 0) return [];

  // Look up which reachable symbols are in test files
  const allIds = [...reachable];
  const rows = batchedIn(
    db,
    'SELECT s.id, s.name, s.kind, f.path as file_path FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.id IN ({ph})',
    allIds,
  );
  return rows.filter(r => isTest(r.file_path));
}

// ---------------------------------------------------------------------------
// Blast radius
// ---------------------------------------------------------------------------

export function getBlastRadius(db, symId) {
  const revAdj = buildReverseAdj(db);
  const reachable = bfsReachable(revAdj, new Set([symId]), 10);

  if (reachable.size === 0) return { symbols: 0, files: 0 };

  const fileIds = new Set();
  const allIds = [...reachable];
  const rows = batchedIn(
    db,
    'SELECT s.id, s.file_id FROM symbols s WHERE s.id IN ({ph})',
    allIds,
  );
  for (const r of rows) fileIds.add(r.file_id);

  return { symbols: reachable.size, files: fileIds.size };
}

// ---------------------------------------------------------------------------
// Cluster info
// ---------------------------------------------------------------------------

export function getClusterInfo(db, symId) {
  const row = db.prepare(CLUSTER_FOR_SYMBOL).get(symId);
  if (!row) return null;

  const members = db.prepare(CLUSTER_MEMBERS).all(row.cluster_id);
  return {
    cluster_id: row.cluster_id,
    label: row.cluster_label || `cluster-${row.cluster_id}`,
    size: members.length,
    top_members: members.slice(0, 5).map(m => ({
      name: m.name, kind: m.kind, file_path: m.file_path,
    })),
  };
}

// ---------------------------------------------------------------------------
// Similar symbols (same kind + directory)
// ---------------------------------------------------------------------------

export function getSimilarSymbols(db, sym, limit = 10) {
  if (!sym || !sym.file_path) return [];
  const dir = sym.file_path.replace(/\/[^/]+$/, '/');
  const rows = db.prepare(
    `SELECT s.*, f.path as file_path FROM symbols s JOIN files f ON s.file_id = f.id
     WHERE s.kind = ? AND f.path LIKE ? AND s.id != ? ORDER BY s.name LIMIT ?`
  ).all(sym.kind, dir + '%', sym.id, limit);
  return rows;
}

// ---------------------------------------------------------------------------
// Entry points reaching a symbol
// ---------------------------------------------------------------------------

export function getEntryPointsReaching(db, symId, limit = 5) {
  const revAdj = buildReverseAdj(db);
  const reachable = bfsReachable(revAdj, new Set([symId]), 15);
  if (reachable.size === 0) return [];

  // Entry points = symbols with zero incoming edges
  const allIds = [...reachable];
  const rows = batchedIn(
    db,
    `SELECT s.id, s.name, s.kind, f.path as file_path
     FROM symbols s JOIN files f ON s.file_id = f.id
     LEFT JOIN edges e ON e.target_id = s.id
     WHERE s.id IN ({ph}) AND e.target_id IS NULL`,
    allIds,
  );
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Full context gathering
// ---------------------------------------------------------------------------

export function gatherSymbolContext(db, sym) {
  const callers = db.prepare(CALLERS_OF).all(sym.id);
  const callees = db.prepare(CALLEES_OF).all(sym.id);

  // Siblings in same file
  const siblings = db.prepare(SYMBOLS_IN_FILE).all(sym.file_id)
    .filter(s => s.id !== sym.id && s.is_exported);

  // Files to read: the symbol's file + direct caller/callee files
  const filesToRead = new Set([sym.file_path]);
  for (const c of callers.slice(0, 5)) filesToRead.add(c.file_path);
  for (const c of callees.slice(0, 5)) filesToRead.add(c.file_path);

  return {
    callers: _dedupEdges(callers),
    callees: _dedupEdges(callees),
    tests: getAffectedTestsBfs(db, sym.id),
    siblings: siblings.slice(0, 10),
    files_to_read: [...filesToRead].slice(0, 10),
  };
}

/**
 * Gather task-specific extra context.
 */
export function gatherTaskExtras(db, sym, ctx, task) {
  const extras = {};

  if (task === 'refactor' || task === 'review') {
    extras.complexity = getSymbolMetrics(db, sym.id);
    extras.graph = getGraphMetrics(db, sym.id);
    extras.blast_radius = getBlastRadius(db, sym.id);
  }

  if (task === 'debug' || task === 'review') {
    extras.complexity = extras.complexity || getSymbolMetrics(db, sym.id);
    extras.tests = ctx.tests;
  }

  if (task === 'extend' || task === 'review') {
    extras.similar = getSimilarSymbols(db, sym);
    extras.entry_points = getEntryPointsReaching(db, sym.id);
    extras.graph = extras.graph || getGraphMetrics(db, sym.id);
  }

  if (task === 'understand') {
    extras.cluster = getClusterInfo(db, sym.id);
    extras.graph = getGraphMetrics(db, sym.id);
    extras.churn = getFileChurn(db, sym.file_id);
  }

  if (task === 'review') {
    extras.churn = getFileChurn(db, sym.file_id);
    extras.coupling = getCoupling(db, sym.file_id);
    extras.cluster = getClusterInfo(db, sym.id);
  }

  return extras;
}

/**
 * Batch context for multiple symbols — find shared callers/callees.
 */
export function batchContext(db, symbols) {
  const allCallers = new Map();
  const allCallees = new Map();

  for (const sym of symbols) {
    const callers = db.prepare(CALLERS_OF).all(sym.id);
    const callees = db.prepare(CALLEES_OF).all(sym.id);
    for (const c of callers) {
      const key = c.id;
      if (!allCallers.has(key)) allCallers.set(key, { ...c, shared_count: 0 });
      allCallers.get(key).shared_count++;
    }
    for (const c of callees) {
      const key = c.id;
      if (!allCallees.has(key)) allCallees.set(key, { ...c, shared_count: 0 });
      allCallees.get(key).shared_count++;
    }
  }

  // Shared = referenced by 2+ of the queried symbols
  const shared_callers = [...allCallers.values()]
    .filter(c => c.shared_count >= 2)
    .sort((a, b) => b.shared_count - a.shared_count);
  const shared_callees = [...allCallees.values()]
    .filter(c => c.shared_count >= 2)
    .sort((a, b) => b.shared_count - a.shared_count);

  return { shared_callers, shared_callees };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const _EDGE_PRIORITY = { call: 1, uses: 2, inherits: 3, implements: 4, template: 5, import: 6, reference: 7 };

function _dedupEdges(edges) {
  const byId = new Map();
  for (const e of edges) {
    const existing = byId.get(e.id);
    if (!existing || (_EDGE_PRIORITY[e.edge_kind] || 99) < (_EDGE_PRIORITY[existing.edge_kind] || 99)) {
      byId.set(e.id, e);
    }
  }
  return [...byId.values()];
}
