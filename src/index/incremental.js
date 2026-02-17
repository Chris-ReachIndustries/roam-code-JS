/**
 * Change detection for incremental re-indexing.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath - Absolute path
 * @returns {string}
 */
export function fileHash(filePath) {
  const h = createHash('sha256');
  const data = readFileSync(filePath);
  h.update(data);
  return h.digest('hex');
}

/**
 * Determine which files have been added, modified, or removed.
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} filePaths - Current list of relative file paths on disk
 * @param {string} root - Project root directory
 * @returns {[string[], string[], string[]]} [added, modified, removed]
 */
export function getChangedFiles(db, filePaths, root) {
  const rows = db.prepare('SELECT path, mtime, hash FROM files').all();
  const stored = new Map();
  for (const row of rows) {
    stored.set(row.path, { mtime: row.mtime, hash: row.hash });
  }

  const currentSet = new Set(filePaths);
  const storedSet = new Set(stored.keys());

  const added = [...currentSet].filter(p => !storedSet.has(p)).sort();
  const removed = [...storedSet].filter(p => !currentSet.has(p)).sort();

  const modified = [];
  const both = [...currentSet].filter(p => storedSet.has(p)).sort();

  for (const path of both) {
    const fullPath = join(root, path);
    let currentMtime;
    try {
      currentMtime = statSync(fullPath).mtimeMs / 1000;
    } catch {
      removed.push(path);
      continue;
    }

    const { mtime: storedMtime, hash: storedHash } = stored.get(path);

    // Fast path: if mtime is unchanged, assume file is unchanged
    if (storedMtime != null && Math.abs(currentMtime - storedMtime) < 0.001) {
      continue;
    }

    // Mtime changed -- check hash to confirm actual content change
    let currentHash;
    try {
      currentHash = fileHash(fullPath);
    } catch {
      removed.push(path);
      continue;
    }

    if (currentHash !== storedHash) {
      modified.push(path);
    }
  }

  return [added, modified, removed];
}
