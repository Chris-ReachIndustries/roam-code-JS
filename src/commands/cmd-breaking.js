/**
 * roam breaking — Detect potentially breaking changes in a diff.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { getChangedFiles, resolveChangedToDb } from './changed-files.js';
import { findProjectRoot } from '../db/connection.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const staged = opts.staged || false;
    const commitRange = opts.commitRange || null;

    const root = findProjectRoot();
    const changedPaths = getChangedFiles(root, { staged, commitRange });

    if (!changedPaths.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('breaking', { summary: { changes: 0 }, changes: [] })));
      } else {
        console.log('No changed files detected.');
      }
      return;
    }

    const changedFiles = resolveChangedToDb(db, changedPaths);
    if (!changedFiles.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('breaking', { summary: { changes: 0, unresolved: changedPaths.length }, changes: [] })));
      } else {
        console.log('Changed files not found in the index. Re-run `roam index`.');
      }
      return;
    }

    // Get exported symbols from changed files
    const fileIds = changedFiles.map(f => f.fileId);
    const ph = fileIds.map(() => '?').join(',');
    const exports = db.prepare(`
      SELECT s.id, s.name, s.kind, s.signature, s.is_exported, s.line_start, s.line_end,
             f.path as file_path
      FROM symbols s JOIN files f ON s.file_id = f.id
      WHERE s.file_id IN (${ph}) AND s.is_exported = 1
      ORDER BY f.path, s.line_start
    `).all(...fileIds);

    // Detect potential breaking changes
    const breakingChanges = [];

    for (const sym of exports) {
      // Check consumers (who depends on this symbol)
      const consumers = db.prepare(
        'SELECT COUNT(*) as cnt FROM edges WHERE target_id = ?'
      ).get(sym.id);
      const consumerCount = consumers.cnt || 0;

      if (consumerCount === 0) continue; // No consumers, not breaking

      // Flag all exported symbols in changed files with consumers as potential breaking
      breakingChanges.push({
        name: sym.name,
        kind: sym.kind,
        signature: sym.signature,
        file_path: sym.file_path,
        line_start: sym.line_start,
        consumers: consumerCount,
        severity: consumerCount > 10 ? 'BREAKING' : consumerCount > 3 ? 'WARNING' : 'INFO',
        reason: `Exported ${sym.kind} with ${consumerCount} consumer(s) modified`,
      });
    }

    // Check for removed symbols: symbols in changed files that are NOT exported anymore
    // (This is a heuristic — we can't diff old vs new, but we flag low-export-count files)
    const fileExportCounts = Object.create(null);
    for (const sym of exports) {
      fileExportCounts[sym.file_path] = (fileExportCounts[sym.file_path] || 0) + 1;
    }

    // Sort by severity
    const sevOrder = { BREAKING: 0, WARNING: 1, INFO: 2 };
    breakingChanges.sort((a, b) => (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3) || b.consumers - a.consumers);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('breaking', {
        summary: {
          changes: breakingChanges.length,
          breaking: breakingChanges.filter(c => c.severity === 'BREAKING').length,
          warning: breakingChanges.filter(c => c.severity === 'WARNING').length,
          info: breakingChanges.filter(c => c.severity === 'INFO').length,
          files: changedFiles.length,
        },
        changes: breakingChanges.map(c => ({
          name: c.name, kind: c.kind, severity: c.severity,
          consumers: c.consumers, reason: c.reason,
          location: loc(c.file_path, c.line_start),
        })),
      })));
    } else {
      if (!breakingChanges.length) {
        console.log('No breaking changes detected in modified exported symbols.');
        return;
      }
      console.log(`Breaking Changes (${breakingChanges.length} potential issues in ${changedFiles.length} files):\n`);
      const headers = ['Sev', 'Name', 'Kind', 'Consumers', 'Reason', 'Location'];
      const rows = breakingChanges.map(c => [
        c.severity, c.name, abbrevKind(c.kind),
        c.consumers, c.reason, loc(c.file_path, c.line_start),
      ]);
      console.log(formatTable(headers, rows, 50));
    }
  } finally {
    db.close();
  }
}
