/**
 * roam diff — Analyze blast radius and test impact of changed files.
 */

import { openDb } from '../db/connection.js';
import { SYMBOLS_IN_FILE, FILE_BY_PATH } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { findProjectRoot } from '../db/connection.js';
import { getChangedFiles, resolveChangedToDb, isTestFile, isLowRiskFile } from './changed-files.js';
import { buildReverseAdj, buildForwardAdj, bfsReachable } from './graph-helpers.js';
import { getAffectedTestsBfs, getCoupling } from './context-helpers.js';
import { isTest } from '../index/file-roles.js';
import { batchedIn } from '../db/connection.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const full = opts.full || false;
    const showTests = opts.tests || false;
    const showCoupling = opts.coupling || false;
    const staged = opts.staged || false;
    const commitRange = opts.commitRange || null;

    // Get changed files
    const root = findProjectRoot();
    const paths = getChangedFiles(root, { staged, commitRange });

    if (!paths.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('diff', { summary: { changed_files: 0 }, files: [] })));
      } else {
        console.log('No changed files detected.');
      }
      return;
    }

    // Resolve to DB
    const resolved = resolveChangedToDb(db, paths);
    const unresolved = paths.filter(p => !resolved.some(r => r.path === p || r.path.endsWith(p)));

    // Get all symbols in changed files
    const changedSymbols = [];
    const changedFileIds = new Set();
    for (const { fileId, path } of resolved) {
      changedFileIds.add(fileId);
      const syms = db.prepare(SYMBOLS_IN_FILE).all(fileId);
      for (const s of syms) {
        changedSymbols.push({ ...s, _changedFile: path });
      }
    }

    // Blast radius via reverse BFS
    const revAdj = buildReverseAdj(db);
    const exportedIds = new Set(changedSymbols.filter(s => s.is_exported).map(s => s.id));
    const blastReachable = exportedIds.size > 0 ? bfsReachable(revAdj, exportedIds, 8) : new Set();

    // Count affected files
    const affectedFileIds = new Set();
    if (blastReachable.size > 0) {
      const rows = batchedIn(db, 'SELECT id, file_id FROM symbols WHERE id IN ({ph})', [...blastReachable]);
      for (const r of rows) affectedFileIds.add(r.file_id);
    }

    // Classify changed files
    const fileDetails = resolved.map(({ fileId, path }) => {
      const syms = changedSymbols.filter(s => s.file_id === fileId);
      return {
        path,
        is_test: isTestFile(path),
        is_low_risk: isLowRiskFile(path),
        symbols: syms.length,
        exported: syms.filter(s => s.is_exported).length,
      };
    });

    // Test impact
    let affectedTests = [];
    if (showTests && exportedIds.size > 0) {
      affectedTests = getAffectedTestsBfs(db, [...exportedIds], 8);
      // Also add colocated tests
      for (const { path } of resolved) {
        const dir = path.replace(/\/[^/]+$/, '/');
        const colocated = db.prepare('SELECT f.path FROM files f WHERE f.path LIKE ? AND f.path != ?')
          .all(dir + '%test%', path)
          .filter(f => isTest(f.path));
        for (const ct of colocated) {
          if (!affectedTests.some(t => t.file_path === ct.path)) {
            affectedTests.push({ name: ct.path.split('/').pop(), file_path: ct.path, kind: 'colocated' });
          }
        }
      }
    }

    // Coupling analysis
    let couplingPartners = [];
    if (showCoupling) {
      for (const { fileId } of resolved) {
        const partners = getCoupling(db, fileId, 5);
        for (const p of partners) {
          if (!changedFileIds.has(p.file_id) && !couplingPartners.some(cp => cp.path === p.path)) {
            couplingPartners.push({ ...p, missing: true });
          }
        }
      }
      couplingPartners.sort((a, b) => b.count - a.count);
    }

    // Risk classification
    const totalExported = changedSymbols.filter(s => s.is_exported).length;
    let risk = 'LOW';
    if (blastReachable.size >= 50) risk = 'CRITICAL';
    else if (blastReachable.size >= 20) risk = 'HIGH';
    else if (blastReachable.size >= 5) risk = 'MEDIUM';

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('diff', {
        summary: {
          changed_files: resolved.length,
          unresolved_files: unresolved.length,
          changed_symbols: changedSymbols.length,
          exported_symbols: totalExported,
          blast_radius_symbols: blastReachable.size,
          blast_radius_files: affectedFileIds.size,
          risk,
        },
        files: fileDetails,
        unresolved,
        affected_tests: showTests ? affectedTests.map(t => ({ name: t.name, path: t.file_path })) : undefined,
        coupling: showCoupling ? couplingPartners.slice(0, 10) : undefined,
      })));
    } else {
      console.log(`=== Diff Analysis (${resolved.length} changed files) ===\n`);
      console.log(`Risk: ${risk}  |  Blast: ${blastReachable.size} syms / ${affectedFileIds.size} files  |  Exported: ${totalExported}\n`);

      // Changed files table
      const headers = ['Path', 'Syms', 'Exp', 'Type'];
      const rows = fileDetails.map(f => [
        f.path,
        f.symbols,
        f.exported,
        f.is_test ? 'test' : f.is_low_risk ? 'low-risk' : 'code',
      ]);
      console.log(formatTable(headers, rows, full ? 0 : 30));

      if (unresolved.length) {
        console.log(`\nUnresolved (${unresolved.length}): ${unresolved.slice(0, 10).join(', ')}`);
      }

      // Test impact
      if (showTests && affectedTests.length) {
        console.log(`\n--- Affected Tests (${affectedTests.length}) ---\n`);
        for (const t of affectedTests.slice(0, full ? 50 : 15)) {
          console.log(`  ${t.name}  ${t.file_path}`);
        }
        if (!full && affectedTests.length > 15) console.log(`  (+${affectedTests.length - 15} more)`);
      }

      // Coupling
      if (showCoupling && couplingPartners.length) {
        console.log(`\n--- Missing Co-Change Partners (${couplingPartners.length}) ---\n`);
        const cHeaders = ['Path', 'Co-changes', 'Strength'];
        const cRows = couplingPartners.slice(0, 10).map(c => [c.path, c.count, c.strength]);
        console.log(formatTable(cHeaders, cRows));
      }
    }
  } finally {
    db.close();
  }
}
