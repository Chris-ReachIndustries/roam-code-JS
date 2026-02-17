/**
 * roam grep — Semantic grep across symbol names, signatures, and qualified names.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc, formatSignature, KIND_ABBREV } from '../output/formatter.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const pattern = opts.pattern;
    const kindFilter = opts.kind || null;
    const fileFilter = opts.file || null;
    const showContext = opts.context || false;

    // Build dynamic query — search name, qualified_name, and signature
    let sql = `
      SELECT s.id, s.name, s.qualified_name, s.kind, s.signature,
             f.path as file_path, s.line_start, s.line_end
      FROM symbols s JOIN files f ON s.file_id = f.id
      WHERE (s.name LIKE ? COLLATE NOCASE
             OR s.qualified_name LIKE ? COLLATE NOCASE
             OR s.signature LIKE ? COLLATE NOCASE)
    `;
    const params = [`%${pattern}%`, `%${pattern}%`, `%${pattern}%`];

    if (kindFilter) {
      const resolved = _resolveKind(kindFilter);
      sql += ' AND s.kind = ?';
      params.push(resolved);
    }

    if (fileFilter) {
      sql += ' AND f.path LIKE ?';
      params.push(`%${fileFilter.replace(/\*/g, '%')}%`);
    }

    sql += ' ORDER BY s.name LIMIT 200';

    const rows = db.prepare(sql).all(...params);

    // Optionally fetch context (callers/callees counts)
    let contextMap = null;
    if (showContext && rows.length) {
      contextMap = new Map();
      const ids = rows.map(r => r.id);
      const ph = ids.map(() => '?').join(',');

      const callerCounts = db.prepare(
        `SELECT target_id, COUNT(*) as cnt FROM edges WHERE target_id IN (${ph}) GROUP BY target_id`
      ).all(...ids);
      const calleeCounts = db.prepare(
        `SELECT source_id, COUNT(*) as cnt FROM edges WHERE source_id IN (${ph}) GROUP BY source_id`
      ).all(...ids);

      const callerMap = new Map(callerCounts.map(c => [c.target_id, c.cnt]));
      const calleeMap = new Map(calleeCounts.map(c => [c.source_id, c.cnt]));

      for (const r of rows) {
        contextMap.set(r.id, {
          callers: callerMap.get(r.id) || 0,
          callees: calleeMap.get(r.id) || 0,
        });
      }
    }

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('grep', {
        summary: { pattern, matches: rows.length, kind: kindFilter || 'all', file: fileFilter || 'all' },
        results: rows.map(r => ({
          name: r.name, qualified_name: r.qualified_name, kind: r.kind,
          signature: r.signature || null,
          location: loc(r.file_path, r.line_start),
          ...(contextMap ? { callers: contextMap.get(r.id).callers, callees: contextMap.get(r.id).callees } : {}),
        })),
      })));
    } else {
      if (!rows.length) {
        console.log(`No symbols matching '${pattern}'.`);
        return;
      }
      console.log(`Grep: ${rows.length} matches for '${pattern}':\n`);
      const headers = ['Name', 'Kind', 'Signature', 'File', 'Line'];
      if (showContext) { headers.push('In', 'Out'); }
      const tableRows = rows.map(r => {
        const row = [
          r.qualified_name !== r.name ? r.qualified_name : r.name,
          abbrevKind(r.kind),
          formatSignature(r.signature, 40),
          r.file_path,
          r.line_start || '-',
        ];
        if (showContext && contextMap) {
          const ctx = contextMap.get(r.id);
          row.push(ctx.callers, ctx.callees);
        }
        return row;
      });
      console.log(formatTable(headers, tableRows));
    }
  } finally {
    db.close();
  }
}

function _resolveKind(abbrev) {
  for (const [full, short] of Object.entries(KIND_ABBREV)) {
    if (short === abbrev || full === abbrev) return full;
  }
  return abbrev;
}
