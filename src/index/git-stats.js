/**
 * Git statistics collection: commits, churn, co-change, entropy, hyperedges.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

function log(msg) { process.stderr.write(msg + '\n'); }

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function collectGitStats(db, projectRoot) {
  projectRoot = resolve(projectRoot);
  if (!_isGitRepo(projectRoot)) {
    log('Not a git repository — skipping git stats');
    return { commits: 0, cochanges: 0 };
  }

  const commits = parseGitLog(projectRoot);
  if (!commits.length) {
    log('No git commits found');
    return { commits: 0, cochanges: 0 };
  }

  log(`Parsed ${commits.length} commits from git log`);
  storeCommits(db, commits);
  const cochangeCount = computeCochange(db);
  computeFileStats(db);
  computeComplexity(db, projectRoot);
  return { commits: commits.length, cochanges: cochangeCount };
}

// ---------------------------------------------------------------------------
// Git log parsing
// ---------------------------------------------------------------------------

const COMMIT_SEP = 'COMMIT:';

export function parseGitLog(projectRoot, maxCommits = 5000) {
  const result = _runGit([
    'git', 'log', '--numstat',
    '--pretty=format:COMMIT:%H|%an|%at|%s',
    '--no-merges', '-n', String(maxCommits),
  ], projectRoot);
  if (!result) return [];

  const commits = [];
  let current = null;

  for (const line of result.split('\n')) {
    const trimmed = line.trimEnd();

    if (trimmed.startsWith(COMMIT_SEP)) {
      if (current) commits.push(current);
      const parts = trimmed.slice(COMMIT_SEP.length).split('|', 4);
      if (parts.length < 4) { current = null; continue; }
      const [hash, author, tsStr, message] = parts;
      current = {
        hash, author,
        timestamp: parseInt(tsStr, 10) || 0,
        message,
        files: [],
      };
      continue;
    }

    if (!current || !trimmed) continue;
    const parts = trimmed.split('\t', 3);
    if (parts.length !== 3) continue;

    const [addedStr, removedStr, rawPath] = parts;
    const linesAdded = parseInt(addedStr, 10) || 0;
    const linesRemoved = parseInt(removedStr, 10) || 0;
    const path = _normalizeNumstatPath(rawPath);
    if (path) {
      current.files.push({ path, lines_added: linesAdded, lines_removed: linesRemoved });
    }
  }
  if (current) commits.push(current);
  return commits;
}

function _normalizeNumstatPath(raw) {
  raw = raw.trim();
  if (raw.includes('{') && raw.includes(' => ')) {
    const braceStart = raw.indexOf('{');
    const braceEnd = raw.indexOf('}');
    const inner = raw.slice(braceStart + 1, braceEnd);
    const prefix = raw.slice(0, braceStart);
    const suffix = raw.slice(braceEnd + 1);
    const [, newPart] = inner.split(' => ', 2);
    raw = prefix + newPart + suffix;
  }
  return raw.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Storing commits
// ---------------------------------------------------------------------------

function storeCommits(db, commits) {
  const pathToId = new Map();
  for (const row of db.prepare('SELECT id, path FROM files').all()) {
    pathToId.set(row.path, row.id);
  }

  const insertCommit = db.prepare(
    'INSERT OR IGNORE INTO git_commits (hash, author, timestamp, message) VALUES (?, ?, ?, ?)'
  );
  const getCommitId = db.prepare('SELECT id FROM git_commits WHERE hash = ?');
  const insertChange = db.prepare(
    'INSERT INTO git_file_changes (commit_id, file_id, path, lines_added, lines_removed) VALUES (?, ?, ?, ?, ?)'
  );

  const storeAll = db.transaction(() => {
    for (const commit of commits) {
      insertCommit.run(commit.hash, commit.author, commit.timestamp, commit.message);
      const row = getCommitId.get(commit.hash);
      if (!row) continue;
      const commitId = row.id;
      for (const fc of commit.files) {
        const fileId = pathToId.get(fc.path) || null;
        insertChange.run(commitId, fileId, fc.path, fc.lines_added, fc.lines_removed);
      }
    }
  });
  storeAll();
}

// ---------------------------------------------------------------------------
// Co-change matrix
// ---------------------------------------------------------------------------

function computeCochange(db) {
  const rows = db.prepare(
    'SELECT commit_id, file_id FROM git_file_changes WHERE file_id IS NOT NULL'
  ).all();

  const commitFiles = new Map();
  for (const row of rows) {
    if (!commitFiles.has(row.commit_id)) commitFiles.set(row.commit_id, new Set());
    commitFiles.get(row.commit_id).add(row.file_id);
  }

  const pairCounts = new Map();
  for (const fileIds of commitFiles.values()) {
    if (fileIds.size < 2 || fileIds.size > 100) continue;
    const sorted = [...fileIds].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]},${sorted[j]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  const insertPair = db.prepare(
    'INSERT INTO git_cochange (file_id_a, file_id_b, cochange_count) VALUES (?, ?, ?)'
  );
  const storeCochange = db.transaction(() => {
    db.exec('DELETE FROM git_cochange');
    for (const [key, count] of pairCounts) {
      const [a, b] = key.split(',').map(Number);
      insertPair.run(a, b, count);
    }
  });
  storeCochange();

  log(`Computed co-change for ${pairCounts.size} file pairs`);
  _computeCochangeEntropy(db, pairCounts);
  _populateHyperedges(db, commitFiles);
  return pairCounts.size;
}

function _computeCochangeEntropy(db, pairCounts) {
  const filePartners = new Map();
  for (const [key, count] of pairCounts) {
    const [a, b] = key.split(',').map(Number);
    if (!filePartners.has(a)) filePartners.set(a, new Map());
    if (!filePartners.has(b)) filePartners.set(b, new Map());
    filePartners.get(a).set(b, (filePartners.get(a).get(b) || 0) + count);
    filePartners.get(b).set(a, (filePartners.get(b).get(a) || 0) + count);
  }

  const update = db.prepare('UPDATE file_stats SET cochange_entropy = ? WHERE file_id = ?');
  const updateAll = db.transaction(() => {
    for (const [fid, partners] of filePartners) {
      const total = [...partners.values()].reduce((a, b) => a + b, 0);
      if (total === 0 || partners.size <= 1) { update.run(0, fid); continue; }
      let sumPSq = 0;
      for (const count of partners.values()) {
        const p = count / total;
        sumPSq += p * p;
      }
      const entropy = sumPSq > 0 ? -Math.log2(sumPSq) : 0;
      const maxEntropy = Math.log2(partners.size);
      const normEntropy = maxEntropy > 0 ? Math.round(entropy / maxEntropy * 10000) / 10000 : 0;
      update.run(normEntropy, fid);
    }
  });
  updateAll();
  log(`Computed co-change entropy for ${filePartners.size} files`);
}

function _populateHyperedges(db, commitFiles) {
  const insertEdge = db.prepare(
    'INSERT INTO git_hyperedges (id, commit_id, file_count, sig_hash) VALUES (?, ?, ?, ?)'
  );
  const insertMember = db.prepare(
    'INSERT INTO git_hyperedge_members (hyperedge_id, file_id, ordinal) VALUES (?, ?, ?)'
  );

  let edgeId = 0;
  const storeHyperedges = db.transaction(() => {
    db.exec('DELETE FROM git_hyperedge_members');
    db.exec('DELETE FROM git_hyperedges');

    for (const [commitId, fileIds] of commitFiles) {
      const n = fileIds.size;
      if (n < 2 || n > 100) continue;
      const sortedIds = [...fileIds].sort((a, b) => a - b);
      const sig = createHash('sha256')
        .update(sortedIds.join('|'))
        .digest('hex')
        .slice(0, 16);

      edgeId++;
      insertEdge.run(edgeId, commitId, n, sig);
      for (let i = 0; i < sortedIds.length; i++) {
        insertMember.run(edgeId, sortedIds[i], i);
      }
    }
  });
  storeHyperedges();
  log(`Stored ${edgeId} hyperedges`);
}

// ---------------------------------------------------------------------------
// Per-file stats
// ---------------------------------------------------------------------------

function computeFileStats(db) {
  const rows = db.prepare(`
    SELECT gfc.file_id,
           COUNT(DISTINCT gfc.commit_id) AS commit_count,
           SUM(gfc.lines_added + gfc.lines_removed) AS total_churn,
           COUNT(DISTINCT gc.author) AS distinct_authors
    FROM git_file_changes gfc
    JOIN git_commits gc ON gfc.commit_id = gc.id
    WHERE gfc.file_id IS NOT NULL
    GROUP BY gfc.file_id
  `).all();

  const upsert = db.prepare(
    `INSERT OR REPLACE INTO file_stats
     (file_id, commit_count, total_churn, distinct_authors, complexity)
     VALUES (?, ?, ?, ?, COALESCE(
       (SELECT complexity FROM file_stats WHERE file_id = ?), 0))`
  );
  const updateAll = db.transaction(() => {
    for (const row of rows) {
      upsert.run(row.file_id, row.commit_count, row.total_churn || 0, row.distinct_authors, row.file_id);
    }
  });
  updateAll();
  log(`Computed file stats for ${rows.length} files`);
}

// ---------------------------------------------------------------------------
// Indentation-based complexity
// ---------------------------------------------------------------------------

function computeComplexity(db, projectRoot) {
  projectRoot = resolve(projectRoot);
  const files = db.prepare('SELECT id, path FROM files').all();
  const update = db.prepare('UPDATE file_stats SET complexity = ? WHERE file_id = ?');
  const insert = db.prepare('INSERT INTO file_stats (file_id, complexity) VALUES (?, ?)');
  const check = db.prepare('SELECT 1 FROM file_stats WHERE file_id = ?');

  const updateAll = db.transaction(() => {
    for (const row of files) {
      const fullPath = resolve(projectRoot, row.path);
      const complexity = _measureIndentComplexity(fullPath);
      if (complexity == null) continue;

      if (check.get(row.id)) {
        update.run(complexity, row.id);
      } else {
        insert.run(row.id, complexity);
      }
    }
  });
  updateAll();
  log(`Computed complexity for ${files.length} files`);
}

function _measureIndentComplexity(path) {
  let text;
  try { text = readFileSync(path, 'utf-8'); } catch { return null; }

  const indents = [];
  for (const line of text.split('\n')) {
    if (!line || !line.trim()) continue;
    const stripped = line.trimStart();
    const leading = line.length - stripped.length;
    const tabCount = line.slice(0, leading).split('\t').length - 1;
    const spaceCount = leading - tabCount;
    indents.push(tabCount + spaceCount / 4);
  }

  if (!indents.length) return 0;
  const avg = indents.reduce((a, b) => a + b, 0) / indents.length;
  const mx = Math.max(...indents);
  return Math.round(avg * mx * 100) / 100;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _isGitRepo(path) {
  const result = _runGit(['git', 'rev-parse', '--is-inside-work-tree'], path);
  return result !== null && result.trim() === 'true';
}

function _runGit(cmd, cwd, timeout = 120000) {
  try {
    return execSync(cmd.join(' '), {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}
