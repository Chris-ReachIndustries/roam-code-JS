/**
 * roam coupling — Show co-change coupling between files.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const paths = opts.paths || [];
    const minStrength = opts.minStrength != null ? Number(opts.minStrength) : 3;
    const top = opts.top != null ? Number(opts.top) : 50;

    let rows;
    if (paths.length) {
      // Show coupling partners for specific files
      const fileRows = [];
      for (const p of paths) {
        const file = db.prepare('SELECT id, path FROM files WHERE path = ? OR path LIKE ?').get(p, `%${p}`);
        if (file) fileRows.push(file);
      }
      if (!fileRows.length) {
        console.log('No matching files found in the index.');
        return;
      }

      const fileIds = fileRows.map(f => f.id);
      const ph = fileIds.map(() => '?').join(',');
      rows = db.prepare(`
        SELECT fa.path as file_a, fb.path as file_b, gc.cochange_count
        FROM git_cochange gc
        JOIN files fa ON gc.file_id_a = fa.id
        JOIN files fb ON gc.file_id_b = fb.id
        WHERE (gc.file_id_a IN (${ph}) OR gc.file_id_b IN (${ph}))
          AND gc.cochange_count >= ?
        ORDER BY gc.cochange_count DESC
        LIMIT ?
      `).all(...fileIds, ...fileIds, minStrength, top);
    } else {
      // Show all coupling pairs
      rows = db.prepare(`
        SELECT fa.path as file_a, fb.path as file_b, gc.cochange_count
        FROM git_cochange gc
        JOIN files fa ON gc.file_id_a = fa.id
        JOIN files fb ON gc.file_id_b = fb.id
        WHERE gc.cochange_count >= ?
        ORDER BY gc.cochange_count DESC
        LIMIT ?
      `).all(minStrength, top);
    }

    // Classify coupling strength
    const classified = rows.map(r => ({
      file_a: r.file_a,
      file_b: r.file_b,
      count: r.cochange_count,
      classification: r.cochange_count > 10 ? 'tight' : r.cochange_count > 5 ? 'moderate' : 'loose',
    }));

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('coupling', {
        summary: {
          pairs: classified.length,
          min_strength: minStrength,
          tight: classified.filter(c => c.classification === 'tight').length,
          moderate: classified.filter(c => c.classification === 'moderate').length,
          loose: classified.filter(c => c.classification === 'loose').length,
        },
        pairs: classified,
      })));
    } else {
      if (!classified.length) {
        console.log(`No co-change pairs with strength >= ${minStrength}.`);
        return;
      }
      console.log(`File Coupling (min strength: ${minStrength}, showing ${classified.length}):\n`);
      const headers = ['File A', 'File B', 'Count', 'Strength'];
      const tableRows = classified.map(c => [c.file_a, c.file_b, c.count, c.classification]);
      console.log(formatTable(headers, tableRows));
    }
  } finally {
    db.close();
  }
}
