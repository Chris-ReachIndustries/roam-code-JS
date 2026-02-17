/**
 * Shared symbol resolution and index helpers for all roam commands.
 */

import { dbExists } from '../db/connection.js';
import { SYMBOL_BY_NAME, SYMBOL_BY_QUALIFIED, SEARCH_SYMBOLS } from '../db/queries.js';

export function ensureIndex() {
  if (!dbExists()) {
    process.stderr.write('No index found. Run `roam index` first.\n');
    process.exit(1);
  }
}

export function pickBest(db, rows) {
  if (!rows || !rows.length) return null;
  if (rows.length === 1) return rows[0];

  const ids = rows.map(r => r.id);
  const ph = ids.map(() => '?').join(',');
  const counts = db.prepare(
    `SELECT target_id, COUNT(*) as cnt FROM edges WHERE target_id IN (${ph}) GROUP BY target_id`
  ).all(...ids);
  const refMap = new Map(counts.map(c => [c.target_id, c.cnt]));
  const best = rows.reduce((a, b) => (refMap.get(b.id) || 0) > (refMap.get(a.id) || 0) ? b : a);
  if ((refMap.get(best.id) || 0) > 0) return best;
  return null;
}

function parseFileHint(name) {
  if (name.includes(':') && !name.includes('::')) {
    const parts = name.split(':', 2);
    if (parts[0] && parts[1]) return [parts[0], parts[1]];
  }
  return [null, name];
}

function filterByFile(rows, fileHint) {
  if (!fileHint) return rows;
  const hint = fileHint.replace(/\\/g, '/').toLowerCase();
  const filtered = rows.filter(r => (r.file_path || '').replace(/\\/g, '/').toLowerCase().includes(hint));
  return filtered.length ? filtered : rows;
}

export function findSymbol(db, name) {
  const [fileHint, symbolName] = parseFileHint(name);

  // 1. Qualified name match
  let rows = db.prepare(SYMBOL_BY_QUALIFIED).all(symbolName);
  rows = filterByFile(rows, fileHint);
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    const best = pickBest(db, rows);
    return best || rows[0];
  }

  // 2. Simple name match
  rows = db.prepare(SYMBOL_BY_NAME).all(symbolName);
  rows = filterByFile(rows, fileHint);
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    const best = pickBest(db, rows);
    return best || rows[0];
  }

  // 3. Fuzzy match
  rows = db.prepare(SEARCH_SYMBOLS).all(`%${symbolName}%`, 10);
  rows = filterByFile(rows, fileHint);
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    const best = pickBest(db, rows);
    return best || rows[0];
  }

  return null;
}
