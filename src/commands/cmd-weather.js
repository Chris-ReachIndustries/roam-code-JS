/**
 * roam weather — Show code hotspots ranked by churn × complexity.
 */

import { openDb } from '../db/connection.js';
import { TOP_CHURN_FILES } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const count = opts.count || 20;

    const rows = db.prepare(TOP_CHURN_FILES).all(count * 2);
    if (!rows.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('weather', { summary: { hotspots: 0 }, hotspots: [] })));
      } else {
        console.log('No file stats available. Run `roam index` on a git repository first.');
      }
      return;
    }

    // Compute p75 for normalization
    const churns = rows.map(r => r.total_churn || 0).sort((a, b) => a - b);
    const cmplxs = rows.map(r => r.complexity || 0).sort((a, b) => a - b);
    const churnP75 = _percentile(churns, 75) || 1;
    const cmplxP75 = _percentile(cmplxs, 75) || 1;

    const scored = rows.map(r => {
      const churnNorm = (r.total_churn || 0) / churnP75;
      const cmplxNorm = (r.complexity || 0) / cmplxP75;
      const score = Math.max(0, Math.sqrt(churnNorm * cmplxNorm));
      let reason = 'BOTH';
      if (churnNorm > 2 * cmplxNorm) reason = 'HIGH-CHURN';
      else if (cmplxNorm > 2 * churnNorm) reason = 'HIGH-COMPLEXITY';
      return {
        path: r.path,
        score: Math.round(score * 1000) / 1000,
        churn: r.total_churn || 0,
        complexity: Math.round((r.complexity || 0) * 100) / 100,
        commits: r.commit_count || 0,
        authors: r.distinct_authors || 0,
        reason,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const shown = scored.slice(0, count);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('weather', {
        summary: { hotspots: shown.length, max_score: shown[0]?.score || 0 },
        hotspots: shown,
      })));
    } else {
      console.log(`Code Weather — Top ${shown.length} Hotspots (churn × complexity):\n`);
      const headers = ['Score', 'Churn', 'Cmplx', 'Commits', 'Authors', 'Reason', 'Path'];
      const tableRows = shown.map(r => [
        r.score.toFixed(3), r.churn, r.complexity, r.commits, r.authors, r.reason, r.path,
      ]);
      console.log(formatTable(headers, tableRows));
    }
  } finally {
    db.close();
  }
}

function _percentile(sorted, pct) {
  if (!sorted.length) return 0;
  const idx = Math.ceil(sorted.length * pct / 100) - 1;
  return sorted[Math.max(0, idx)];
}
