/**
 * roam risk — Composite risk score per file (churn × complexity × coupling).
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const paths = opts.paths || [];
    const top = opts.top != null ? Number(opts.top) : 30;

    // Get file stats with complexity
    let sql = `
      SELECT f.id, f.path, f.language,
             COALESCE(fs.total_churn, 0) as churn,
             COALESCE(fs.commit_count, 0) as commits,
             COALESCE(fs.distinct_authors, 0) as authors,
             COALESCE(fs.complexity, 0) as complexity
      FROM files f
      LEFT JOIN file_stats fs ON f.id = fs.file_id
    `;
    const params = [];
    if (paths.length) {
      const conds = paths.map(() => 'f.path LIKE ?');
      sql += ` WHERE (${conds.join(' OR ')})`;
      for (const p of paths) params.push(`%${p}%`);
    }

    const files = db.prepare(sql).all(...params);
    if (!files.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('risk', { summary: { files: 0 }, files: [] })));
      } else {
        console.log('No files found.');
      }
      return;
    }

    // Compute coupling count per file
    const couplingMap = Object.create(null);
    try {
      const couplingRows = db.prepare(`
        SELECT file_id_a, file_id_b, cochange_count FROM git_cochange
      `).all();
      for (const r of couplingRows) {
        couplingMap[r.file_id_a] = (couplingMap[r.file_id_a] || 0) + r.cochange_count;
        couplingMap[r.file_id_b] = (couplingMap[r.file_id_b] || 0) + r.cochange_count;
      }
    } catch { /* no git data */ }

    // Check for test files importing each file (basic test coverage proxy)
    const testMap = Object.create(null);
    try {
      const testEdges = db.prepare(`
        SELECT fe.target_file_id, COUNT(*) as test_count
        FROM file_edges fe
        JOIN files f ON fe.source_file_id = f.id
        WHERE f.path LIKE '%test%' OR f.path LIKE '%spec%'
        GROUP BY fe.target_file_id
      `).all();
      for (const r of testEdges) testMap[r.target_file_id] = r.test_count;
    } catch { /* ok */ }

    // Compute p90 for normalization
    const churns = files.map(f => f.churn).sort((a, b) => a - b);
    const cmplxs = files.map(f => f.complexity).sort((a, b) => a - b);
    const couplings = files.map(f => couplingMap[f.id] || 0).sort((a, b) => a - b);

    const p90 = (sorted) => {
      if (!sorted.length) return 1;
      const idx = Math.min(Math.floor(sorted.length * 0.9), sorted.length - 1);
      return sorted[idx] || 1;
    };

    const churnP90 = p90(churns);
    const cmplxP90 = p90(cmplxs);
    const couplingP90 = p90(couplings);

    const scored = files.map(f => {
      const coupling = couplingMap[f.id] || 0;
      const tests = testMap[f.id] || 0;

      const churnNorm = Math.min(f.churn / churnP90, 1);
      const cmplxNorm = Math.min(f.complexity / cmplxP90, 1);
      const couplingNorm = Math.min(coupling / couplingP90, 1);
      const testFactor = tests > 0 ? 0.5 : 1.0;

      const score = Math.round((churnNorm * 0.3 + cmplxNorm * 0.3 + couplingNorm * 0.2 + testFactor * 0.2) * 1000) / 1000;

      let classification;
      if (score > 0.8) classification = 'CRITICAL';
      else if (score > 0.6) classification = 'HIGH';
      else if (score > 0.3) classification = 'MEDIUM';
      else classification = 'LOW';

      return {
        path: f.path, language: f.language,
        risk: classification, score,
        churn: f.churn, complexity: Math.round(f.complexity * 100) / 100,
        coupling, tests,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const shown = scored.filter(s => s.score > 0).slice(0, top);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('risk', {
        summary: {
          files: shown.length,
          critical: shown.filter(s => s.risk === 'CRITICAL').length,
          high: shown.filter(s => s.risk === 'HIGH').length,
          medium: shown.filter(s => s.risk === 'MEDIUM').length,
        },
        files: shown,
      })));
    } else {
      if (!shown.length) {
        console.log('No files with measurable risk.');
        return;
      }
      console.log(`Risk Assessment (top ${shown.length} files):\n`);
      const headers = ['Risk', 'Score', 'Churn', 'Cmplx', 'Coupling', 'Tests', 'Path'];
      const tableRows = shown.map(s => [
        s.risk, s.score.toFixed(3), s.churn, s.complexity, s.coupling, s.tests, s.path,
      ]);
      console.log(formatTable(headers, tableRows));
    }
  } finally {
    db.close();
  }
}
