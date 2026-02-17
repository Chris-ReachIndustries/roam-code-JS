/**
 * roam file — Show file skeleton with symbols, supports --changed and --deps-of.
 */

import { openDb } from '../db/connection.js';
import { FILE_BY_PATH, SYMBOLS_IN_FILE, FILE_IMPORTS } from '../db/queries.js';
import { ensureIndex, findSymbol } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc, formatSignature } from '../output/formatter.js';
import { getChangedFiles } from './changed-files.js';
import { findProjectRoot } from '../db/connection.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const full = opts.full || false;

    let paths = opts.paths || [];
    if (typeof paths === 'string') paths = [paths];

    // --changed: get changed files from git
    if (opts.changed) {
      const root = findProjectRoot();
      paths = getChangedFiles(root, { staged: false });
      if (!paths.length) {
        if (jsonMode) {
          console.log(toJson(jsonEnvelope('file', { summary: { files: 0 }, files: [] })));
        } else {
          console.log('No changed files detected.');
        }
        return;
      }
    }

    // --deps-of: find file deps of a symbol's file
    if (opts.depsOf) {
      const sym = findSymbol(db, opts.depsOf);
      if (!sym) {
        console.error(`Symbol '${opts.depsOf}' not found.`);
        process.exit(1);
      }
      const imports = db.prepare(FILE_IMPORTS).all(sym.file_id);
      paths = [sym.file_path, ...imports.map(f => f.path)];
    }

    if (!paths.length) {
      console.error('No file paths specified. Usage: roam file <path> [path2 ...]');
      process.exit(1);
    }

    const results = [];
    const missing = [];

    for (const p of paths) {
      const file = _resolveFile(db, p);
      if (!file) { missing.push(p); continue; }
      const skeleton = _buildSkeleton(db, file);
      results.push(skeleton);
    }

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('file', {
        summary: { files: results.length, missing: missing.length },
        files: results.map(s => _skeletonToJson(s)),
        missing,
      })));
    } else {
      for (let i = 0; i < results.length; i++) {
        if (i > 0) console.log('\n' + '-'.repeat(60) + '\n');
        _renderSkeletonText(results[i], full);
      }
      if (missing.length) {
        console.log(`\nNot found: ${missing.join(', ')}`);
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
  const rows = db.prepare('SELECT * FROM files WHERE path LIKE ? ORDER BY path LIMIT 5').all(`%${normalized}%`);
  return rows[0] || null;
}

function _buildSkeleton(db, file) {
  const symbols = db.prepare(SYMBOLS_IN_FILE).all(file.id);

  // File stats
  let stats = null;
  try {
    stats = db.prepare('SELECT * FROM file_stats WHERE file_id = ?').get(file.id);
  } catch { /* table may not exist */ }

  // Kind summary
  const kindCounts = Object.create(null);
  for (const s of symbols) {
    kindCounts[s.kind] = (kindCounts[s.kind] || 0) + 1;
  }

  // Build depth via parent_id chain
  const idMap = new Map(symbols.map(s => [s.id, s]));
  for (const s of symbols) {
    s._depth = 0;
    let cur = s;
    let safety = 20;
    while (cur.parent_id && idMap.has(cur.parent_id) && safety-- > 0) {
      s._depth++;
      cur = idMap.get(cur.parent_id);
    }
  }

  return { file, symbols, stats, kindCounts };
}

function _skeletonToJson(skeleton) {
  return {
    path: skeleton.file.path,
    language: skeleton.file.language,
    line_count: skeleton.file.line_count,
    file_role: skeleton.file.file_role,
    kind_summary: skeleton.kindCounts,
    cognitive_load: skeleton.stats?.complexity || null,
    symbols: skeleton.symbols.map(s => ({
      name: s.name,
      qualified_name: s.qualified_name,
      kind: s.kind,
      signature: s.signature || null,
      line_start: s.line_start,
      line_end: s.line_end,
      is_exported: Boolean(s.is_exported),
      depth: s._depth || 0,
    })),
  };
}

function _renderSkeletonText(skeleton, full) {
  const { file, symbols, kindCounts } = skeleton;

  console.log(`${file.path}  (${file.language || '?'}, ${file.line_count || '?'} lines)`);

  // Kind summary
  const kindParts = Object.entries(kindCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`);
  if (kindParts.length) console.log(`  ${kindParts.join(', ')}`);
  console.log('');

  // Symbol tree
  const shown = full ? symbols : symbols.slice(0, 50);
  for (const s of shown) {
    const indent = '  '.repeat((s._depth || 0) + 1);
    const exported = s.is_exported ? '+' : ' ';
    const sig = s.signature ? `  ${formatSignature(s.signature, 50)}` : '';
    const lines = s.line_start && s.line_end ? `  L${s.line_start}-${s.line_end}` : '';
    console.log(`${indent}${exported}${abbrevKind(s.kind)}  ${s.name}${sig}${lines}`);
  }
  if (!full && symbols.length > 50) {
    console.log(`  (+${symbols.length - 50} more symbols)`);
  }
}
