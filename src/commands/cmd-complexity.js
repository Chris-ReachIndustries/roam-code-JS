/**
 * roam complexity — Show symbols ranked by cognitive complexity.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { createSarifLog, addRun, writeSarif, complexityToSarif } from '../output/sarif.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const threshold = opts.threshold != null ? Number(opts.threshold) : 10;
    const top = opts.top != null ? Number(opts.top) : 50;
    const byFile = opts.byFile || false;
    const sarifPath = opts.sarif || null;

    if (byFile) {
      // Aggregate complexity per file
      const rows = db.prepare(`
        SELECT f.path, f.language,
               AVG(sm.cognitive_complexity) as avg_cc,
               MAX(sm.cognitive_complexity) as max_cc,
               COUNT(*) as symbol_count,
               SUM(CASE WHEN sm.cognitive_complexity > ? THEN 1 ELSE 0 END) as above_threshold
        FROM symbol_metrics sm
        JOIN symbols s ON sm.symbol_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE sm.cognitive_complexity > 0
        GROUP BY f.id
        HAVING max_cc > ?
        ORDER BY max_cc DESC
        LIMIT ?
      `).all(threshold, threshold, top);

      if (jsonMode) {
        console.log(toJson(jsonEnvelope('complexity', {
          summary: { mode: 'by-file', threshold, files: rows.length },
          files: rows.map(r => ({
            path: r.path, language: r.language,
            avg_complexity: Math.round(r.avg_cc * 10) / 10,
            max_complexity: r.max_cc,
            symbols: r.symbol_count,
            above_threshold: r.above_threshold,
          })),
        })));
      } else {
        console.log(`Complexity by file (threshold: ${threshold}):\n`);
        const headers = ['Path', 'Lang', 'Avg CC', 'Max CC', 'Symbols', 'Above'];
        const tableRows = rows.map(r => [
          r.path, r.language || '?',
          (r.avg_cc || 0).toFixed(1), r.max_cc,
          r.symbol_count, r.above_threshold,
        ]);
        console.log(formatTable(headers, tableRows));
      }
      return;
    }

    // Per-symbol complexity
    const rows = db.prepare(`
      SELECT s.name, s.kind, s.qualified_name, f.path as file_path, s.line_start, s.line_end,
             sm.cognitive_complexity, sm.nesting_depth, sm.param_count, sm.line_count,
             sm.cyclomatic_density, sm.halstead_volume
      FROM symbol_metrics sm
      JOIN symbols s ON sm.symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE sm.cognitive_complexity >= ?
      ORDER BY sm.cognitive_complexity DESC
      LIMIT ?
    `).all(threshold, top);

    // SARIF export
    if (sarifPath) {
      const log = createSarifLog();
      const { rules, results } = complexityToSarif(rows.map(r => ({
        name: r.name, kind: r.kind, file_path: r.file_path,
        line_start: r.line_start, cognitive_complexity: r.cognitive_complexity,
      })));
      addRun(log, 'complexity', rules, results);
      writeSarif(log, sarifPath);
      console.log(`SARIF written to ${sarifPath}`);
    }

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('complexity', {
        summary: { threshold, count: rows.length },
        symbols: rows.map(r => ({
          name: r.name, kind: r.kind,
          cognitive_complexity: r.cognitive_complexity,
          nesting_depth: r.nesting_depth,
          param_count: r.param_count,
          line_count: r.line_count,
          cyclomatic_density: r.cyclomatic_density ? Math.round(r.cyclomatic_density * 1000) / 1000 : null,
          location: loc(r.file_path, r.line_start),
        })),
      })));
    } else {
      if (!rows.length) {
        console.log(`No symbols with cognitive complexity >= ${threshold}.`);
        return;
      }
      console.log(`Complex symbols (CC >= ${threshold}, showing ${rows.length}):\n`);
      const headers = ['Name', 'Kind', 'CC', 'Nest', 'Params', 'Lines', 'Location'];
      const tableRows = rows.map(r => [
        r.name, abbrevKind(r.kind), r.cognitive_complexity,
        r.nesting_depth, r.param_count, r.line_count,
        loc(r.file_path, r.line_start),
      ]);
      console.log(formatTable(headers, tableRows));
    }
  } finally {
    db.close();
  }
}
