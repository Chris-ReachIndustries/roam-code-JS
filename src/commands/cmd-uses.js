/**
 * roam uses — Find all consumers of a symbol.
 */

import { openDb } from '../db/connection.js';
import { SYMBOL_BY_NAME, SEARCH_SYMBOLS } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';

const DISPLAY_ORDER = ['call', 'import', 'template', 'inherits', 'implements', 'uses_trait', 'uses', 'reference'];

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const name = opts.name;
    const full = opts.full || false;

    // Find target symbol(s)
    let targets = db.prepare(SYMBOL_BY_NAME).all(name);
    if (!targets.length) {
      targets = db.prepare(SEARCH_SYMBOLS).all(`%${name}%`, 50);
    }
    if (!targets.length) {
      console.error(`Symbol '${name}' not found.`);
      process.exit(1);
    }

    const targetIds = targets.map(t => t.id);
    const ph = targetIds.map(() => '?').join(',');

    // Get all incoming edges
    const edges = db.prepare(
      `SELECT s.name, s.qualified_name, s.kind, s.line_start, f.path as file_path,
              e.kind as edge_kind, e.line as edge_line, t.name as target_name
       FROM edges e
       JOIN symbols s ON e.source_id = s.id
       JOIN symbols t ON e.target_id = t.id
       JOIN files f ON s.file_id = f.id
       WHERE e.target_id IN (${ph})`
    ).all(...targetIds);

    // Group by edge kind
    const groups = new Map();
    for (const e of edges) {
      const key = e.edge_kind;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    // Dedup within each group by (qualified_name, file_path)
    for (const [kind, items] of groups) {
      const seen = new Set();
      groups.set(kind, items.filter(e => {
        const key = `${e.qualified_name}|${e.file_path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
    }

    const totalConsumers = [...groups.values()].reduce((s, g) => s + g.length, 0);
    const allFiles = new Set(edges.map(e => e.file_path));

    if (jsonMode) {
      const consumers = {};
      for (const kind of DISPLAY_ORDER) {
        if (groups.has(kind)) {
          consumers[kind] = groups.get(kind).map(e => ({
            name: e.name, kind: e.kind, location: loc(e.file_path, e.line_start),
          }));
        }
      }
      // Include any kinds not in DISPLAY_ORDER
      for (const [kind, items] of groups) {
        if (!consumers[kind]) {
          consumers[kind] = items.map(e => ({
            name: e.name, kind: e.kind, location: loc(e.file_path, e.line_start),
          }));
        }
      }
      console.log(toJson(jsonEnvelope('uses', {
        summary: { symbol: name, total_consumers: totalConsumers, total_files: allFiles.size },
        consumers,
      })));
    } else {
      if (!totalConsumers) {
        console.log(`No consumers of '${name}' found.`);
        return;
      }

      console.log(`=== Consumers of '${name}' ===\n`);

      for (const kind of DISPLAY_ORDER) {
        const items = groups.get(kind);
        if (!items || !items.length) continue;
        console.log(`${kind} (${items.length}):`);
        const headers = ['Kind', 'Name', 'Location'];
        const rows = items.map(e => [abbrevKind(e.kind), e.name, loc(e.file_path, e.line_start)]);
        console.log(formatTable(headers, rows, full ? 0 : 20));
        console.log('');
      }

      // Any remaining kinds
      for (const [kind, items] of groups) {
        if (DISPLAY_ORDER.includes(kind)) continue;
        console.log(`${kind} (${items.length}):`);
        const headers = ['Kind', 'Name', 'Location'];
        const rows = items.map(e => [abbrevKind(e.kind), e.name, loc(e.file_path, e.line_start)]);
        console.log(formatTable(headers, rows, full ? 0 : 20));
        console.log('');
      }

      console.log(`Total: ${totalConsumers} consumers across ${allFiles.size} files`);
    }
  } finally {
    db.close();
  }
}
