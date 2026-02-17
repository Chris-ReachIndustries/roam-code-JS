/**
 * roam understand — Single-call project briefing with all key sections.
 */

import { openDb } from '../db/connection.js';
import { ALL_FILES, TOP_SYMBOLS_BY_PAGERANK, LANGUAGE_DISTRIBUTION, SYMBOL_KIND_DISTRIBUTION,
  TOP_CHURN_FILES, FILE_COUNT, ALL_CLUSTERS, TOP_BY_BETWEENNESS, ALL_EDGES } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { findProjectRoot } from '../db/connection.js';
import { buildSymbolGraph } from '../graph/builder.js';
import { findCycles, propagationCost } from '../graph/cycles.js';
import { dirname, basename, extname } from 'node:path';

// Framework detection patterns
const FRAMEWORK_PATTERNS = {
  'React': [/from ['"]react['"]/, /import.*React/],
  'Vue': [/from ['"]vue['"]/, /\.vue$/],
  'Angular': [/@angular\/core/, /@Component/],
  'Express': [/from ['"]express['"]/, /require\(['"]express['"]\)/],
  'FastAPI': [/from fastapi/, /import fastapi/],
  'Django': [/from django/, /import django/],
  'Flask': [/from flask/, /import flask/],
  'Spring': [/@SpringBoot/, /org\.springframework/],
  'Next.js': [/from ['"]next/, /next\.config/],
  'Svelte': [/\.svelte$/, /from ['"]svelte['"]/],
};

// Build tool detection
const BUILD_TOOLS = {
  'package.json': 'npm/yarn',
  'Cargo.toml': 'Cargo (Rust)',
  'go.mod': 'Go Modules',
  'pom.xml': 'Maven (Java)',
  'build.gradle': 'Gradle (Java)',
  'Makefile': 'Make',
  'CMakeLists.txt': 'CMake',
  'pyproject.toml': 'Python (pyproject)',
  'setup.py': 'Python (setup.py)',
  'Dockerfile': 'Docker',
  'docker-compose.yml': 'Docker Compose',
  'tsconfig.json': 'TypeScript',
  'webpack.config.js': 'Webpack',
  'vite.config.ts': 'Vite',
  'vite.config.js': 'Vite',
};

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const full = opts.full || false;

    const root = findProjectRoot();
    const projectName = basename(root);

    // Basic stats
    const fileCount = db.prepare(FILE_COUNT).get().cnt;
    const languages = db.prepare(LANGUAGE_DISTRIBUTION).all();
    const kindDist = db.prepare(SYMBOL_KIND_DISTRIBUTION).all();
    const totalSymbols = kindDist.reduce((sum, k) => sum + k.cnt, 0);
    const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM edges').get().cnt;

    // Key abstractions
    const topSymbols = db.prepare(TOP_SYMBOLS_BY_PAGERANK).all(full ? 30 : 15);

    // Hotspots
    let hotspots = [];
    try { hotspots = db.prepare(TOP_CHURN_FILES).all(10); } catch { /* ok */ }

    // Clusters
    const clusters = db.prepare(ALL_CLUSTERS).all();

    // Bottlenecks (high betweenness)
    let bottlenecks = [];
    try { bottlenecks = db.prepare(TOP_BY_BETWEENNESS).all(10); } catch { /* ok */ }

    // Files for framework/build tool detection
    const files = db.prepare(ALL_FILES).all();

    // Framework detection
    const detectedFrameworks = _detectFrameworks(db, files);

    // Build tool detection
    const detectedBuildTools = _detectBuildTools(files);

    // Entry points
    const entryPoints = db.prepare(
      `SELECT s.name, s.kind, f.path as file_path
       FROM symbols s JOIN files f ON s.file_id = f.id
       WHERE s.is_exported = 1 AND (
         f.path LIKE '%main%' OR f.path LIKE '%index%' OR f.path LIKE '%app%'
         OR f.path LIKE '%cli%' OR f.path LIKE '%server%' OR f.path LIKE '%__main__%'
       ) ORDER BY f.path LIMIT 15`
    ).all();

    // Cycles
    let cycleInfo = { count: 0, cycles: [] };
    try {
      const G = buildSymbolGraph(db);
      if (G.order > 0 && G.order < 5000) {
        const cycles = findCycles(G);
        cycleInfo = { count: cycles.length, cycles: cycles.slice(0, 5) };
      }
    } catch { /* ok */ }

    // Directory structure
    const dirs = new Map();
    for (const f of files) {
      const d = dirname(f.path).replace(/\\/g, '/');
      if (!dirs.has(d)) dirs.set(d, { count: 0, languages: new Set() });
      const info = dirs.get(d);
      info.count++;
      if (f.language) info.languages.add(f.language);
    }
    const topDirs = [...dirs.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);

    // Complexity overview
    let complexityOverview = null;
    try {
      const cRow = db.prepare(
        `SELECT AVG(cognitive_complexity) as avg_cc, MAX(cognitive_complexity) as max_cc,
                COUNT(*) as total FROM symbol_metrics WHERE cognitive_complexity > 0`
      ).get();
      if (cRow && cRow.total > 0) {
        complexityOverview = {
          avg: Math.round(cRow.avg_cc * 10) / 10,
          max: cRow.max_cc,
          measured: cRow.total,
        };
      }
    } catch { /* ok */ }

    // Convention detection
    const conventions = _detectConventions(files, kindDist);

    // Debt ranking
    const debtItems = [];
    if (hotspots.length > 3) debtItems.push(`${hotspots.length} high-churn files`);
    if (cycleInfo.count > 0) debtItems.push(`${cycleInfo.count} dependency cycles`);
    if (complexityOverview && complexityOverview.max > 50) debtItems.push(`Max complexity: ${complexityOverview.max}`);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('understand', {
        summary: {
          project: projectName,
          files: fileCount,
          symbols: totalSymbols,
          edges: edgeCount,
          languages: languages.length,
          frameworks: detectedFrameworks,
          build_tools: detectedBuildTools,
        },
        languages: languages.slice(0, 10),
        kind_distribution: kindDist,
        entry_points: entryPoints,
        key_abstractions: topSymbols.map(s => ({
          name: s.name, kind: s.kind, pagerank: s.pagerank,
          location: loc(s.file_path, s.line_start),
        })),
        hotspots: hotspots.map(h => ({
          path: h.path, churn: h.total_churn,
          commits: h.commit_count, authors: h.distinct_authors,
        })),
        clusters: clusters.slice(0, 20).map(c => ({
          label: c.cluster_label, size: c.size,
        })),
        bottlenecks: bottlenecks.slice(0, 10).map(b => ({
          name: b.name, kind: b.kind, betweenness: b.betweenness,
          location: loc(b.file_path, b.line_start),
        })),
        cycles: cycleInfo,
        complexity: complexityOverview,
        conventions,
        debt: debtItems,
        directories: topDirs.map(([d, info]) => ({
          path: d, files: info.count, languages: [...info.languages],
        })),
      })));
    } else {
      _renderText(projectName, fileCount, totalSymbols, edgeCount, languages, kindDist,
        topSymbols, topDirs, entryPoints, detectedFrameworks, detectedBuildTools,
        clusters, hotspots, bottlenecks, cycleInfo, complexityOverview,
        conventions, debtItems, full);
    }
  } finally {
    db.close();
  }
}

function _renderText(projectName, fileCount, totalSymbols, edgeCount, languages, kindDist,
  topSymbols, topDirs, entryPoints, frameworks, buildTools, clusters, hotspots,
  bottlenecks, cycleInfo, complexity, conventions, debt, full) {

  console.log(`╔══ ${projectName} ══╗\n`);

  // Overview
  const langStr = languages.slice(0, 5).map(l => `${l.language}(${l.cnt})`).join(' ');
  console.log(`${fileCount} files  ${totalSymbols} symbols  ${edgeCount} edges  ${langStr}\n`);

  // Frameworks & Build Tools
  if (frameworks.length) console.log(`Frameworks: ${frameworks.join(', ')}`);
  if (buildTools.length) console.log(`Build tools: ${buildTools.join(', ')}`);
  if (frameworks.length || buildTools.length) console.log('');

  // Entry Points
  if (entryPoints.length) {
    console.log(`Entry Points (${entryPoints.length}):`);
    for (const ep of entryPoints.slice(0, full ? 15 : 8)) {
      console.log(`  ${abbrevKind(ep.kind)}  ${ep.name}  ${ep.file_path}`);
    }
    console.log('');
  }

  // Key Abstractions
  if (topSymbols.length) {
    console.log(`Key Abstractions (top ${topSymbols.length} by PageRank):`);
    const headers = ['Name', 'Kind', 'PR', 'Location'];
    const rows = topSymbols.slice(0, full ? 30 : 15).map(s => [
      s.name, abbrevKind(s.kind), (s.pagerank || 0).toFixed(4), loc(s.file_path, s.line_start),
    ]);
    console.log(formatTable(headers, rows));
    console.log('');
  }

  // Directories
  console.log(`Directories (top ${topDirs.length}):`);
  for (const [dir, info] of topDirs) {
    console.log(`  ${dir}/  ${info.count} files  [${[...info.languages].join(',')}]`);
  }
  console.log('');

  // Hotspots
  if (hotspots.length) {
    console.log(`Hotspots (${hotspots.length}):`);
    const headers = ['Path', 'Churn', 'Commits'];
    const rows = hotspots.slice(0, 5).map(h => [h.path, h.total_churn, h.commit_count || '?']);
    console.log(formatTable(headers, rows));
    console.log('');
  }

  // Complexity
  if (complexity) {
    console.log(`Complexity: avg=${complexity.avg}  max=${complexity.max}  (${complexity.measured} symbols measured)`);
    console.log('');
  }

  // Cycles
  if (cycleInfo.count > 0) {
    console.log(`Cycles: ${cycleInfo.count} dependency cycles detected`);
    for (const cycle of cycleInfo.cycles.slice(0, 3)) {
      const names = cycle.map ? cycle.map(n => n) : [];
      if (names.length) console.log(`  ${names.slice(0, 5).join(' → ')}${names.length > 5 ? ' ...' : ''}`);
    }
    console.log('');
  }

  // Clusters
  if (clusters.length) {
    console.log(`Clusters (${clusters.length}):`);
    for (const c of clusters.slice(0, full ? 20 : 8)) {
      console.log(`  ${c.cluster_label} (${c.size} symbols)`);
    }
    console.log('');
  }

  // Bottlenecks
  if (bottlenecks.length) {
    console.log(`Bottlenecks (high betweenness):`);
    for (const b of bottlenecks.slice(0, 5)) {
      console.log(`  ${abbrevKind(b.kind)}  ${b.name}  betweenness=${(b.betweenness || 0).toFixed(2)}  ${loc(b.file_path, b.line_start)}`);
    }
    console.log('');
  }

  // Conventions
  if (conventions.length) {
    console.log(`Conventions:`);
    for (const c of conventions) console.log(`  ${c}`);
    console.log('');
  }

  // Debt
  if (debt.length) {
    console.log(`Technical Debt:`);
    for (const d of debt) console.log(`  - ${d}`);
  }
}

function _detectFrameworks(db, files) {
  const detected = new Set();

  // Check file extensions
  for (const f of files) {
    if (f.path.endsWith('.vue')) detected.add('Vue');
    if (f.path.endsWith('.svelte')) detected.add('Svelte');
    if (f.path.endsWith('.tsx') || f.path.endsWith('.jsx')) detected.add('React');
  }

  // Check for framework imports in edges or file patterns
  for (const [fw, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
    if (detected.has(fw)) continue;
    for (const f of files.slice(0, 200)) {
      for (const pattern of patterns) {
        if (pattern.test(f.path)) {
          detected.add(fw);
          break;
        }
      }
      if (detected.has(fw)) break;
    }
  }

  // Also check via file content patterns in symbols
  try {
    const importRows = db.prepare(
      "SELECT DISTINCT s.name FROM symbols s WHERE s.kind = 'module' OR s.kind = 'package' LIMIT 200"
    ).all();
    const moduleNames = new Set(importRows.map(r => r.name.toLowerCase()));
    if (moduleNames.has('react') || moduleNames.has('react-dom')) detected.add('React');
    if (moduleNames.has('vue')) detected.add('Vue');
    if (moduleNames.has('express')) detected.add('Express');
    if (moduleNames.has('django')) detected.add('Django');
    if (moduleNames.has('flask')) detected.add('Flask');
    if (moduleNames.has('fastapi')) detected.add('FastAPI');
  } catch { /* ok */ }

  return [...detected];
}

function _detectBuildTools(files) {
  const detected = [];
  const filenames = new Set(files.map(f => basename(f.path)));

  for (const [filename, tool] of Object.entries(BUILD_TOOLS)) {
    if (filenames.has(filename)) detected.push(tool);
  }
  return detected;
}

function _detectConventions(files, kindDist) {
  const conventions = [];

  // Naming conventions
  const fnNames = [];
  try {
    // Check if functions use camelCase or snake_case
    for (const k of kindDist) {
      if (k.kind === 'function' && k.cnt > 0) {
        conventions.push(`${k.cnt} functions detected`);
        break;
      }
    }
  } catch { /* ok */ }

  // File organization
  const hasTests = files.some(f => f.path.includes('test') || f.path.includes('spec'));
  if (hasTests) conventions.push('Test files present');

  const hasSrc = files.some(f => f.path.startsWith('src/'));
  if (hasSrc) conventions.push('src/ directory structure');

  const hasLib = files.some(f => f.path.startsWith('lib/'));
  if (hasLib) conventions.push('lib/ directory structure');

  return conventions;
}
