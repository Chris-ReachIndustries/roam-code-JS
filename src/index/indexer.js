/**
 * Orchestrates the full indexing pipeline.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openDb, findProjectRoot, getDbPath } from '../db/connection.js';
import { discoverFiles } from './discovery.js';
import { parseFile, detectLanguage, extractVueTemplate, scanTemplateReferences, getParseErrorSummary } from './parser.js';
import { extractSymbols, extractReferences } from './symbols.js';
import { resolveReferences, buildFileEdges } from './relations.js';
import { getChangedFiles, fileHash } from './incremental.js';
import { classifyFile } from './file-roles.js';
import { initExtractors, getExtractor } from '../languages/registry.js';
import { computeAndStore as computeSymbolComplexity } from './complexity.js';
import { collectGitStats } from './git-stats.js';

function log(msg) {
  process.stderr.write(msg + '\n');
}

function computeComplexity(source) {
  const lines = source.split('\n');
  const depths = [];
  for (const line of lines) {
    const expanded = line.replace(/\t/g, '    ');
    const stripped = expanded.trimStart();
    if (!stripped) continue;
    const indent = expanded.length - stripped.length;
    depths.push(indent / 4.0);
  }
  if (!depths.length) return 0;
  const avg = depths.reduce((a, b) => a + b, 0) / depths.length;
  const mx = Math.max(...depths);
  return Math.round(avg * mx * 100) / 100;
}

function countLines(source) {
  if (!source) return 0;
  return source.split('\n').length;
}

export class Indexer {
  constructor(projectRoot = null) {
    this.root = projectRoot ? resolve(projectRoot) : findProjectRoot();
  }

  async run({ force = false, verbose = false } = {}) {
    log(`Indexing ${this.root}`);

    // Lock file
    const roamDir = join(this.root, '.roam');
    mkdirSync(roamDir, { recursive: true });
    const lockPath = join(roamDir, 'index.lock');

    if (existsSync(lockPath)) {
      try {
        const pid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
        try {
          process.kill(pid, 0);
          log(`Another indexing process (PID ${pid}) is running. Exiting.`);
          return;
        } catch {
          log(`Removing stale lock file (PID ${pid} is not running).`);
          unlinkSync(lockPath);
        }
      } catch {
        try { unlinkSync(lockPath); } catch {}
      }
    }

    writeFileSync(lockPath, String(process.pid));
    try {
      // Init extractors (async for ESM dynamic imports)
      await initExtractors();
      await this._doRun(force, verbose);
    } finally {
      try { unlinkSync(lockPath); } catch {}
    }
  }

  async _doRun(force, verbose) {
    const t0 = performance.now();

    // 1. Discover files
    log('Discovering files...');
    const allFiles = discoverFiles(this.root);
    log(`  Found ${allFiles.length} files`);

    // Delete existing DB when forcing
    if (force) {
      const dbPath = getDbPath(this.root);
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        for (const suffix of ['-wal', '-shm']) {
          const aux = dbPath + suffix;
          if (existsSync(aux)) unlinkSync(aux);
        }
      }
    }

    const db = openDb({ projectRoot: this.root });

    try {
      // 2. Determine what needs indexing
      let added, modified, removed;
      if (force) {
        added = allFiles;
        modified = [];
        removed = [];
      } else {
        [added, modified, removed] = getChangedFiles(db, allFiles, this.root);
      }

      const totalChanged = added.length + modified.length + removed.length;
      if (totalChanged === 0) {
        log('Index is up to date.');
        return;
      }

      log(`  ${added.length} added, ${modified.length} modified, ${removed.length} removed`);

      // Remove deleted/modified files from DB (cascading deletes)
      const deleteFile = db.prepare('DELETE FROM files WHERE id = ?');
      const findFile = db.prepare('SELECT id FROM files WHERE path = ?');
      for (const path of [...removed, ...modified]) {
        const row = findFile.get(path);
        if (row) deleteFile.run(row.id);
      }

      // 3-6. Parse, extract, and store for each file
      const filesToProcess = [...added, ...modified];
      const allSymbolRows = new Map(); // symbol_id -> symbol dict
      const allReferences = [];
      const fileIdByPath = new Map();

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
      const lastId = db.prepare('SELECT last_insert_rowid() as id');

      const commitBatch = db.transaction(() => {});

      for (let i = 0; i < filesToProcess.length; i++) {
        const relPath = filesToProcess[i];
        const fullPath = join(this.root, relPath);
        const language = detectLanguage(relPath);

        if (((i + 1) % 100 === 0) || (i + 1 === filesToProcess.length)) {
          log(`  Processing ${i + 1}/${filesToProcess.length} files...`);
        }

        // Read source
        let source;
        try {
          source = readFileSync(fullPath, 'utf-8');
        } catch (e) {
          if (verbose) log(`  Warning: Could not read ${relPath}: ${e.message}`);
          continue;
        }

        const lineCount = countLines(source);
        const complexity = computeComplexity(source);
        let mtime = null;
        try { mtime = statSync(fullPath).mtimeMs / 1000; } catch {}
        let fhash;
        try { fhash = fileHash(fullPath); } catch { fhash = null; }

        // Classify file role
        const contentHead = source.slice(0, 2048);
        const fileRole = classifyFile(relPath, contentHead);

        // Insert file record
        const fileResult = insertFile.run(relPath, language, fileRole, fhash, mtime, lineCount);
        const fileId = fileResult.lastInsertRowid;
        fileIdByPath.set(relPath, Number(fileId));

        // Store file stats
        insertFileStats.run(Number(fileId), complexity);

        // Parse with tree-sitter
        const [tree, parsedSource, lang] = parseFile(fullPath, language);
        if (tree == null && parsedSource == null) continue;

        // Get language extractor
        let extractor = null;
        if (lang) {
          try { extractor = getExtractor(lang); } catch {}
        }
        if (!extractor) continue;

        // Extract symbols
        const symbols = extractSymbols(tree, parsedSource, relPath, extractor);

        for (const sym of symbols) {
          let parentId = null;
          if (sym.parent_name) {
            const parentRow = findParent.get(Number(fileId), sym.parent_name);
            if (parentRow) parentId = parentRow.id;
          }

          const symResult = insertSymbol.run(
            Number(fileId), sym.name, sym.qualified_name,
            sym.kind, sym.signature,
            sym.line_start, sym.line_end,
            sym.docstring, sym.visibility,
            sym.is_exported ? 1 : 0, parentId,
            sym.default_value,
          );
          const symId = Number(symResult.lastInsertRowid);

          allSymbolRows.set(symId, {
            id: symId,
            file_id: Number(fileId),
            file_path: relPath,
            name: sym.name,
            qualified_name: sym.qualified_name,
            kind: sym.kind,
            is_exported: Boolean(sym.is_exported),
            line_start: sym.line_start,
          });
        }

        // Extract references
        const refs = extractReferences(tree, parsedSource, relPath, extractor);
        for (const ref of refs) {
          ref.source_file = relPath;
        }
        allReferences.push(...refs);

        // Vue template scanning
        if (relPath.endsWith('.vue')) {
          try {
            const rawSource = readFileSync(fullPath, 'utf-8');
            const tplResult = extractVueTemplate(rawSource);
            if (tplResult) {
              const [tplContent, tplStartLine] = tplResult;
              const knownNames = new Set(symbols.map(s => s.name));
              const tplRefs = scanTemplateReferences(tplContent, tplStartLine, knownNames, relPath);
              allReferences.push(...tplRefs);
            }
          } catch {}
        }

        // Per-symbol complexity metrics (AST-based)
        if (tree) {
          try {
            computeSymbolComplexity(db, Number(fileId), tree, parsedSource);
          } catch (e) {
            if (verbose) log(`  Warning: Complexity analysis failed for ${relPath}: ${e.message}`);
          }
        }
      }

      // Load existing symbols for incremental mode
      if (!force) {
        const existingRows = db.prepare(
          `SELECT s.id, s.file_id, s.name, s.qualified_name, s.kind,
           s.is_exported, s.line_start, f.path as file_path
           FROM symbols s JOIN files f ON s.file_id = f.id`
        ).all();
        for (const row of existingRows) {
          if (!allSymbolRows.has(row.id)) {
            allSymbolRows.set(row.id, {
              id: row.id,
              file_id: row.file_id,
              file_path: row.file_path,
              name: row.name,
              qualified_name: row.qualified_name,
              kind: row.kind,
              is_exported: Boolean(row.is_exported),
              line_start: row.line_start,
            });
          }
        }
      }

      // Load all file IDs from DB
      for (const row of db.prepare('SELECT id, path FROM files').all()) {
        fileIdByPath.set(row.path, row.id);
      }

      // Incremental edge restoration
      if (!force && modified.length > 0) {
        const processedSet = new Set([...filesToProcess, ...removed]);
        const unchanged = allFiles.filter(p => !processedSet.has(p));
        if (unchanged.length) {
          log(`Re-extracting references from ${unchanged.length} unchanged files...`);
          db.exec('DELETE FROM edges');
          db.exec('DELETE FROM file_edges');

          for (const relPath of unchanged) {
            const fullPath = join(this.root, relPath);
            const language = detectLanguage(relPath);
            const [tree, parsedSource, lang] = parseFile(fullPath, language);
            if (tree == null && parsedSource == null) continue;
            let extractor = null;
            if (lang) {
              try { extractor = getExtractor(lang); } catch {}
            }
            if (!extractor) continue;

            try { extractor.extractSymbols(tree, parsedSource, relPath); } catch {}
            const refs = extractReferences(tree, parsedSource, relPath, extractor);
            for (const ref of refs) ref.source_file = relPath;
            allReferences.push(...refs);
          }
        }
      }

      // 6. Resolve references into edges
      log('Resolving references...');
      const symbolsByName = new Map();
      for (const sym of allSymbolRows.values()) {
        if (!symbolsByName.has(sym.name)) symbolsByName.set(sym.name, []);
        symbolsByName.get(sym.name).push(sym);
      }

      const symbolEdges = resolveReferences(allReferences, symbolsByName, fileIdByPath);

      // Store edges in a transaction
      const insertEdge = db.prepare('INSERT INTO edges (source_id, target_id, kind, line) VALUES (?, ?, ?, ?)');
      const insertEdges = db.transaction((edges) => {
        for (const e of edges) {
          insertEdge.run(e.source_id, e.target_id, e.kind, e.line);
        }
      });
      insertEdges(symbolEdges);
      log(`  ${symbolEdges.length} symbol edges`);

      // 7. Build file edges
      log('Building file-level edges...');
      const fileEdges = buildFileEdges(symbolEdges, allSymbolRows);
      const insertFileEdge = db.prepare(
        'INSERT INTO file_edges (source_file_id, target_file_id, kind, symbol_count) VALUES (?, ?, ?, ?)'
      );
      const insertFileEdges = db.transaction((edges) => {
        for (const fe of edges) {
          insertFileEdge.run(fe.source_file_id, fe.target_file_id, fe.kind, fe.symbol_count);
        }
      });
      insertFileEdges(fileEdges);
      log(`  ${fileEdges.length} file edges`);

      // 8. Graph metrics
      log('Computing graph metrics...');
      try {
        const { buildSymbolGraph } = await import('../graph/builder.js');
        const { storeMetrics } = await import('../graph/pagerank.js');
        const G = buildSymbolGraph(db);
        const metricsCount = storeMetrics(db, G);
        log(`  ${metricsCount} symbol metrics stored`);

        // 9. Clustering
        log('Detecting clusters...');
        try {
          const { detectClusters, labelClusters, storeClusters } = await import('../graph/clusters.js');
          const clusters = detectClusters(G);
          const labels = labelClusters(clusters, db);
          const clusterCount = storeClusters(db, clusters, labels);
          log(`  ${clusterCount} symbols assigned to ${labels.size} clusters`);
        } catch (e) {
          log(`  Clustering skipped: ${e.message}`);
        }
      } catch (e) {
        log(`  Graph metrics skipped: ${e.message}`);
      }

      // 10. Git analysis
      log('Collecting git stats...');
      try {
        const gitStats = collectGitStats(db, this.root);
        log(`  ${gitStats.commits} commits, ${gitStats.cochanges} co-change pairs`);
      } catch (e) {
        log(`  Git analysis skipped: ${e.message}`);
      }

      // Parse error summary
      const errorSummary = getParseErrorSummary();
      if (errorSummary) log(`  Parse issues: ${errorSummary}`);

      // Summary
      const elapsed = (performance.now() - t0) / 1000;
      const fileCount = db.prepare('SELECT COUNT(*) as cnt FROM files').get().cnt;
      const symCount = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get().cnt;
      const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM edges').get().cnt;
      log(`Done. ${fileCount} files, ${symCount} symbols, ${edgeCount} edges. (${elapsed.toFixed(1)}s)`);
    } finally {
      db.close();
    }
  }
}
