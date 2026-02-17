/**
 * roam fan — Show fan-in/fan-out metrics for symbols.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const fanIn = opts.in || false;
    const fanOut = opts.out || false;
    const threshold = opts.threshold != null ? Number(opts.threshold) : 5;
    const top = opts.top != null ? Number(opts.top) : 50;

    // Compute fan-in and fan-out from graph_metrics
    let orderBy;
    if (fanIn && !fanOut) orderBy = 'gm.in_degree DESC';
    else if (fanOut && !fanIn) orderBy = 'gm.out_degree DESC';
    else orderBy = '(gm.in_degree + gm.out_degree) DESC';

    let filterClause;
    if (fanIn && !fanOut) filterClause = 'gm.in_degree >= ?';
    else if (fanOut && !fanIn) filterClause = 'gm.out_degree >= ?';
    else filterClause = '(gm.in_degree + gm.out_degree) >= ?';

    const rows = db.prepare(`
      SELECT s.name, s.kind, f.path as file_path, s.line_start,
             gm.in_degree, gm.out_degree,
             (gm.in_degree + gm.out_degree) as total
      FROM graph_metrics gm
      JOIN symbols s ON gm.symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE ${filterClause}
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(threshold, top);

    // Classify risk
    const classified = rows.map(r => {
      const risks = [];
      if (r.out_degree > 15) risks.push('God-object');
      if (r.in_degree > 20) risks.push('High-impact');
      if (r.out_degree > 10 && r.in_degree > 10) risks.push('Hub');
      return {
        name: r.name, kind: r.kind,
        fan_in: r.in_degree, fan_out: r.out_degree, total: r.total,
        risk: risks.length ? risks.join(', ') : '-',
        file_path: r.file_path, line_start: r.line_start,
      };
    });

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('fan', {
        summary: {
          count: classified.length, threshold,
          mode: fanIn ? 'in' : fanOut ? 'out' : 'both',
          god_objects: classified.filter(c => c.risk.includes('God')).length,
          high_impact: classified.filter(c => c.risk.includes('High')).length,
        },
        symbols: classified.map(c => ({
          name: c.name, kind: c.kind,
          fan_in: c.fan_in, fan_out: c.fan_out, total: c.total,
          risk: c.risk, location: loc(c.file_path, c.line_start),
        })),
      })));
    } else {
      if (!classified.length) {
        console.log(`No symbols with fan >= ${threshold}.`);
        return;
      }
      const modeStr = fanIn ? 'Fan-In' : fanOut ? 'Fan-Out' : 'Fan-In/Out';
      console.log(`${modeStr} Analysis (threshold: ${threshold}, showing ${classified.length}):\n`);
      const headers = ['Name', 'Kind', 'In', 'Out', 'Total', 'Risk', 'Location'];
      const tableRows = classified.map(c => [
        c.name, abbrevKind(c.kind), c.fan_in, c.fan_out, c.total,
        c.risk, loc(c.file_path, c.line_start),
      ]);
      console.log(formatTable(headers, tableRows));
    }
  } finally {
    db.close();
  }
}
