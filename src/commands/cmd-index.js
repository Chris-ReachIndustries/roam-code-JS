/**
 * Build or rebuild the codebase index.
 */

import { openDb, dbExists } from '../db/connection.js';
import { SUPPORTED_LANGUAGES } from '../languages/registry.js';

/**
 * Execute the index command.
 * @param {object} opts - Command-specific options
 * @param {object} globalOpts - Global CLI options
 */
export async function execute(opts, globalOpts = {}) {
  const jsonMode = globalOpts.json || false;
  const { Indexer } = await import('../index/indexer.js');

  const t0 = performance.now();
  const indexer = new Indexer();
  await indexer.run({ force: opts.force, verbose: opts.verbose });
  const elapsed = (performance.now() - t0) / 1000;

  if (!jsonMode) {
    console.log(`Index complete. (${elapsed.toFixed(1)}s)`);
  }

  // Show summary stats
  if (dbExists()) {
    const db = openDb({ readonly: true });
    try {
      const fileCount = db.prepare('SELECT COUNT(*) as cnt FROM files').get().cnt;
      const symCount = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get().cnt;
      const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM edges').get().cnt;

      const langRows = db.prepare(
        `SELECT language, COUNT(*) as cnt FROM files
         WHERE language IS NOT NULL GROUP BY language ORDER BY cnt DESC`
      ).all();

      const avgSym = fileCount ? symCount / fileCount : 0;

      // Parse coverage
      const languages = [...SUPPORTED_LANGUAGES];
      const langPlaceholders = languages.map(() => '?').join(',');
      const parseableCount = db.prepare(
        `SELECT COUNT(*) as cnt FROM files WHERE language IN (${langPlaceholders})`
      ).get(...languages).cnt;
      const parsedOk = db.prepare(
        `SELECT COUNT(DISTINCT f.id) as cnt FROM files f
         JOIN symbols s ON s.file_id = f.id
         WHERE f.language IN (${langPlaceholders})`
      ).get(...languages).cnt;
      const coverage = parseableCount ? (parsedOk * 100 / parseableCount) : 0;

      if (jsonMode) {
        const envelope = {
          command: 'index',
          summary: { files: fileCount, symbols: symCount, edges: edgeCount },
          elapsed_s: Math.round(elapsed * 10) / 10,
          files: fileCount,
          symbols: symCount,
          edges: edgeCount,
          languages: Object.fromEntries(langRows.slice(0, 8).map(r => [r.language, r.cnt])),
          avg_symbols_per_file: Math.round(avgSym * 10) / 10,
          parse_coverage_pct: Math.round(coverage),
        };
        console.log(JSON.stringify(envelope));
      } else {
        const langStr = langRows.slice(0, 8).map(r => `${r.language}=${r.cnt}`).join(', ');
        console.log(`  Files: ${fileCount}  Symbols: ${symCount}  Edges: ${edgeCount}`);
        console.log(`  Languages: ${langStr}`);
        console.log(`  Avg symbols/file: ${avgSym.toFixed(1)}  Parse coverage: ${coverage.toFixed(0)}%`);
      }
    } finally {
      db.close();
    }
  }
}
