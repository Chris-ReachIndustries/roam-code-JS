/**
 * roam deps — Show file import/imported-by relationships.
 */

import { openDb } from '../db/connection.js';
import { FILE_BY_PATH, FILE_IMPORTS, FILE_IMPORTED_BY } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const path = opts.path;
    const full = opts.full || false;

    const file = _resolveFile(db, path);
    if (!file) {
      console.error(`File '${path}' not found in index.`);
      process.exit(1);
    }

    const imports = db.prepare(FILE_IMPORTS).all(file.id);
    const importedBy = db.prepare(FILE_IMPORTED_BY).all(file.id);

    // Track which symbols are used per import
    const usedSymbols = new Map();
    if (imports.length) {
      const rows = db.prepare(
        `SELECT s_tgt.file_id, s_tgt.name
         FROM edges e
         JOIN symbols s_src ON e.source_id = s_src.id
         JOIN symbols s_tgt ON e.target_id = s_tgt.id
         WHERE s_src.file_id = ? AND s_tgt.file_id != ?`
      ).all(file.id, file.id);
      for (const r of rows) {
        if (!usedSymbols.has(r.file_id)) usedSymbols.set(r.file_id, new Set());
        usedSymbols.get(r.file_id).add(r.name);
      }
    }

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('deps', {
        summary: { file: file.path, imports: imports.length, imported_by: importedBy.length },
        imports: imports.map(f => ({
          path: f.path,
          symbol_count: f.symbol_count || 0,
          used_symbols: [...(usedSymbols.get(f.id) || [])],
        })),
        imported_by: importedBy.map(f => ({
          path: f.path,
          symbol_count: f.symbol_count || 0,
        })),
      })));
    } else {
      console.log(`File: ${file.path}\n`);

      if (imports.length) {
        console.log(`Imports (${imports.length}):`);
        const headers = ['File', 'Symbols', 'Used'];
        const rows = imports.map(f => {
          const used = usedSymbols.get(f.id);
          let usedStr = '';
          if (used) {
            const names = [...used];
            usedStr = names.length <= 5 ? names.join(', ') : names.slice(0, 5).join(', ') + ` +${names.length - 5}`;
          }
          return [f.path, f.symbol_count || 0, usedStr];
        });
        console.log(formatTable(headers, rows, full ? 0 : 30));
      } else {
        console.log('Imports: (none)');
      }

      console.log('');

      if (importedBy.length) {
        console.log(`Imported by (${importedBy.length}):`);
        const headers = ['File', 'Symbols'];
        const rows = importedBy.map(f => [f.path, f.symbol_count || 0]);
        console.log(formatTable(headers, rows, full ? 0 : 30));
      } else {
        console.log('Imported by: (none)');
      }
    }
  } finally {
    db.close();
  }
}

function _resolveFile(db, path) {
  const normalized = path.replace(/\\/g, '/');
  let row = db.prepare(FILE_BY_PATH).get(normalized);
  if (row) return row;
  // Fuzzy fallback
  const rows = db.prepare('SELECT * FROM files WHERE path LIKE ? ORDER BY path LIMIT 5').all(`%${normalized}%`);
  return rows.length === 1 ? rows[0] : rows[0] || null;
}
