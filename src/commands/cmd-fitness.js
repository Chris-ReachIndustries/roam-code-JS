/**
 * roam fitness — Evaluate project fitness against quality gate presets.
 */

import { openDb } from '../db/connection.js';
import { UNREFERENCED_EXPORTS } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';
import { getPreset, evaluateGates, listPresets } from '../analysis/gate-presets.js';
import { buildSymbolGraph } from '../graph/builder.js';
import { findCycles } from '../graph/cycles.js';
import { createSarifLog, addRun, writeSarif, makeRule, makeResult } from '../output/sarif.js';
import { recordSnapshot } from '../analysis/metrics-history.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const presetName = opts.preset || 'default';
    const gateMode = opts.gate || false;
    const sarifPath = opts.sarif || null;
    const snapshot = opts.snapshot || false;

    const preset = getPreset(presetName);

    // Gather all metrics
    const metrics = Object.create(null);

    // File count
    metrics.file_count = db.prepare('SELECT COUNT(*) as cnt FROM files').get().cnt;
    metrics.symbol_count = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get().cnt;
    metrics.edge_count = db.prepare('SELECT COUNT(*) as cnt FROM edges').get().cnt;

    // Complexity
    try {
      const cRow = db.prepare(
        'SELECT AVG(cognitive_complexity) as avg_cc, MAX(cognitive_complexity) as max_cc FROM symbol_metrics WHERE cognitive_complexity > 0'
      ).get();
      metrics.avg_complexity = cRow && cRow.avg_cc ? Math.round(cRow.avg_cc * 10) / 10 : 0;
      metrics.max_complexity = cRow && cRow.max_cc ? cRow.max_cc : 0;
    } catch { metrics.avg_complexity = 0; metrics.max_complexity = 0; }

    // Dead code
    try {
      const dead = db.prepare(UNREFERENCED_EXPORTS).all();
      metrics.dead_count = dead.length;
      metrics.dead_pct = metrics.symbol_count > 0 ? Math.round(dead.length / metrics.symbol_count * 1000) / 10 : 0;
    } catch { metrics.dead_count = 0; metrics.dead_pct = 0; }

    // Test ratio
    const testFiles = db.prepare("SELECT COUNT(*) as cnt FROM files WHERE path LIKE '%test%' OR path LIKE '%spec%'").get().cnt;
    metrics.test_ratio = metrics.file_count > 0 ? Math.round(testFiles / metrics.file_count * 1000) / 1000 : 0;

    // Cycles
    try {
      const G = buildSymbolGraph(db);
      if (G.order > 0 && G.order < 5000) {
        const cycles = findCycles(G);
        metrics.cycle_count = cycles.length;
        const cycleSyms = new Set();
        for (const scc of cycles) for (const id of scc) cycleSyms.add(id);
        metrics.tangle_ratio = Math.round(cycleSyms.size / Math.max(metrics.symbol_count, 1) * 1000) / 10;
      } else {
        metrics.cycle_count = 0;
        metrics.tangle_ratio = 0;
      }
    } catch { metrics.cycle_count = 0; metrics.tangle_ratio = 0; }

    // God components
    try {
      const gods = db.prepare(
        'SELECT COUNT(*) as cnt FROM graph_metrics WHERE (in_degree + out_degree) > 20'
      ).get();
      metrics.god_components = gods.cnt;
    } catch { metrics.god_components = 0; }

    // Coupling density
    try {
      const couplingPairs = db.prepare('SELECT COUNT(*) as cnt FROM git_cochange WHERE cochange_count >= 3').get().cnt;
      const maxPairs = metrics.file_count * (metrics.file_count - 1) / 2;
      metrics.coupling_density = maxPairs > 0 ? Math.round(couplingPairs / maxPairs * 1000) / 1000 : 0;
    } catch { metrics.coupling_density = 0; }

    // Health score
    metrics.health_score = _quickHealthScore(metrics);

    // Evaluate gates
    const result = evaluateGates(metrics, presetName);

    // Record snapshot if requested
    if (snapshot) {
      try {
        const rwDb = openDb();
        try { recordSnapshot(rwDb, metrics); } finally { rwDb.close(); }
      } catch { /* ok, readonly context */ }
    }

    // SARIF export
    if (sarifPath) {
      const log = createSarifLog();
      const rules = result.checks.filter(c => !c.pass).map(c =>
        makeRule(`ROAM-GATE-${c.name.toUpperCase()}`, `gate-${c.name}`, `Quality gate: ${c.name}`, null, 'warning')
      );
      const results = result.checks.filter(c => !c.pass).map(c =>
        makeResult(`ROAM-GATE-${c.name.toUpperCase()}`, `Gate '${c.name}' failed: ${c.actual} ${c.op} ${c.threshold}`, [], 'warning', { actual: c.actual, threshold: c.threshold })
      );
      addRun(log, 'fitness', rules, results);
      writeSarif(log, sarifPath);
      console.log(`SARIF written to ${sarifPath}`);
    }

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('fitness', {
        summary: {
          preset: presetName,
          passed: result.passed,
          gates_total: result.checks.length,
          gates_passed: result.checks.filter(c => c.pass).length,
          gates_failed: result.checks.filter(c => !c.pass).length,
        },
        metrics,
        checks: result.checks,
      })));
    } else {
      console.log(`Fitness — Preset: ${presetName} (${preset.description || ''})\n`);
      const headers = ['Gate', 'Threshold', 'Actual', 'Op', 'Status'];
      const tableRows = result.checks.map(c => [
        c.name, c.threshold, c.actual, c.op,
        c.pass ? 'PASS' : 'FAIL',
      ]);
      console.log(formatTable(headers, tableRows));
      console.log(`\nOverall: ${result.passed ? 'PASS' : 'FAIL'} (${result.checks.filter(c => c.pass).length}/${result.checks.length} gates)`);
    }

    if (gateMode && !result.passed) {
      process.exit(1);
    }
  } finally {
    db.close();
  }
}

function _quickHealthScore(m) {
  let score = 100;
  if (m.tangle_ratio > 10) score -= 20;
  else if (m.tangle_ratio > 5) score -= 10;
  if (m.god_components > 5) score -= 15;
  else if (m.god_components > 2) score -= 8;
  if (m.dead_pct > 15) score -= 10;
  else if (m.dead_pct > 5) score -= 5;
  if (m.avg_complexity > 25) score -= 15;
  else if (m.avg_complexity > 15) score -= 8;
  if (m.cycle_count > 5) score -= 10;
  return Math.max(0, Math.min(100, score));
}
