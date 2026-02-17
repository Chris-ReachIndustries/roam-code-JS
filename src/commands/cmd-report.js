/**
 * roam report — Generate comprehensive project report.
 */

import { openDb } from '../db/connection.js';
import { UNREFERENCED_EXPORTS, FILE_COUNT, LANGUAGE_DISTRIBUTION, SYMBOL_KIND_DISTRIBUTION } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { jsonEnvelope, toJson } from '../output/formatter.js';
import { findProjectRoot } from '../db/connection.js';
import { buildSymbolGraph } from '../graph/builder.js';
import { findCycles } from '../graph/cycles.js';
import { getPreset, evaluateGates } from '../analysis/gate-presets.js';
import { createSarifLog, addRun, writeSarif, deadCodeToSarif, complexityToSarif, healthToSarif } from '../output/sarif.js';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const format = opts.format || 'md';
    const outputPath = opts.output || null;
    const presetName = opts.preset || 'default';

    const root = findProjectRoot();
    const projectName = basename(root);

    // Gather all data
    const fileCount = db.prepare(FILE_COUNT).get().cnt;
    const languages = db.prepare(LANGUAGE_DISTRIBUTION).all();
    const kindDist = db.prepare(SYMBOL_KIND_DISTRIBUTION).all();
    const symbolCount = kindDist.reduce((s, k) => s + k.cnt, 0);
    const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM edges').get().cnt;

    // Dead code
    let deadCount = 0;
    let deadSymbols = [];
    try {
      deadSymbols = db.prepare(UNREFERENCED_EXPORTS).all();
      deadCount = deadSymbols.length;
    } catch { /* ok */ }

    // Complexity
    let avgComplexity = 0;
    let maxComplexity = 0;
    let complexSymbols = [];
    try {
      const cRow = db.prepare(
        'SELECT AVG(cognitive_complexity) as avg_cc, MAX(cognitive_complexity) as max_cc FROM symbol_metrics WHERE cognitive_complexity > 0'
      ).get();
      avgComplexity = cRow?.avg_cc ? Math.round(cRow.avg_cc * 10) / 10 : 0;
      maxComplexity = cRow?.max_cc || 0;
      complexSymbols = db.prepare(`
        SELECT s.name, s.kind, f.path as file_path, s.line_start, sm.cognitive_complexity
        FROM symbol_metrics sm JOIN symbols s ON sm.symbol_id = s.id JOIN files f ON s.file_id = f.id
        WHERE sm.cognitive_complexity > 15 ORDER BY sm.cognitive_complexity DESC LIMIT 10
      `).all();
    } catch { /* ok */ }

    // Cycles
    let cycleCount = 0;
    let tangleRatio = 0;
    try {
      const G = buildSymbolGraph(db);
      if (G.order > 0 && G.order < 5000) {
        const cycles = findCycles(G);
        cycleCount = cycles.length;
        const cycleSyms = new Set();
        for (const scc of cycles) for (const id of scc) cycleSyms.add(id);
        tangleRatio = Math.round(cycleSyms.size / Math.max(symbolCount, 1) * 1000) / 10;
      }
    } catch { /* ok */ }

    // God components
    let godCount = 0;
    try {
      godCount = db.prepare('SELECT COUNT(*) as cnt FROM graph_metrics WHERE (in_degree + out_degree) > 20').get().cnt;
    } catch { /* ok */ }

    // Fitness gates
    const metrics = {
      file_count: fileCount, symbol_count: symbolCount, edge_count: edgeCount,
      avg_complexity: avgComplexity, max_complexity: maxComplexity,
      dead_count: deadCount, dead_pct: symbolCount > 0 ? Math.round(deadCount / symbolCount * 1000) / 10 : 0,
      test_ratio: fileCount > 0 ? db.prepare("SELECT COUNT(*) as cnt FROM files WHERE path LIKE '%test%' OR path LIKE '%spec%'").get().cnt / fileCount : 0,
      cycle_count: cycleCount, tangle_ratio: tangleRatio,
      god_components: godCount, coupling_density: 0,
    };
    const gateResult = evaluateGates(metrics, presetName);

    // SARIF format
    if (format === 'sarif') {
      const log = createSarifLog();

      // Dead code run
      if (deadSymbols.length) {
        const dc = deadCodeToSarif(deadSymbols);
        addRun(log, 'dead-code', dc.rules, dc.results);
      }

      // Complexity run
      if (complexSymbols.length) {
        const cc = complexityToSarif(complexSymbols);
        addRun(log, 'complexity', cc.rules, cc.results);
      }

      // Health run
      const healthItems = [];
      if (godCount > 0) healthItems.push({ name: 'god_components', category: 'god', severity: godCount > 5 ? 'CRITICAL' : 'WARNING', detail: `${godCount} god components` });
      if (cycleCount > 0) healthItems.push({ name: 'cycles', category: 'cycle', severity: cycleCount > 5 ? 'CRITICAL' : 'WARNING', detail: `${cycleCount} dependency cycles` });
      if (healthItems.length) {
        const hi = healthToSarif(healthItems);
        addRun(log, 'health', hi.rules, hi.results);
      }

      if (outputPath) {
        writeSarif(log, outputPath);
        console.log(`SARIF report written to ${outputPath}`);
      } else {
        console.log(JSON.stringify(log, null, 2));
      }
      return;
    }

    // JSON format
    if (jsonMode || format === 'json') {
      const report = jsonEnvelope('report', {
        summary: {
          project: projectName, files: fileCount, symbols: symbolCount,
          edges: edgeCount, languages: languages.length,
          health: gateResult.passed ? 'PASS' : 'FAIL',
        },
        metrics,
        gates: gateResult,
        top_complexity: complexSymbols.map(s => ({ name: s.name, kind: s.kind, cc: s.cognitive_complexity, location: `${s.file_path}:${s.line_start}` })),
        dead_code: { count: deadCount, pct: metrics.dead_pct },
        cycles: { count: cycleCount, tangle_ratio: tangleRatio },
      });
      const json = toJson(report);
      if (outputPath) {
        writeFileSync(outputPath, json, 'utf-8');
        console.log(`JSON report written to ${outputPath}`);
      } else {
        console.log(json);
      }
      return;
    }

    // Markdown format
    const md = _buildMarkdownReport(projectName, metrics, gateResult, languages, kindDist,
      complexSymbols, deadCount, cycleCount, tangleRatio, godCount, presetName);

    if (outputPath) {
      writeFileSync(outputPath, md, 'utf-8');
      console.log(`Report written to ${outputPath}`);
    } else {
      console.log(md);
    }
  } finally {
    db.close();
  }
}

function _buildMarkdownReport(projectName, metrics, gates, languages, kindDist,
  complexSymbols, deadCount, cycleCount, tangleRatio, godCount, presetName) {
  const lines = [];

  lines.push(`# ${projectName} — Project Report`);
  lines.push('');
  lines.push(`*Generated by roam-code-js*`);
  lines.push('');

  // Overview
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files | ${metrics.file_count} |`);
  lines.push(`| Symbols | ${metrics.symbol_count} |`);
  lines.push(`| Edges | ${metrics.edge_count} |`);
  lines.push(`| Languages | ${languages.length} |`);
  lines.push('');

  // Languages
  if (languages.length) {
    lines.push('## Languages');
    lines.push('');
    for (const l of languages.slice(0, 10)) {
      lines.push(`- ${l.language}: ${l.cnt} files`);
    }
    lines.push('');
  }

  // Quality Gates
  lines.push(`## Quality Gates (${presetName})`);
  lines.push('');
  lines.push(`**Overall: ${gates.passed ? 'PASS' : 'FAIL'}** (${gates.checks.filter(c => c.pass).length}/${gates.checks.length})`);
  lines.push('');
  lines.push('| Gate | Threshold | Actual | Status |');
  lines.push('|------|-----------|--------|--------|');
  for (const c of gates.checks) {
    lines.push(`| ${c.name} | ${c.op} ${c.threshold} | ${c.actual} | ${c.pass ? 'PASS' : '**FAIL**'} |`);
  }
  lines.push('');

  // Complexity
  lines.push('## Complexity');
  lines.push('');
  lines.push(`- Average: ${metrics.avg_complexity}`);
  lines.push(`- Maximum: ${metrics.max_complexity}`);
  if (complexSymbols.length) {
    lines.push('');
    lines.push('Top complex symbols:');
    for (const s of complexSymbols.slice(0, 5)) {
      lines.push(`- \`${s.name}\` (${s.kind}) — CC: ${s.cognitive_complexity} — ${s.file_path}:${s.line_start}`);
    }
  }
  lines.push('');

  // Dead Code
  lines.push('## Dead Code');
  lines.push('');
  lines.push(`- Unreferenced exports: ${deadCount} (${metrics.dead_pct}%)`);
  lines.push('');

  // Architecture
  lines.push('## Architecture');
  lines.push('');
  lines.push(`- Dependency cycles: ${cycleCount}`);
  lines.push(`- Tangle ratio: ${tangleRatio}%`);
  lines.push(`- God components: ${godCount}`);
  lines.push('');

  lines.push('---');
  return lines.join('\n');
}
