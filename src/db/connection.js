/**
 * SQLite connection management with adaptive journal mode and performance pragmas.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCHEMA_SQL } from './schema.js';

const DEFAULT_DB_DIR = '.roam';
const DEFAULT_DB_NAME = 'index.db';

/**
 * Find the project root by looking for .git directory.
 */
export function findProjectRoot(start = '.') {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

/**
 * Get the path to the index database.
 * Respects ROAM_DB_DIR env-var for cloud-synced directories.
 */
export function getDbPath(projectRoot = null) {
  const override = process.env.ROAM_DB_DIR;
  if (override) {
    mkdirSync(override, { recursive: true });
    return join(override, DEFAULT_DB_NAME);
  }
  if (!projectRoot) projectRoot = findProjectRoot();
  const dbDir = join(projectRoot, DEFAULT_DB_DIR);
  mkdirSync(dbDir, { recursive: true });
  return join(dbDir, DEFAULT_DB_NAME);
}

/**
 * Detect if path lives under a cloud-sync folder (OneDrive, Dropbox, etc.).
 * WAL mode creates auxiliary files that cloud sync services aggressively lock.
 */
function isCloudSynced(dbPath) {
  const markers = ['onedrive', 'dropbox', 'google drive', 'icloud'];
  const resolved = resolve(dbPath).toLowerCase();
  return markers.some(m => resolved.includes(m));
}

/**
 * Apply schema migrations for columns added after initial schema.
 */
function ensureMigrations(db) {
  const safeAlter = (table, column, colType) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colType}`);
    } catch {
      // Column already exists
    }
  };
  safeAlter('symbols', 'default_value', 'TEXT');
  safeAlter('file_stats', 'health_score', 'REAL');
  safeAlter('file_stats', 'cochange_entropy', 'REAL');
  safeAlter('file_stats', 'cognitive_load', 'REAL');
  safeAlter('snapshots', 'tangle_ratio', 'REAL');
  safeAlter('snapshots', 'avg_complexity', 'REAL');
  safeAlter('snapshots', 'brain_methods', 'INTEGER');
  safeAlter('symbol_metrics', 'cyclomatic_density', 'REAL');
  safeAlter('symbol_metrics', 'halstead_volume', 'REAL');
  safeAlter('symbol_metrics', 'halstead_difficulty', 'REAL');
  safeAlter('symbol_metrics', 'halstead_effort', 'REAL');
  safeAlter('symbol_metrics', 'halstead_bugs', 'REAL');
  safeAlter('files', 'file_role', "TEXT DEFAULT 'source'");
}

/**
 * Open a SQLite database with optimized settings.
 * @param {object} opts
 * @param {boolean} [opts.readonly=false]
 * @param {string|null} [opts.projectRoot=null]
 * @returns {import('better-sqlite3').Database}
 */
export function openDb({ readonly = false, projectRoot = null } = {}) {
  const dbPath = getDbPath(projectRoot);

  const db = new Database(dbPath, {
    readonly,
    timeout: 30000,
  });

  const cloud = isCloudSynced(dbPath);
  if (!readonly) {
    if (cloud) {
      db.pragma('journal_mode = DELETE');
      db.pragma('locking_mode = EXCLUSIVE');
    } else {
      db.pragma('journal_mode = WAL');
    }
  }
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');

  if (!readonly) {
    db.exec(SCHEMA_SQL);
    ensureMigrations(db);
  }

  return db;
}

/**
 * Check if an index database exists.
 */
export function dbExists(projectRoot = null) {
  const dbPath = getDbPath(projectRoot);
  try {
    return existsSync(dbPath) && statSync(dbPath).size > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Batched IN-clause helpers — avoid SQLITE_MAX_VARIABLE_NUMBER (default 999)
// ---------------------------------------------------------------------------

const BATCH_SIZE = 400;

/**
 * Execute sql with {ph} placeholder(s) in batches.
 * Handles single and double IN-clauses automatically.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sql - SQL with {ph} placeholders
 * @param {number[]} ids
 * @param {object} [opts]
 * @param {any[]} [opts.pre=[]]
 * @param {any[]} [opts.post=[]]
 * @param {number} [opts.batchSize=400]
 * @returns {any[]}
 */
export function batchedIn(db, sql, ids, { pre = [], post = [], batchSize = BATCH_SIZE } = {}) {
  if (!ids.length) return [];
  const nPh = (sql.match(/\{ph\}/g) || []).length;
  const chunk = Math.max(1, Math.floor(batchSize / Math.max(nPh, 1)));

  const rows = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const batch = ids.slice(i, i + chunk);
    const ph = batch.map(() => '?').join(',');
    const q = sql.replaceAll('{ph}', ph);
    const params = [...pre];
    for (let j = 0; j < nPh; j++) params.push(...batch);
    params.push(...post);
    rows.push(...db.prepare(q).all(...params));
  }
  return rows;
}

/**
 * Like batchedIn but sums scalar results (for COUNT queries).
 */
export function batchedCount(db, sql, ids, { pre = [], post = [], batchSize = BATCH_SIZE } = {}) {
  if (!ids.length) return 0;
  const nPh = (sql.match(/\{ph\}/g) || []).length;
  const chunk = Math.max(1, Math.floor(batchSize / Math.max(nPh, 1)));

  let total = 0;
  for (let i = 0; i < ids.length; i += chunk) {
    const batch = ids.slice(i, i + chunk);
    const ph = batch.map(() => '?').join(',');
    const q = sql.replaceAll('{ph}', ph);
    const params = [...pre];
    for (let j = 0; j < nPh; j++) params.push(...batch);
    params.push(...post);
    const row = db.prepare(q).get(...params);
    total += Object.values(row)[0];
  }
  return total;
}
