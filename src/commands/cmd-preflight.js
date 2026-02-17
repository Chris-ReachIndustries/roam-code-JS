/**
 * roam preflight — Pre-commit risk analysis with 6 automated checks.
 */

import { openDb } from '../db/connection.js';
import { SYMBOLS_IN_FILE } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';
import { findProjectRoot, batchedIn } from '../db/connection.js';
import { getChangedFiles, resolveChangedToDb, isTestFile, isLowRiskFile } from './changed-files.js';
import { buildReverseAdj, bfsReachable } from './graph-helpers.js';
import { getAffectedTestsBfs, getSymbolMetrics, getCoupling } from './context-helpers.js';
import { isTest } from '../index/file-roles.js';

const RISK_LEVELS = ['OK', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const staged = opts.staged || false;
    const target = opts.target || null;

    // Get changed files
    const root = findProjectRoot();
    let paths;
    if (target) {
      paths = [target];
    } else {
      paths = getChangedFiles(root, { staged });
    }

    if (!paths.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('preflight', { summary: { risk: 'OK', checks: 0 }, checks: [] })));
      } else {
        console.log('No changed files detected. All clear!');
      }
      return;
    }

    const resolved = resolveChangedToDb(db, paths);
    if (!resolved.length) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('preflight', { summary: { risk: 'OK', checks: 0, note: 'No files in index' }, checks: [] })));
      } else {
        console.log('Changed files not found in index. Re-run `roam index`.');
      }
      return;
    }

    // Gather all symbols in changed files
    const changedSymbols = [];
    for (const { fileId } of resolved) {
      const syms = db.prepare(SYMBOLS_IN_FILE).all(fileId);
      changedSymbols.push(...syms);
    }
    const exportedIds = new Set(changedSymbols.filter(s => s.is_exported).map(s => s.id));

    const checks = [];

    // Check 1: Blast Radius
    const revAdj = buildReverseAdj(db);
    const blastReachable = exportedIds.size > 0 ? bfsReachable(revAdj, exportedIds, 8) : new Set();
    const affectedFileIds = new Set();
    if (blastReachable.size > 0) {
      const rows = batchedIn(db, 'SELECT id, file_id FROM symbols WHERE id IN ({ph})', [...blastReachable]);
      for (const r of rows) affectedFileIds.add(r.file_id);
    }

    let blastSeverity = 'OK';
    if (blastReachable.size >= 50) blastSeverity = 'CRITICAL';
    else if (blastReachable.size >= 20) blastSeverity = 'HIGH';
    else if (blastReachable.size >= 5) blastSeverity = 'MEDIUM';
    else if (blastReachable.size >= 1) blastSeverity = 'LOW';

    checks.push({
      name: 'Blast Radius',
      severity: blastSeverity,
      detail: `${blastReachable.size} symbols, ${affectedFileIds.size} files affected`,
    });

    // Check 2: Affected Tests
    const affectedTests = exportedIds.size > 0 ? getAffectedTestsBfs(db, [...exportedIds], 8) : [];
    const testSeverity = affectedTests.length === 0 && exportedIds.size > 0 ? 'MEDIUM' : 'OK';
    checks.push({
      name: 'Test Coverage',
      severity: testSeverity,
      detail: affectedTests.length > 0
        ? `${affectedTests.length} test(s) cover changed code`
        : exportedIds.size > 0 ? 'No tests found for changed exported symbols' : 'No exported symbols changed',
    });

    // Check 3: Complexity
    let maxComplexity = 0;
    let complexSymbol = null;
    for (const sym of changedSymbols) {
      const metrics = getSymbolMetrics(db, sym.id);
      if (metrics && metrics.cognitive_complexity > maxComplexity) {
        maxComplexity = metrics.cognitive_complexity;
        complexSymbol = sym.name;
      }
    }

    let complexitySeverity = 'OK';
    if (maxComplexity >= 50) complexitySeverity = 'HIGH';
    else if (maxComplexity >= 25) complexitySeverity = 'MEDIUM';
    else if (maxComplexity >= 10) complexitySeverity = 'LOW';

    checks.push({
      name: 'Complexity',
      severity: complexitySeverity,
      detail: maxComplexity > 0
        ? `Max cognitive complexity: ${maxComplexity} (${complexSymbol})`
        : 'No complexity data available',
    });

    // Check 4: Coupling
    let maxCochange = 0;
    let missingPartners = [];
    const changedFileIds = new Set(resolved.map(r => r.fileId));
    for (const { fileId } of resolved) {
      const partners = getCoupling(db, fileId, 5);
      for (const p of partners) {
        if (p.count > maxCochange) maxCochange = p.count;
        // Check if co-change partner is NOT in the changeset
        const partnerFile = db.prepare('SELECT id FROM files WHERE path = ?').get(p.path);
        if (partnerFile && !changedFileIds.has(partnerFile.id)) {
          missingPartners.push(p);
        }
      }
    }

    let couplingSeverity = 'OK';
    if (missingPartners.length >= 5) couplingSeverity = 'HIGH';
    else if (missingPartners.length >= 2) couplingSeverity = 'MEDIUM';
    else if (missingPartners.length >= 1) couplingSeverity = 'LOW';

    checks.push({
      name: 'Coupling',
      severity: couplingSeverity,
      detail: missingPartners.length > 0
        ? `${missingPartners.length} co-change partner(s) not in changeset`
        : 'All co-change partners included',
    });

    // Check 5: Conventions (test files for changed code files)
    const codeFiles = resolved.filter(r => !isTestFile(r.path) && !isLowRiskFile(r.path));
    const hasTests = codeFiles.length === 0 || affectedTests.length > 0;
    checks.push({
      name: 'Conventions',
      severity: hasTests ? 'OK' : 'LOW',
      detail: hasTests ? 'Test convention satisfied' : `${codeFiles.length} code file(s) with no associated tests`,
    });

    // Check 6: Fitness (low-risk file ratio)
    const lowRiskCount = resolved.filter(r => isLowRiskFile(r.path)).length;
    const testCount = resolved.filter(r => isTestFile(r.path)).length;
    const codeCount = resolved.length - lowRiskCount - testCount;
    checks.push({
      name: 'Fitness',
      severity: 'OK',
      detail: `${codeCount} code, ${testCount} test, ${lowRiskCount} low-risk files`,
    });

    // Overall risk
    const overallRisk = checks.reduce((max, c) => {
      const idx = RISK_LEVELS.indexOf(c.severity);
      return idx > RISK_LEVELS.indexOf(max) ? c.severity : max;
    }, 'OK');

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('preflight', {
        summary: {
          risk: overallRisk,
          checks: checks.length,
          changed_files: resolved.length,
          changed_symbols: changedSymbols.length,
        },
        checks,
      })));
    } else {
      console.log(`=== Preflight Check (${resolved.length} changed files) ===\n`);

      for (const check of checks) {
        const icon = check.severity === 'OK' ? 'PASS' : check.severity;
        console.log(`  [${icon}] ${check.name}: ${check.detail}`);
      }

      console.log(`\nOverall Risk: ${overallRisk}`);

      if (missingPartners.length) {
        console.log(`\nMissing co-change partners:`);
        for (const p of missingPartners.slice(0, 5)) {
          console.log(`  ${p.path} (${p.count} co-changes, ${p.strength})`);
        }
      }
    }
  } finally {
    db.close();
  }
}
