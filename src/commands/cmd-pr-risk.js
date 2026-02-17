/**
 * roam pr-risk — Comprehensive PR risk assessment.
 */

import { openDb, batchedIn } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { getChangedFiles, resolveChangedToDb, isTestFile, isLowRiskFile } from './changed-files.js';
import { buildReverseAdj, bfsReachable } from './graph-helpers.js';
import { findProjectRoot } from '../db/connection.js';
import { createSarifLog, addRun, writeSarif, makeRule, makeResult } from '../output/sarif.js';
import { isTest } from '../index/file-roles.js';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const commitRange = opts.commitRange || null;
    const staged = opts.staged || false;
    const sarifPath = opts.sarif || null;

    const root = findProjectRoot();
    const changedPaths = getChangedFiles(root, { staged, commitRange });

    if (!changedPaths.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('pr-risk', {
          summary: { risk: 'NONE', score: 0, changed_files: 0 },
          sections: {},
        })));
      } else {
        console.log('No changed files detected.');
      }
      return;
    }

    const changedFiles = resolveChangedToDb(db, changedPaths);
    const sourceFiles = changedFiles.filter(f => !isTestFile(f.path) && !isLowRiskFile(f.path));
    const testFilesChanged = changedFiles.filter(f => isTestFile(f.path));

    // Gather symbols from changed source files
    const fileIds = sourceFiles.map(f => f.fileId);
    let changedSymbols = [];
    if (fileIds.length) {
      const ph = fileIds.map(() => '?').join(',');
      changedSymbols = db.prepare(`
        SELECT s.id, s.name, s.kind, s.is_exported, f.path as file_path, s.line_start,
               COALESCE(gm.pagerank, 0) as pagerank,
               COALESCE(sm.cognitive_complexity, 0) as complexity
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        LEFT JOIN graph_metrics gm ON s.id = gm.symbol_id
        LEFT JOIN symbol_metrics sm ON s.id = sm.symbol_id
        WHERE s.file_id IN (${ph})
      `).all(...fileIds);
    }

    const sections = {};

    // 1. Blast radius
    let blastSymCount = 0;
    let blastFileCount = 0;
    if (changedSymbols.length) {
      const revAdj = buildReverseAdj(db);
      const symIds = new Set(changedSymbols.map(s => s.id));
      const reachable = bfsReachable(revAdj, symIds, 10);
      blastSymCount = reachable.size;
      const fileSet = new Set();
      if (reachable.size > 0) {
        const rows = batchedIn(
          db, 'SELECT s.file_id FROM symbols s WHERE s.id IN ({ph})', [...reachable],
        );
        for (const r of rows) fileSet.add(r.file_id);
      }
      blastFileCount = fileSet.size;
    }
    sections.blast_radius = { symbols: blastSymCount, files: blastFileCount };

    // 2. Breaking changes (exported symbols with consumers)
    const breakingItems = [];
    for (const sym of changedSymbols.filter(s => s.is_exported)) {
      const consumers = db.prepare('SELECT COUNT(*) as cnt FROM edges WHERE target_id = ?').get(sym.id);
      if (consumers.cnt > 0) {
        breakingItems.push({
          name: sym.name, kind: sym.kind, consumers: consumers.cnt,
          location: loc(sym.file_path, sym.line_start),
        });
      }
    }
    breakingItems.sort((a, b) => b.consumers - a.consumers);
    sections.breaking = breakingItems.slice(0, 20);

    // 3. Test coverage for changed symbols
    const untestedSymbols = [];
    for (const sym of changedSymbols.filter(s => s.is_exported)) {
      const testCallers = db.prepare(`
        SELECT COUNT(*) as cnt FROM edges e
        JOIN symbols s ON e.source_id = s.id
        JOIN files f ON s.file_id = f.id
        WHERE e.target_id = ? AND (f.path LIKE '%test%' OR f.path LIKE '%spec%')
      `).get(sym.id);
      if (testCallers.cnt === 0 && sym.pagerank > 0) {
        untestedSymbols.push({
          name: sym.name, kind: sym.kind, pagerank: sym.pagerank,
          complexity: sym.complexity, location: loc(sym.file_path, sym.line_start),
        });
      }
    }
    untestedSymbols.sort((a, b) => b.pagerank - a.pagerank);
    sections.untested = untestedSymbols.slice(0, 15);

    // 4. Complexity of changed symbols
    const complexItems = changedSymbols.filter(s => s.complexity > 10)
      .sort((a, b) => b.complexity - a.complexity)
      .slice(0, 10)
      .map(s => ({
        name: s.name, kind: s.kind, complexity: s.complexity,
        location: loc(s.file_path, s.line_start),
      }));
    sections.complexity = complexItems;

    // 5. Risk score
    let riskScore = 0;
    riskScore += Math.min(blastSymCount / 50, 1) * 0.3;
    riskScore += Math.min(breakingItems.length / 10, 1) * 0.25;
    riskScore += Math.min(untestedSymbols.length / 10, 1) * 0.2;
    riskScore += Math.min(complexItems.length / 5, 1) * 0.15;
    riskScore += sourceFiles.length > 10 ? 0.1 : sourceFiles.length / 100;
    riskScore = Math.round(riskScore * 1000) / 1000;

    let riskLevel;
    if (riskScore > 0.7) riskLevel = 'CRITICAL';
    else if (riskScore > 0.5) riskLevel = 'HIGH';
    else if (riskScore > 0.25) riskLevel = 'MEDIUM';
    else riskLevel = 'LOW';

    // SARIF export
    if (sarifPath) {
      const log = createSarifLog();
      const rules = [
        makeRule('ROAM-PR-BLAST', 'blast-radius', `Blast radius: ${blastSymCount} symbols`, null, blastSymCount > 50 ? 'error' : 'warning'),
        makeRule('ROAM-PR-BREAKING', 'breaking-change', 'Modified exported symbol with consumers', null, 'warning'),
        makeRule('ROAM-PR-UNTESTED', 'untested-change', 'Changed symbol without test coverage', null, 'note'),
      ];
      const results = [];
      for (const b of breakingItems.slice(0, 20)) {
        results.push(makeResult('ROAM-PR-BREAKING', `${b.name}: ${b.consumers} consumers`, [], 'warning'));
      }
      for (const u of untestedSymbols.slice(0, 20)) {
        results.push(makeResult('ROAM-PR-UNTESTED', `${u.name}: untested (PR=${u.pagerank.toFixed(4)})`, [], 'note'));
      }
      addRun(log, 'pr-risk', rules, results);
      writeSarif(log, sarifPath);
      console.log(`SARIF written to ${sarifPath}`);
    }

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('pr-risk', {
        summary: {
          risk: riskLevel, score: riskScore,
          changed_files: changedFiles.length,
          source_files: sourceFiles.length,
          test_files: testFilesChanged.length,
          blast_radius: blastSymCount,
          breaking_changes: breakingItems.length,
          untested_symbols: untestedSymbols.length,
        },
        sections,
      })));
    } else {
      console.log(`PR Risk: ${riskLevel} (score: ${riskScore})\n`);
      console.log(`Files: ${changedFiles.length} changed (${sourceFiles.length} source, ${testFilesChanged.length} test)`);
      console.log(`Blast radius: ${blastSymCount} symbols across ${blastFileCount} files\n`);

      if (breakingItems.length) {
        console.log(`Breaking Changes (${breakingItems.length}):`);
        const headers = ['Name', 'Kind', 'Consumers', 'Location'];
        const rows = breakingItems.slice(0, 10).map(b => [b.name, abbrevKind(b.kind), b.consumers, b.location]);
        console.log(formatTable(headers, rows));
        console.log('');
      }

      if (untestedSymbols.length) {
        console.log(`Untested Changes (${untestedSymbols.length}):`);
        const headers = ['Name', 'Kind', 'PR', 'CC', 'Location'];
        const rows = untestedSymbols.slice(0, 10).map(u => [
          u.name, abbrevKind(u.kind), u.pagerank.toFixed(4), u.complexity, u.location,
        ]);
        console.log(formatTable(headers, rows));
        console.log('');
      }

      if (complexItems.length) {
        console.log(`Complex Symbols Modified (${complexItems.length}):`);
        const headers = ['Name', 'Kind', 'CC', 'Location'];
        const rows = complexItems.map(c => [c.name, abbrevKind(c.kind), c.complexity, c.location]);
        console.log(formatTable(headers, rows));
      }
    }
  } finally {
    db.close();
  }
}
