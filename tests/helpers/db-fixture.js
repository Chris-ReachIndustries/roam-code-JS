/**
 * Test helpers for creating in-memory SQLite databases.
 */

import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/schema.js';

/**
 * Create an empty in-memory database with the full schema.
 * @returns {import('better-sqlite3').Database}
 */
export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * Create a pre-seeded database with files, symbols, edges, and metrics.
 * @returns {import('better-sqlite3').Database}
 */
export function createSeededDb() {
  const db = createTestDb();

  // Insert files
  const insertFile = db.prepare(
    'INSERT INTO files (path, language, file_role, hash, line_count) VALUES (?, ?, ?, ?, ?)'
  );
  insertFile.run('src/app.js', 'javascript', 'source', 'abc123', 100);
  insertFile.run('src/utils/logger.js', 'javascript', 'source', 'def456', 50);
  insertFile.run('src/calculator.py', 'python', 'source', 'ghi789', 80);
  insertFile.run('tests/test_calc.py', 'python', 'test', 'jkl012', 30);
  insertFile.run('src/config.ts', 'typescript', 'source', 'mno345', 40);

  // Insert symbols
  const insertSymbol = db.prepare(
    `INSERT INTO symbols (file_id, name, qualified_name, kind, signature,
     line_start, line_end, visibility, is_exported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // app.js symbols
  insertSymbol.run(1, 'App', 'App', 'class', 'class App', 3, 15, 'public', 1);
  insertSymbol.run(1, 'main', 'main', 'function', 'function main()', 17, 22, 'public', 1);

  // logger.js symbols
  insertSymbol.run(2, 'Logger', 'Logger', 'class', 'class Logger', 1, 10, 'public', 1);
  insertSymbol.run(2, 'createLogger', 'createLogger', 'function', 'function createLogger(name)', 12, 14, 'public', 1);
  insertSymbol.run(2, 'DEFAULT_LEVEL', 'DEFAULT_LEVEL', 'constant', 'const DEFAULT_LEVEL', 11, 11, 'public', 1);

  // calculator.py symbols
  insertSymbol.run(3, 'Calculator', 'Calculator', 'class', 'class Calculator', 1, 10, 'public', 1);
  insertSymbol.run(3, 'fibonacci', 'fibonacci', 'function', 'def fibonacci(n)', 12, 15, 'public', 1);
  insertSymbol.run(3, 'unused_function', 'unused_function', 'function', 'def unused_function()', 17, 18, 'public', 1);

  // test symbols
  insertSymbol.run(4, 'test_add', 'test_add', 'function', 'def test_add()', 3, 5, 'public', 0);
  insertSymbol.run(4, 'test_fibonacci', 'test_fibonacci', 'function', 'def test_fibonacci()', 7, 8, 'public', 0);

  // config.ts symbols
  insertSymbol.run(5, 'AppConfig', 'AppConfig', 'interface', 'interface AppConfig', 1, 5, 'public', 1);
  insertSymbol.run(5, 'DEFAULT_CONFIG', 'DEFAULT_CONFIG', 'constant', 'const DEFAULT_CONFIG', 7, 11, 'public', 1);
  insertSymbol.run(5, 'loadConfig', 'loadConfig', 'function', 'function loadConfig(path: string)', 13, 15, 'public', 1);

  // Insert edges (calls/imports)
  const insertEdge = db.prepare(
    'INSERT INTO edges (source_id, target_id, kind, line) VALUES (?, ?, ?, ?)'
  );
  // App uses Logger
  insertEdge.run(1, 3, 'calls', 5);
  // App uses Calculator
  insertEdge.run(1, 6, 'calls', 7);
  // main uses App
  insertEdge.run(2, 1, 'calls', 18);
  // test_add uses Calculator
  insertEdge.run(9, 6, 'calls', 4);
  // test_fibonacci uses fibonacci
  insertEdge.run(10, 7, 'calls', 8);

  // Insert file_edges
  const insertFileEdge = db.prepare(
    'INSERT INTO file_edges (source_file_id, target_file_id, kind, symbol_count) VALUES (?, ?, ?, ?)'
  );
  insertFileEdge.run(1, 2, 'imports', 1); // app -> logger
  insertFileEdge.run(1, 3, 'imports', 1); // app -> calculator
  insertFileEdge.run(4, 3, 'imports', 2); // test -> calculator

  // Insert graph metrics
  const insertMetrics = db.prepare(
    'INSERT INTO graph_metrics (symbol_id, pagerank, in_degree, out_degree, betweenness) VALUES (?, ?, ?, ?, ?)'
  );
  insertMetrics.run(1, 0.15, 1, 2, 0.3);  // App
  insertMetrics.run(2, 0.08, 0, 1, 0.0);  // main
  insertMetrics.run(3, 0.12, 1, 0, 0.1);  // Logger
  insertMetrics.run(6, 0.18, 2, 0, 0.4);  // Calculator
  insertMetrics.run(7, 0.10, 1, 0, 0.05); // fibonacci
  insertMetrics.run(8, 0.02, 0, 0, 0.0);  // unused_function

  // Insert file_stats
  const insertStats = db.prepare(
    'INSERT INTO file_stats (file_id, commit_count, total_churn, distinct_authors, complexity) VALUES (?, ?, ?, ?, ?)'
  );
  insertStats.run(1, 5, 120, 2, 3.5);
  insertStats.run(2, 3, 45, 1, 1.2);
  insertStats.run(3, 4, 80, 2, 2.8);
  insertStats.run(4, 2, 30, 1, 1.0);
  insertStats.run(5, 1, 20, 1, 0.5);

  return db;
}
