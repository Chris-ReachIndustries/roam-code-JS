/**
 * Show project skeleton with entry points and key symbols.
 */

import { basename } from 'node:path';
import { openDb } from '../db/connection.js';
import { ALL_FILES, TOP_SYMBOLS_BY_PAGERANK } from '../db/queries.js';
import { abbrevKind, loc, formatSignature, formatTable, section, toJson, jsonEnvelope } from '../output/formatter.js';
import { ensureIndex } from './resolve.js';

function estimateTokens(text) {
  return Math.max(1, Math.floor(text.length / 4));
}

function buildSymbolEntryText(s) {
  const sig = formatSignature(s.signature, 50);
  const kind = abbrevKind(s.kind);
  const location = loc(s.file_path, s.line_start);
  const pr = (s.pagerank || 0).toFixed(4);
  return `${kind}  ${s.name}  ${sig}  ${location}  ${pr}`;
}

export async function execute(opts, globalOpts) {
  const jsonMode = globalOpts.json || false;
  const count = opts.count || 20;
  const full = opts.full || false;
  const budget = opts.budget || null;
  ensureIndex();

  const db = openDb({ readonly: true });
  try {
    // --- Project stats ---
    const files = db.prepare(ALL_FILES).all();
    const totalFiles = files.length;
    const symCount = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get().cnt;
    const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM edges').get().cnt;

    const langCounts = new Map();
    for (const f of files) {
      if (f.language) langCounts.set(f.language, (langCounts.get(f.language) || 0) + 1);
    }
    const langSorted = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);

    // Edge kind distribution
    const edgeKinds = db.prepare(
      'SELECT kind, COUNT(*) as cnt FROM edges GROUP BY kind ORDER BY cnt DESC'
    ).all();

    // --- Top directories ---
    const dirRowsRaw = db.prepare(`
      SELECT CASE WHEN INSTR(REPLACE(path, '\\', '/'), '/') > 0
             THEN SUBSTR(REPLACE(path, '\\', '/'), 1, INSTR(REPLACE(path, '\\', '/'), '/') - 1)
             ELSE '.' END as dir,
             COUNT(*) as cnt
      FROM files GROUP BY dir ORDER BY cnt DESC
    `).all();
    const dirItems = dirRowsRaw.map(r => [r.dir, r.cnt]);

    // --- Entry points ---
    const entryNames = new Set([
      'main.py', '__main__.py', '__init__.py', 'index.js', 'index.ts',
      'main.go', 'main.rs', 'app.py', 'app.js', 'app.ts',
      'mod.rs', 'lib.rs', 'setup.py', 'manage.py',
    ]);

    let entries = files
      .filter(f => entryNames.has(basename(f.path)))
      .map(f => f.path);

    // Filter barrel files
    const barrelPaths = new Set();
    for (const f of files) {
      const bn = basename(f.path);
      if (bn.startsWith('index.') && entries.includes(f.path)) {
        const ownDefs = db.prepare(
          "SELECT COUNT(*) as cnt FROM symbols WHERE file_id = ? AND kind IN ('function', 'class', 'method')"
        ).get(f.id).cnt;
        if (ownDefs <= 2) barrelPaths.add(f.path);
      }
    }
    entries = entries.filter(e => !barrelPaths.has(e));

    // main() functions
    const mainFiles = db.prepare(
      "SELECT DISTINCT f.path FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.name = 'main' AND s.kind = 'function'"
    ).all();
    for (const r of mainFiles) {
      if (!entries.includes(r.path)) entries.push(r.path);
    }

    // --- Top symbols by PageRank ---
    const fetchLimit = budget != null ? 10000 : count;
    const allRanked = db.prepare(TOP_SYMBOLS_BY_PAGERANK).all(fetchLimit);

    let top;
    let tokensUsed = 0;

    if (budget != null) {
      const langStr = langSorted.slice(0, 8).map(([l, n]) => `${l}=${n}`).join(', ');
      const edgeStr = edgeKinds.length ? edgeKinds.map(r => `${r.kind}=${r.cnt}`).join(', ') : 'none';
      const preambleLines = [
        `Files: ${totalFiles}  Symbols: ${symCount}  Edges: ${edgeCount}`,
        `Languages: ${langStr}`,
        `Edge kinds: ${edgeStr}`,
        '',
      ];
      const dirRows = (full ? dirItems : dirItems.slice(0, 15)).map(([d, c]) => [d, String(c)]);
      preambleLines.push('Directories:');
      preambleLines.push(formatTable(['dir', 'files'], dirRows, full ? 0 : 15));
      preambleLines.push('');

      if (entries.length) {
        preambleLines.push('Entry points:');
        for (const e of (full ? entries : entries.slice(0, 20))) preambleLines.push(`  ${e}`);
        if (!full && entries.length > 20) preambleLines.push(`  (+${entries.length - 20} more)`);
        preambleLines.push('');
      }

      const preambleText = preambleLines.join('\n');
      tokensUsed = estimateTokens(preambleText);

      top = [];
      for (const s of allRanked) {
        const entryTokens = estimateTokens(buildSymbolEntryText(s));
        if (tokensUsed + entryTokens > budget) break;
        tokensUsed += entryTokens;
        top.push(s);
      }
    } else {
      top = allRanked;
    }

    if (jsonMode) {
      const data = {
        files: totalFiles, symbols: symCount, edges: edgeCount,
        languages: Object.fromEntries(langSorted.slice(0, 8)),
        edge_kinds: Object.fromEntries(edgeKinds.map(r => [r.kind, r.cnt])),
        directories: dirItems.map(([name, cnt]) => ({ name, files: cnt })),
        entry_points: entries,
        top_symbols: top.map(s => ({
          name: s.name, kind: s.kind, signature: s.signature || '',
          location: loc(s.file_path, s.line_start),
          pagerank: Math.round((s.pagerank || 0) * 10000) / 10000,
        })),
      };
      const summary = { files: totalFiles, symbols: symCount, edges: edgeCount };
      if (budget != null) {
        summary.token_budget = budget;
        summary.tokens_used = tokensUsed;
        data.token_budget = budget;
        data.tokens_used = tokensUsed;
      }
      console.log(toJson(jsonEnvelope('map', { summary, ...data })));
      return;
    }

    // --- Text output ---
    const langStr = langSorted.slice(0, 8).map(([l, n]) => `${l}=${n}`).join(', ');
    const edgeStr = edgeKinds.length ? edgeKinds.map(r => `${r.kind}=${r.cnt}`).join(', ') : 'none';

    console.log(`Files: ${totalFiles}  Symbols: ${symCount}  Edges: ${edgeCount}`);
    console.log(`Languages: ${langStr}`);
    console.log(`Edge kinds: ${edgeStr}`);
    console.log();

    const dirRows = (full ? dirItems : dirItems.slice(0, 15)).map(([d, c]) => [d, String(c)]);
    console.log('Directories:');
    console.log(formatTable(['dir', 'files'], dirRows, full ? 0 : 15));
    console.log();

    if (entries.length) {
      console.log('Entry points:');
      for (const e of (full ? entries : entries.slice(0, 20))) console.log(`  ${e}`);
      if (!full && entries.length > 20) console.log(`  (+${entries.length - 20} more)`);
      console.log();
    }

    if (top.length) {
      const rows = top.map(s => [
        abbrevKind(s.kind), s.name, formatSignature(s.signature, 50),
        loc(s.file_path, s.line_start), (s.pagerank || 0).toFixed(4),
      ]);
      console.log('Top symbols (PageRank):');
      console.log(formatTable(['kind', 'name', 'signature', 'location', 'PR'], rows));
    } else {
      console.log('No graph metrics available. Run `roam index` first.');
    }

    if (budget != null) {
      console.log();
      console.log(`Token budget: ${tokensUsed}/${budget} used`);
    }
  } finally {
    db.close();
  }
}
