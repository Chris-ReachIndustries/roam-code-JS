/**
 * roam search — Find symbols matching a name pattern.
 */

import { openDb } from '../db/connection.js';
import { SEARCH_SYMBOLS } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc, formatSignature, KIND_ABBREV } from '../output/formatter.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const pattern = opts.pattern;
    const full = opts.full || false;
    const kindFilter = opts.kind || null;
    const limit = full ? 9999 : 50;

    let rows = db.prepare(SEARCH_SYMBOLS).all(`%${pattern}%`, limit);

    // Kind filter
    if (kindFilter) {
      const target = _resolveKind(kindFilter);
      rows = rows.filter(r => r.kind === target);
    }

    // Batch fetch ref counts
    const refCounts = new Map();
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      const counts = db.prepare(
        `SELECT target_id, COUNT(*) as cnt FROM edges WHERE target_id IN (${ph}) GROUP BY target_id`
      ).all(...ids);
      for (const c of counts) refCounts.set(c.target_id, c.cnt);
    }

    // Total count for truncation message
    const totalRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM symbols WHERE name LIKE ? COLLATE NOCASE'
    ).get(`%${pattern}%`);
    const total = totalRow ? totalRow.cnt : rows.length;

    if (jsonMode) {
      const results = rows.map(r => ({
        name: r.name,
        qualified_name: r.qualified_name,
        kind: r.kind,
        signature: r.signature || null,
        refs: refCounts.get(r.id) || 0,
        pagerank: r.pagerank ? Math.round(r.pagerank * 10000) / 10000 : 0,
        location: loc(r.file_path, r.line_start),
      }));
      console.log(toJson(jsonEnvelope('search', {
        summary: { pattern, total, shown: results.length },
        results,
      })));
    } else {
      if (!rows.length) {
        console.log(`No symbols matching '${pattern}'.`);
        return;
      }
      console.log(`Symbols matching '${pattern}' (${rows.length}${rows.length < total ? ` of ${total}` : ''}):\n`);
      const headers = ['Name', 'Kind', 'Sig', 'Refs', 'PR', 'Location'];
      const tableRows = rows.map(r => [
        r.qualified_name !== r.name ? r.qualified_name : r.name,
        abbrevKind(r.kind),
        formatSignature(r.signature, 40),
        refCounts.get(r.id) || 0,
        r.pagerank ? r.pagerank.toFixed(4) : '0',
        loc(r.file_path, r.line_start),
      ]);
      console.log(formatTable(headers, tableRows, full ? 0 : 50));
    }
  } finally {
    db.close();
  }
}

function _resolveKind(abbrev) {
  // Reverse lookup: 'fn' -> 'function', 'cls' -> 'class', etc.
  for (const [full, short] of Object.entries(KIND_ABBREV)) {
    if (short === abbrev || full === abbrev) return full;
  }
  return abbrev;
}
