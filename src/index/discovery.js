/**
 * File discovery using git ls-files with fallback to fs.walk.
 */

import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const SKIP_EXTENSIONS = new Set([
  '.lock', '.min.js', '.min.css', '.map',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib',
  '.pyc', '.pyo', '.class', '.jar',
  '.db', '.sqlite', '.sqlite3',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.bin', '.dat', '.pak', '.wasm',
  '.sct',
]);

const SKIP_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'poetry.lock', 'composer.lock',
  'Gemfile.lock', 'Pipfile.lock',
]);

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '__pycache__',
  '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'venv', '.venv', 'env', '.env',
  'dist', 'build', '.eggs',
  '.next', '.nuxt', '.output',
  'target', 'bin', 'obj',
  '.roam',
]);

const MAX_FILE_SIZE = 1_000_000; // 1MB

function isSkippable(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/');
  if (parts.includes('.roam')) return true;
  const name = basename(relPath);
  if (SKIP_NAMES.has(name)) return true;
  const ext = extname(name).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return true;
  return false;
}

function gitLsFiles(root) {
  try {
    const result = execSync(
      'git ls-files --cached --others --exclude-standard',
      { cwd: root, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return result.split('\n').map(p => p.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function walkFiles(root) {
  const result = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const full = join(dir, entry.name);
        try {
          const rel = relative(root, full).replace(/\\/g, '/');
          result.push(rel);
        } catch {
          continue;
        }
      }
    }
  }

  walk(root);
  return result;
}

function filterFiles(paths, root) {
  const kept = [];
  for (const relPath of paths) {
    if (isSkippable(relPath)) continue;
    const fullPath = join(root, relPath);
    try {
      if (statSync(fullPath).size > MAX_FILE_SIZE) continue;
    } catch {
      continue;
    }
    kept.push(relPath);
  }
  return kept;
}

/**
 * Discover source files in a project directory.
 * Uses git ls-files when available, falls back to fs walk.
 * @param {string} root - Absolute path to project root
 * @returns {string[]} Sorted list of relative paths with forward slashes
 */
export function discoverFiles(root) {
  let raw = gitLsFiles(root);
  if (raw === null) {
    raw = walkFiles(root);
  }
  raw = raw.map(p => p.replace(/\\/g, '/'));
  const filtered = filterFiles(raw, root);
  filtered.sort();
  return filtered;
}
