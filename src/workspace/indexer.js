/**
 * Workspace-aware indexing.
 * Indexes multiple repos into a single database with aliased file paths.
 */

import { resolve, join } from 'node:path';
import { loadWorkspaceConfig, resolveRepoPaths } from './config.js';
import { openDb } from '../db/connection.js';
import { discoverFiles } from '../index/discovery.js';
import { detectLanguage, parseFile } from '../index/parser.js';
import { getExtractor, initExtractors } from '../languages/registry.js';
import { extractSymbols, extractReferences } from '../index/symbols.js';
import { classifyFile } from '../index/file-roles.js';
import { resolveReferences } from '../index/relations.js';
import { buildSymbolGraph } from '../graph/builder.js';
import { storeMetrics } from '../graph/pagerank.js';
import { detectClusters, labelClusters, storeClusters } from '../graph/clusters.js';
import { collectGitStats } from '../index/git-stats.js';
import { fileHash } from '../index/incremental.js';
import { readFileSync, statSync } from 'node:fs';

function log(msg) { console.log(msg); }

function countLines(source) {
  if (!source) return 0;
  return source.split('\n').length;
}

function computeStructuralComplexity(source) {
  if (!source) return 0;
  const lines = source.split('\n');
  let totalIndent = 0;
  let maxIndent = 0;
  let counted = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    totalIndent += indent;
    if (indent > maxIndent) maxIndent = indent;
    counted++;
  }
  return counted ? totalIndent / counted : 0;
}

/**
 * Index all repos in a workspace.
 * @param {string} root - Workspace root directory
 * @param {object} opts - { force: boolean, verbose: boolean }
 */
export async function indexWorkspace(root, opts = {}) {
  const { force = false, verbose = false } = opts;
  const config = loadWorkspaceConfig(root);
  if (!config) {
    throw new Error('No workspace configuration found. Run "roam workspace init" first.');
  }

  const repos = resolveRepoPaths(root, config);
  const validRepos = repos.filter(r => r.exists);
  if (!validRepos.length) {
    throw new Error('No valid repos found in workspace configuration.');
  }

  log(`Workspace "${config.name}" — ${validRepos.length} repos`);

  await initExtractors();

  // Open/create the workspace DB at the workspace root
  const db = openDb({ projectRoot: root });

  try {
    if (force) {
      // Clear all existing data
      db.exec('DELETE FROM files');
      db.exec('DELETE FROM symbols');
      db.exec('DELETE FROM edges');
      db.exec('DELETE FROM file_edges');
      db.exec('DELETE FROM graph_metrics');
      db.exec('DELETE FROM clusters');
      db.exec('DELETE FROM file_stats');
    }

    const insertFile = db.prepare(
      'INSERT INTO files (path, language, file_role, hash, mtime, line_count) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertFileStats = db.prepare(
      'INSERT OR REPLACE INTO file_stats (file_id, complexity) VALUES (?, ?)'
    );
    const insertSymbol = db.prepare(
      `INSERT INTO symbols (file_id, name, qualified_name, kind, signature,
       line_start, line_end, docstring, visibility, is_exported, parent_id, default_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const findParent = db.prepare('SELECT id FROM symbols WHERE file_id = ? AND name = ?');

    const allSymbolRows = new Map();
    const allReferences = [];
    let totalFiles = 0;
    let totalSymbols = 0;

    for (const repo of validRepos) {
      log(`\nIndexing repo: ${repo.alias} (${repo.absPath})`);

      const files = discoverFiles(repo.absPath);
      log(`  Found ${files.length} files`);

      for (const relPath of files) {
        const fullPath = join(repo.absPath, relPath);
        const aliasedPath = `${repo.alias}/${relPath}`;
        const language = detectLanguage(relPath);

        let source;
        try {
          source = readFileSync(fullPath, 'utf-8');
        } catch {
          continue;
        }

        const lineCount = countLines(source);
        const complexity = computeStructuralComplexity(source);
        let mtime = null;
        try { mtime = statSync(fullPath).mtimeMs / 1000; } catch {}
        let fhash;
        try { fhash = fileHash(fullPath); } catch { fhash = null; }

        const contentHead = source.slice(0, 2048);
        const fileRole = classifyFile(relPath, contentHead);

        const fileResult = insertFile.run(aliasedPath, language, fileRole, fhash, mtime, lineCount);
        const fileId = Number(fileResult.lastInsertRowid);
        insertFileStats.run(fileId, complexity);

        const [tree, parsedSource, lang] = parseFile(fullPath, language);
        if (tree == null && parsedSource == null) {
          totalFiles++;
          continue;
        }

        let extractor = null;
        if (lang) {
          try { extractor = getExtractor(lang); } catch {}
        }
        if (!extractor) {
          totalFiles++;
          continue;
        }

        const symbols = extractSymbols(tree, parsedSource, aliasedPath, extractor);
        for (const sym of symbols) {
          let parentId = null;
          if (sym.parent_name) {
            const parentRow = findParent.get(fileId, sym.parent_name);
            if (parentRow) parentId = parentRow.id;
          }

          const symResult = insertSymbol.run(
            fileId, sym.name, sym.qualified_name,
            sym.kind, sym.signature,
            sym.line_start, sym.line_end,
            sym.docstring, sym.visibility,
            sym.is_exported ? 1 : 0, parentId,
            sym.default_value,
          );
          const symId = Number(symResult.lastInsertRowid);
          allSymbolRows.set(symId, {
            id: symId, file_id: fileId, file_path: aliasedPath,
            name: sym.name, qualified_name: sym.qualified_name,
            kind: sym.kind, is_exported: Boolean(sym.is_exported),
            line_start: sym.line_start,
          });
          totalSymbols++;
        }

        const refs = extractReferences(tree, parsedSource, aliasedPath, extractor);
        for (const ref of refs) {
          ref.source_file = aliasedPath;
        }
        allReferences.push(...refs);
        totalFiles++;
      }

      // Git stats per repo
      if (repo.hasGit) {
        try {
          collectGitStats(db, repo.absPath, repo.alias);
        } catch {
          if (verbose) log(`  Warning: Git stats failed for ${repo.alias}`);
        }
      }
    }

    // Reference resolution across all repos
    log('\nResolving cross-repo references...');
    const symbolsByName = new Map();
    const filesByPath = new Map();

    for (const [id, sym] of allSymbolRows) {
      const key = sym.name;
      if (!symbolsByName.has(key)) symbolsByName.set(key, []);
      symbolsByName.get(key).push(sym);
    }

    // Resolve and store edges
    const resolved = resolveReferences(allReferences, symbolsByName, filesByPath);
    const insertEdge = db.prepare(
      'INSERT INTO edges (source_id, target_id, kind, line) VALUES (?, ?, ?, ?)'
    );
    let edgeCount = 0;
    for (const edge of resolved) {
      try {
        insertEdge.run(edge.source_id, edge.target_id, edge.kind, edge.line);
        edgeCount++;
      } catch {}
    }

    // Graph metrics
    log('Computing graph metrics...');
    try {
      const G = buildSymbolGraph(db);
      storeMetrics(db, G);
    } catch {}

    // Clustering
    try {
      const G = buildSymbolGraph(db);
      const clusters = detectClusters(G);
      const labels = labelClusters(clusters, db);
      storeClusters(db, clusters, labels);
    } catch {}

    log(`\nWorkspace indexed: ${totalFiles} files, ${totalSymbols} symbols, ${edgeCount} edges`);
  } finally {
    db.close();
  }
}
