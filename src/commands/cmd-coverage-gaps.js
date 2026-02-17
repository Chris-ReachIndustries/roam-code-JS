/**
 * roam coverage-gaps — Find high-value symbols with no test coverage.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { isTest } from '../index/file-roles.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const threshold = opts.threshold != null ? Number(opts.threshold) : 0;
    const top = opts.top != null ? Number(opts.top) : 50;

    // Find symbols with high PageRank and no test callers
    const symbols = db.prepare(`
      SELECT s.id, s.name, s.kind, s.qualified_name,
             f.path as file_path, s.line_start,
             COALESCE(gm.pagerank, 0) as pagerank,
             COALESCE(gm.in_degree, 0) as in_degree,
             COALESCE(sm.cognitive_complexity, 0) as complexity
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      LEFT JOIN graph_metrics gm ON s.id = gm.symbol_id
      LEFT JOIN symbol_metrics sm ON s.id = sm.symbol_id
      WHERE s.is_exported = 1
        AND s.kind IN ('function', 'class', 'method', 'interface')
      ORDER BY COALESCE(gm.pagerank, 0) DESC
      LIMIT 500
    `).all();

    // Filter out test symbols
    const nonTestSymbols = symbols.filter(s => !isTest(s.file_path));

    // For each symbol, check if any test files reference it
    const gaps = [];
    for (const sym of nonTestSymbols) {
      const testCallers = db.prepare(`
        SELECT COUNT(*) as cnt
        FROM edges e
        JOIN symbols s ON e.source_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE e.target_id = ?
          AND (f.path LIKE '%test%' OR f.path LIKE '%spec%')
      `).get(sym.id);

      if (testCallers.cnt === 0) {
        // Score: pagerank × complexity × consumer_count
        const score = Math.round(
          (sym.pagerank * 10000) * Math.max(sym.complexity, 1) * Math.max(sym.in_degree, 1) * 0.001
        ) / 1000;

        if (score >= threshold) {
          gaps.push({
            name: sym.name,
            kind: sym.kind,
            pagerank: sym.pagerank,
            complexity: sym.complexity,
            consumers: sym.in_degree,
            score,
            file_path: sym.file_path,
            line_start: sym.line_start,
          });
        }
      }
    }

    // Sort by score descending
    gaps.sort((a, b) => b.score - a.score);
    const shown = gaps.slice(0, top);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('coverage-gaps', {
        summary: {
          total_gaps: gaps.length,
          shown: shown.length,
          critical: gaps.filter(g => g.score > 1).length,
        },
        gaps: shown.map(g => ({
          name: g.name, kind: g.kind,
          pagerank: Math.round(g.pagerank * 10000) / 10000,
          complexity: g.complexity, consumers: g.consumers,
          score: g.score,
          location: loc(g.file_path, g.line_start),
        })),
      })));
    } else {
      if (!shown.length) {
        console.log('No coverage gaps detected (all high-value symbols have test coverage).');
        return;
      }
      console.log(`Coverage Gaps (${shown.length} untested high-value symbols):\n`);
      const headers = ['Name', 'Kind', 'PR', 'CC', 'Consumers', 'Score', 'Location'];
      const rows = shown.map(g => [
        g.name, abbrevKind(g.kind),
        g.pagerank.toFixed(4), g.complexity,
        g.consumers, g.score.toFixed(3),
        loc(g.file_path, g.line_start),
      ]);
      console.log(formatTable(headers, rows));
    }
  } finally {
    db.close();
  }
}
