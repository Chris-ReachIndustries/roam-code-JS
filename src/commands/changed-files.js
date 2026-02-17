/**
 * Git diff file resolution and classification helpers.
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isTest, isVendored, classifyFile } from '../index/file-roles.js';

/**
 * Get list of changed file paths from git.
 * @param {string} root - Project root
 * @param {object} opts
 * @param {boolean} opts.staged - Only staged changes
 * @param {string} opts.commitRange - Git commit range (e.g. "HEAD~3..HEAD")
 * @param {string} opts.baseRef - Base ref for PR comparison
 * @returns {string[]}
 */
export function getChangedFiles(root, { staged = false, commitRange = null, baseRef = null } = {}) {
  root = resolve(root);
  let cmd;
  if (commitRange) {
    cmd = `git diff --name-only ${commitRange}`;
  } else if (baseRef) {
    cmd = `git diff --name-only ${baseRef}...HEAD`;
  } else if (staged) {
    cmd = 'git diff --cached --name-only';
  } else {
    cmd = 'git diff --name-only HEAD';
  }

  try {
    const result = execSync(cmd, {
      cwd: root,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(p => p.replace(/\\/g, '/'));
  } catch {
    // Fallback: try unstaged changes
    if (!staged && !commitRange && !baseRef) {
      try {
        const result = execSync('git diff --name-only', {
          cwd: root,
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return result.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      } catch { /* fall through */ }
    }
    return [];
  }
}

/**
 * Map changed paths to DB file records.
 * @returns {Array<{fileId: number, path: string}>}
 */
export function resolveChangedToDb(db, paths) {
  const results = [];
  const exact = db.prepare('SELECT id, path FROM files WHERE path = ?');
  const fuzzy = db.prepare('SELECT id, path FROM files WHERE path LIKE ? LIMIT 1');

  for (const p of paths) {
    let row = exact.get(p);
    if (!row) row = fuzzy.get(`%${p}`);
    if (row) results.push({ fileId: row.id, path: row.path });
  }
  return results;
}

/**
 * Check if a file is a test file.
 */
export function isTestFile(path) {
  return isTest(path);
}

/**
 * Check if a file is low-risk (docs, config, data, etc.).
 */
export function isLowRiskFile(path) {
  const role = classifyFile(path);
  return ['docs', 'config', 'data', 'ci', 'generated', 'vendored'].includes(role);
}
