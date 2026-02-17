/**
 * roam symbol — Show symbol definition with callers, callees, and metrics.
 */

import { openDb } from '../db/connection.js';
import { METRICS_FOR_SYMBOL, CALLERS_OF, CALLEES_OF } from '../db/queries.js';
import { ensureIndex, findSymbol } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc, formatSignature, formatEdgeKind, truncateLines } from '../output/formatter.js';

const EDGE_PRIORITY = { call: 1, uses: 2, inherits: 3, implements: 4, template: 5, import: 6, reference: 7 };

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const name = opts.name;
    const full = opts.full || false;

    const sym = findSymbol(db, name);
    if (!sym) {
      console.error(`Symbol '${name}' not found.`);
      process.exit(1);
    }

    const metrics = db.prepare(METRICS_FOR_SYMBOL).get(sym.id);
    const callers = _dedupEdges(db.prepare(CALLERS_OF).all(sym.id));
    const callees = _dedupEdges(db.prepare(CALLEES_OF).all(sym.id));

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('symbol', {
        symbol: {
          name: sym.name,
          qualified_name: sym.qualified_name,
          kind: sym.kind,
          signature: sym.signature,
          location: loc(sym.file_path, sym.line_start),
          docstring: sym.docstring || null,
        },
        metrics: metrics ? {
          pagerank: metrics.pagerank,
          in_degree: metrics.in_degree,
          out_degree: metrics.out_degree,
          betweenness: metrics.betweenness,
        } : null,
        callers: callers.map(c => ({
          name: c.name, kind: c.kind, edge_kind: c.edge_kind,
          location: loc(c.file_path, c.line_start),
        })),
        callees: callees.map(c => ({
          name: c.name, kind: c.kind, edge_kind: c.edge_kind,
          location: loc(c.file_path, c.line_start),
        })),
      })));
    } else {
      const lines = [];
      lines.push(`${abbrevKind(sym.kind)}  ${sym.qualified_name || sym.name}`);
      if (sym.signature) lines.push(`  ${formatSignature(sym.signature)}`);
      lines.push(`  ${loc(sym.file_path, sym.line_start)}`);

      if (sym.docstring) {
        const docLines = sym.docstring.split('\n');
        const shown = full ? docLines : docLines.slice(0, 5);
        lines.push('');
        for (const dl of shown) lines.push(`  ${dl}`);
        if (!full && docLines.length > 5) lines.push(`  (+${docLines.length - 5} more lines)`);
      }

      if (metrics) {
        lines.push('');
        lines.push(`  PageRank: ${(metrics.pagerank || 0).toFixed(4)}  In: ${metrics.in_degree || 0}  Out: ${metrics.out_degree || 0}`);
      }

      if (callers.length) {
        lines.push('');
        lines.push(`Callers (${callers.length}):`);
        const headers = ['Name', 'Kind', 'Edge', 'Location'];
        const rows = callers.map(c => [
          c.name, abbrevKind(c.kind), formatEdgeKind(c.edge_kind), loc(c.file_path, c.line_start),
        ]);
        lines.push(formatTable(headers, rows, full ? 0 : 15));
      }

      if (callees.length) {
        lines.push('');
        lines.push(`Callees (${callees.length}):`);
        const headers = ['Name', 'Kind', 'Edge', 'Location'];
        const rows = callees.map(c => [
          c.name, abbrevKind(c.kind), formatEdgeKind(c.edge_kind), loc(c.file_path, c.line_start),
        ]);
        lines.push(formatTable(headers, rows, full ? 0 : 15));
      }

      console.log(lines.join('\n'));
    }
  } finally {
    db.close();
  }
}

function _dedupEdges(edges) {
  const byId = new Map();
  for (const e of edges) {
    const existing = byId.get(e.id);
    if (!existing || (EDGE_PRIORITY[e.edge_kind] || 99) < (EDGE_PRIORITY[existing.edge_kind] || 99)) {
      byId.set(e.id, e);
    }
  }
  return [...byId.values()];
}
