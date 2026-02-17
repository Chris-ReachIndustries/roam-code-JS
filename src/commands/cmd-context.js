/**
 * roam context — Show symbol context with callers, callees, tests, and metrics.
 * Supports task modes: refactor, debug, extend, review, understand.
 */

import { openDb } from '../db/connection.js';
import { SYMBOLS_IN_FILE, FILE_BY_PATH } from '../db/queries.js';
import { ensureIndex, findSymbol } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc, formatSignature, section } from '../output/formatter.js';
import { gatherSymbolContext, gatherTaskExtras, batchContext, getSymbolMetrics, getGraphMetrics, getBlastRadius, getClusterInfo } from './context-helpers.js';

const VALID_TASKS = ['refactor', 'debug', 'extend', 'review', 'understand'];

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const task = opts.task || null;
    const forFile = opts.forFile || false;
    let names = opts.names || [];
    if (typeof names === 'string') names = [names];

    if (task && !VALID_TASKS.includes(task)) {
      console.error(`Invalid task '${task}'. Valid: ${VALID_TASKS.join(', ')}`);
      process.exit(1);
    }

    // --for-file mode: resolve path to file, gather all exported symbols
    if (forFile) {
      const path = names[0];
      if (!path) {
        console.error('--for-file requires a file path.');
        process.exit(1);
      }
      const normalized = path.replace(/\\/g, '/');
      let file = db.prepare(FILE_BY_PATH).get(normalized);
      if (!file) {
        const rows = db.prepare('SELECT * FROM files WHERE path LIKE ? LIMIT 1').all(`%${normalized}%`);
        file = rows[0] || null;
      }
      if (!file) {
        console.error(`File '${path}' not found in index.`);
        process.exit(1);
      }
      const syms = db.prepare(SYMBOLS_IN_FILE).all(file.id).filter(s => s.is_exported);
      if (!syms.length) {
        console.log(`No exported symbols found in ${file.path}`);
        return;
      }
      return _renderMultiSymbol(db, syms, task, jsonMode);
    }

    if (!names.length) {
      console.error('No symbol names specified. Usage: roam context <name> [name2 ...]');
      process.exit(1);
    }

    // Resolve symbols
    const symbols = [];
    const notFound = [];
    for (const name of names) {
      const sym = findSymbol(db, name);
      if (sym) symbols.push(sym);
      else notFound.push(name);
    }

    if (!symbols.length) {
      console.error(`No symbols found: ${notFound.join(', ')}`);
      process.exit(1);
    }

    if (symbols.length === 1) {
      _renderSingleSymbol(db, symbols[0], task, jsonMode);
    } else {
      _renderMultiSymbol(db, symbols, task, jsonMode);
    }

    if (notFound.length && !jsonMode) {
      console.log(`\nNot found: ${notFound.join(', ')}`);
    }
  } finally {
    db.close();
  }
}

function _renderSingleSymbol(db, sym, task, jsonMode) {
  const ctx = gatherSymbolContext(db, sym);
  const extras = task ? gatherTaskExtras(db, sym, ctx, task) : {};
  const graph = getGraphMetrics(db, sym.id);
  const blastRadius = getBlastRadius(db, sym.id);

  if (jsonMode) {
    console.log(toJson(jsonEnvelope('context', {
      summary: {
        symbol: sym.name,
        task: task || 'general',
        callers: ctx.callers.length,
        callees: ctx.callees.length,
        tests: ctx.tests.length,
      },
      symbol: {
        name: sym.name,
        qualified_name: sym.qualified_name,
        kind: sym.kind,
        signature: sym.signature || null,
        location: loc(sym.file_path, sym.line_start),
        docstring: sym.docstring || null,
      },
      graph,
      blast_radius: blastRadius,
      callers: ctx.callers.slice(0, 30).map(c => ({
        name: c.name, kind: c.kind, edge_kind: c.edge_kind,
        location: loc(c.file_path, c.line_start),
      })),
      callees: ctx.callees.slice(0, 30).map(c => ({
        name: c.name, kind: c.kind, edge_kind: c.edge_kind,
        location: loc(c.file_path, c.line_start),
      })),
      tests: ctx.tests.map(t => ({ name: t.name, location: loc(t.file_path) })),
      files_to_read: ctx.files_to_read,
      ...extras,
    })));
    return;
  }

  // Text output
  const lines = [];
  lines.push(`=== Context: ${sym.qualified_name || sym.name} ===`);
  if (task) lines.push(`Task: ${task}`);
  lines.push('');

  // Symbol header
  lines.push(`${abbrevKind(sym.kind)}  ${sym.qualified_name || sym.name}`);
  if (sym.signature) lines.push(`  ${formatSignature(sym.signature)}`);
  lines.push(`  ${loc(sym.file_path, sym.line_start)}`);

  // Graph metrics
  lines.push('');
  lines.push(`PageRank: ${graph.pagerank.toFixed(4)}  In: ${graph.in_degree}  Out: ${graph.out_degree}  Blast: ${blastRadius.symbols} syms / ${blastRadius.files} files`);

  // Complexity (if available via task or always)
  if (extras.complexity) {
    const cm = extras.complexity;
    lines.push(`Complexity: cognitive=${cm.cognitive_complexity || '?'}  nesting=${cm.nesting_depth || '?'}  params=${cm.param_count || '?'}`);
  }

  // Callers
  if (ctx.callers.length) {
    lines.push('');
    lines.push(`Callers (${ctx.callers.length}):`);
    const headers = ['Name', 'Kind', 'Location'];
    const rows = ctx.callers.slice(0, 15).map(c => [c.name, abbrevKind(c.kind), loc(c.file_path, c.line_start)]);
    lines.push(formatTable(headers, rows));
    if (ctx.callers.length > 15) lines.push(`(+${ctx.callers.length - 15} more)`);
  }

  // Callees
  if (ctx.callees.length) {
    lines.push('');
    lines.push(`Callees (${ctx.callees.length}):`);
    const headers = ['Name', 'Kind', 'Location'];
    const rows = ctx.callees.slice(0, 15).map(c => [c.name, abbrevKind(c.kind), loc(c.file_path, c.line_start)]);
    lines.push(formatTable(headers, rows));
    if (ctx.callees.length > 15) lines.push(`(+${ctx.callees.length - 15} more)`);
  }

  // Tests
  if (ctx.tests.length) {
    lines.push('');
    lines.push(`Affected Tests (${ctx.tests.length}):`);
    for (const t of ctx.tests.slice(0, 10)) {
      lines.push(`  ${t.name}  ${t.file_path}`);
    }
  }

  // Task extras
  if (extras.similar && extras.similar.length) {
    lines.push('');
    lines.push(`Similar Symbols (${extras.similar.length}):`);
    for (const s of extras.similar.slice(0, 5)) {
      lines.push(`  ${abbrevKind(s.kind)}  ${s.name}  ${loc(s.file_path, s.line_start)}`);
    }
  }

  if (extras.entry_points && extras.entry_points.length) {
    lines.push('');
    lines.push(`Entry Points:`);
    for (const ep of extras.entry_points) {
      lines.push(`  ${abbrevKind(ep.kind)}  ${ep.name}  ${ep.file_path}`);
    }
  }

  if (extras.cluster) {
    lines.push('');
    lines.push(`Cluster: ${extras.cluster.label} (${extras.cluster.size} symbols)`);
  }

  if (extras.churn) {
    lines.push('');
    lines.push(`Churn: ${extras.churn.commit_count} commits, ${extras.churn.total_churn} lines, ${extras.churn.distinct_authors} authors`);
  }

  if (extras.coupling && extras.coupling.length) {
    lines.push('');
    lines.push(`Coupling:`);
    for (const c of extras.coupling.slice(0, 5)) {
      lines.push(`  ${c.path}  (${c.count}×, ${c.strength})`);
    }
  }

  // Files to read
  lines.push('');
  lines.push(`Files to read (${ctx.files_to_read.length}):`);
  for (const f of ctx.files_to_read) lines.push(`  ${f}`);

  console.log(lines.join('\n'));
}

function _renderMultiSymbol(db, symbols, task, jsonMode) {
  const batch = batchContext(db, symbols);

  if (jsonMode) {
    const symData = symbols.map(sym => {
      const graph = getGraphMetrics(db, sym.id);
      return {
        name: sym.name,
        qualified_name: sym.qualified_name,
        kind: sym.kind,
        location: loc(sym.file_path, sym.line_start),
        pagerank: graph.pagerank,
      };
    });

    console.log(toJson(jsonEnvelope('context', {
      summary: {
        symbols: symbols.length,
        task: task || 'general',
        shared_callers: batch.shared_callers.length,
        shared_callees: batch.shared_callees.length,
      },
      symbols: symData,
      shared_callers: batch.shared_callers.slice(0, 20).map(c => ({
        name: c.name, kind: c.kind, shared_count: c.shared_count,
        location: loc(c.file_path, c.line_start),
      })),
      shared_callees: batch.shared_callees.slice(0, 20).map(c => ({
        name: c.name, kind: c.kind, shared_count: c.shared_count,
        location: loc(c.file_path, c.line_start),
      })),
    })));
    return;
  }

  console.log(`=== Context: ${symbols.length} symbols ===\n`);

  for (const sym of symbols) {
    const graph = getGraphMetrics(db, sym.id);
    console.log(`  ${abbrevKind(sym.kind)}  ${sym.name}  PR:${graph.pagerank.toFixed(4)}  ${loc(sym.file_path, sym.line_start)}`);
  }

  if (batch.shared_callers.length) {
    console.log(`\nShared Callers (${batch.shared_callers.length}):`);
    const headers = ['Name', 'Kind', 'Shared', 'Location'];
    const rows = batch.shared_callers.slice(0, 15).map(c => [
      c.name, abbrevKind(c.kind), `${c.shared_count}×`, loc(c.file_path, c.line_start),
    ]);
    console.log(formatTable(headers, rows));
  }

  if (batch.shared_callees.length) {
    console.log(`\nShared Callees (${batch.shared_callees.length}):`);
    const headers = ['Name', 'Kind', 'Shared', 'Location'];
    const rows = batch.shared_callees.slice(0, 15).map(c => [
      c.name, abbrevKind(c.kind), `${c.shared_count}×`, loc(c.file_path, c.line_start),
    ]);
    console.log(formatTable(headers, rows));
  }
}
