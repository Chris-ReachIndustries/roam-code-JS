/**
 * roam affected-tests — Find test files affected by changed code.
 */

import { openDb, batchedIn } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';
import { getChangedFiles, resolveChangedToDb } from './changed-files.js';
import { buildReverseAdj, bfsReachable } from './graph-helpers.js';
import { findProjectRoot } from '../db/connection.js';
import { isTest } from '../index/file-roles.js';
import { dirname } from 'node:path';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const staged = opts.staged || false;
    const commitRange = opts.commitRange || null;
    const transitive = opts.transitive || false;
    const maxDepth = transitive ? 8 : 2;

    const root = findProjectRoot();
    const changedPaths = getChangedFiles(root, { staged, commitRange });

    if (!changedPaths.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('affected-tests', { summary: { tests: 0 }, tests: [] })));
      } else {
        console.log('No changed files detected.');
      }
      return;
    }

    const changedFiles = resolveChangedToDb(db, changedPaths);
    if (!changedFiles.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('affected-tests', { summary: { tests: 0 }, tests: [] })));
      } else {
        console.log('Changed files not found in the index.');
      }
      return;
    }

    const affectedTests = Object.create(null); // path → { reasons[], depth }

    // 1. Direct: tests that import symbols from changed files
    const fileIds = changedFiles.map(f => f.fileId);
    const ph = fileIds.map(() => '?').join(',');
    const symbolsInChanged = db.prepare(`
      SELECT s.id, s.name, s.kind, f.path as file_path
      FROM symbols s JOIN files f ON s.file_id = f.id
      WHERE s.file_id IN (${ph})
    `).all(...fileIds);

    const symIds = symbolsInChanged.map(s => s.id);

    if (symIds.length) {
      // Direct test callers
      const directTests = batchedIn(
        db,
        `SELECT DISTINCT f.path, s2.name as changed_sym
         FROM edges e
         JOIN symbols s ON e.source_id = s.id
         JOIN files f ON s.file_id = f.id
         JOIN symbols s2 ON e.target_id = s2.id
         WHERE e.target_id IN ({ph})
           AND (f.path LIKE '%test%' OR f.path LIKE '%spec%')`,
        symIds,
      );

      for (const t of directTests) {
        if (!affectedTests[t.path]) affectedTests[t.path] = { reasons: [], depth: 1 };
        affectedTests[t.path].reasons.push(`imports ${t.changed_sym}`);
      }
    }

    // 2. Transitive: tests reachable via dependency chain
    if (transitive && symIds.length) {
      const revAdj = buildReverseAdj(db);
      const reachable = bfsReachable(revAdj, new Set(symIds), maxDepth);

      if (reachable.size > 0) {
        const allIds = [...reachable];
        const reachRows = batchedIn(
          db,
          'SELECT s.id, s.name, f.path as file_path FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.id IN ({ph})',
          allIds,
        );

        for (const r of reachRows) {
          if (isTest(r.file_path) && !affectedTests[r.file_path]) {
            affectedTests[r.file_path] = { reasons: [`transitive via ${r.name}`], depth: maxDepth };
          }
        }
      }
    }

    // 3. Colocated: test files in same directory as changed files
    const changedDirs = new Set(changedFiles.map(f => dirname(f.path).replace(/\\/g, '/')));
    const allFiles = db.prepare('SELECT path FROM files').all();
    for (const f of allFiles) {
      const p = f.path.replace(/\\/g, '/');
      if (isTest(p)) {
        const dir = dirname(p);
        if (changedDirs.has(dir) && !affectedTests[p]) {
          affectedTests[p] = { reasons: ['colocated'], depth: 0 };
        }
      }
    }

    const testList = Object.entries(affectedTests).map(([path, info]) => ({
      path,
      reason: info.reasons.join('; '),
      depth: info.depth,
    }));
    testList.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('affected-tests', {
        summary: {
          tests: testList.length,
          changed_files: changedFiles.length,
          direct: testList.filter(t => t.depth <= 1).length,
          transitive: testList.filter(t => t.depth > 1).length,
          colocated: testList.filter(t => t.reason.includes('colocated')).length,
        },
        tests: testList,
      })));
    } else {
      if (!testList.length) {
        console.log('No affected tests found for the changed files.');
        return;
      }
      console.log(`Affected Tests (${testList.length} for ${changedFiles.length} changed files):\n`);
      const headers = ['Test File', 'Reason', 'Depth'];
      const rows = testList.map(t => [t.path, t.reason, t.depth]);
      console.log(formatTable(headers, rows));
    }
  } finally {
    db.close();
  }
}
