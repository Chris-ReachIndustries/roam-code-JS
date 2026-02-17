/**
 * Detect and report code health issues.
 */

import { openDb, batchedIn } from '../db/connection.js';
import { TOP_BY_DEGREE, TOP_BY_BETWEENNESS } from '../db/queries.js';
import { buildSymbolGraph } from '../graph/builder.js';
import { findCycles, findWeakestEdge, formatCycles, propagationCost, algebraicConnectivity } from '../graph/cycles.js';
import { detectLayers, findViolations } from '../graph/layers.js';
import { abbrevKind, loc, formatTable, toJson, jsonEnvelope } from '../output/formatter.js';
import { ensureIndex } from './resolve.js';
import { createSarifLog, addRun, writeSarif, healthToSarif } from '../output/sarif.js';

const FRAMEWORK_NAMES = new Set([
  '__init__', '__str__', '__repr__', '__new__', '__del__', '__enter__',
  '__exit__', '__getattr__', '__setattr__', '__getitem__', '__setitem__',
  '__len__', '__iter__', '__next__', '__call__', '__hash__', '__eq__',
  'constructor', 'render', 'toString', 'valueOf', 'toJSON',
  'setUp', 'tearDown', 'setup', 'teardown',
  'configure', 'register', 'bootstrap', 'main',
  'computed', 'ref', 'reactive', 'watch', 'watchEffect',
  'defineProps', 'defineEmits', 'defineExpose', 'defineSlots',
  'onMounted', 'onUnmounted', 'onBeforeMount', 'onBeforeUnmount',
  'onActivated', 'onDeactivated', 'onUpdated', 'onBeforeUpdate',
  'provide', 'inject', 'toRef', 'toRefs', 'unref', 'isRef',
  'shallowRef', 'shallowReactive', 'readonly', 'shallowReadonly',
  'nextTick', 'h', 'resolveComponent', 'emit', 'emits', 'props',
  'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
  'useContext', 'useReducer', 'useLayoutEffect',
  'ngOnInit', 'ngOnDestroy', 'ngOnChanges', 'ngAfterViewInit',
  'init', 'New', 'Close', 'String', 'Error',
  'new', 'default', 'fmt', 'from', 'into', 'drop',
]);

const UTILITY_PATH_PATTERNS = [
  'composables/', 'utils/', 'services/', 'lib/', 'helpers/',
  'shared/', 'config/', 'core/', 'hooks/', 'stores/',
  'output/', 'db/', 'common/', 'internal/', 'infra/',
];
const NON_PRODUCTION_PATH_PATTERNS = [
  'tests/', 'test/', '__tests__/', 'spec/',
  'dev/', 'scripts/', 'bin/', 'benchmark/',
  'conftest.py',
];

function isUtilityPath(filePath) {
  const p = filePath.replace(/\\/g, '/').toLowerCase();
  if (UTILITY_PATH_PATTERNS.some(pat => p.includes(pat))) return true;
  if (NON_PRODUCTION_PATH_PATTERNS.some(pat => p.includes(pat))) return true;
  const basename = p.includes('/') ? p.split('/').pop() : p;
  return ['resolve.py', 'helpers.py', 'common.py', 'base.py'].includes(basename);
}

function percentile(sortedValues, pct) {
  if (!sortedValues.length) return 0;
  const idx = Math.min(Math.floor(pct / 100 * sortedValues.length), sortedValues.length - 1);
  return sortedValues[idx];
}

function uniqueDirs(filePaths) {
  const dirs = new Set();
  for (const fp of filePaths) {
    const p = fp.replace(/\\/g, '/');
    const lastSlash = p.lastIndexOf('/');
    dirs.add(lastSlash >= 0 ? p.slice(0, lastSlash) : '.');
  }
  return dirs;
}

function healthFactor(value, scale) {
  return scale > 0 ? Math.exp(-value / scale) : 1.0;
}

export async function execute(opts, globalOpts) {
  const jsonMode = globalOpts.json || false;
  const noFramework = opts.noFramework || false;
  ensureIndex();

  const db = openDb({ readonly: true });
  try {
    const G = buildSymbolGraph(db);

    // --- Cycles ---
    const cycles = findCycles(G);
    const formattedCycles = cycles.length ? formatCycles(cycles, db) : [];

    // --- Cycle break suggestions ---
    const breakSuggestions = [];
    for (const scc of cycles) {
      if (scc.length < 3) continue;
      const result = findWeakestEdge(G, scc);
      if (!result) continue;
      const [srcId, tgtId, reason] = result;
      const srcName = G.hasNode(srcId) ? (G.getNodeAttribute(srcId, 'name') || '?') : '?';
      const tgtName = G.hasNode(tgtId) ? (G.getNodeAttribute(tgtId, 'name') || '?') : '?';
      breakSuggestions.push({ source_id: srcId, target_id: tgtId, source_name: srcName, target_name: tgtName, reason, scc_size: scc.length });
    }

    // --- God components ---
    const degreeRows = db.prepare(TOP_BY_DEGREE).all(50);
    let godItems = [];
    for (const r of degreeRows) {
      const total = (r.in_degree || 0) + (r.out_degree || 0);
      if (total > 20) {
        godItems.push({ name: r.name, kind: r.kind, degree: total, file: r.file_path });
      }
    }

    // --- Bottlenecks ---
    const allBw = db.prepare(
      'SELECT betweenness FROM graph_metrics WHERE betweenness > 0 ORDER BY betweenness'
    ).all().map(r => r.betweenness);
    const bnP70 = percentile(allBw, 70);
    const bnP90 = percentile(allBw, 90);

    const bwRows = db.prepare(TOP_BY_BETWEENNESS).all(15);
    let bnItems = [];
    for (const r of bwRows) {
      const bw = r.betweenness || 0;
      if (bw > 0.5) {
        bnItems.push({ name: r.name, kind: r.kind, betweenness: Math.round(bw * 10) / 10, file: r.file_path });
      }
    }

    // --- Framework filtering ---
    let filteredCount = 0;
    if (noFramework) {
      const before = godItems.length + bnItems.length;
      godItems = godItems.filter(g => !FRAMEWORK_NAMES.has(g.name));
      bnItems = bnItems.filter(b => !FRAMEWORK_NAMES.has(b.name));
      filteredCount = before - godItems.length - bnItems.length;
    }

    // --- Layer violations ---
    const layerMap = detectLayers(G);
    const violations = layerMap.size ? findViolations(G, layerMap) : [];
    const vLookup = new Map();
    if (violations.length) {
      const allIds = new Set();
      for (const v of violations) { allIds.add(v.source); allIds.add(v.target); }
      for (const r of batchedIn(
        db,
        'SELECT s.id, s.name, f.path as file_path FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.id IN ({ph})',
        [...allIds],
      )) {
        vLookup.set(r.id, r);
      }
    }

    // --- Severity classification ---
    const sevCounts = { CRITICAL: 0, WARNING: 0, INFO: 0 };

    // Cycle severity
    for (const cyc of formattedCycles) {
      const dirs = uniqueDirs(cyc.files);
      cyc.directories = dirs.size;
      if (dirs.size <= 1) cyc.severity = 'INFO';
      else if (cyc.files.length > 3) cyc.severity = 'CRITICAL';
      else cyc.severity = 'WARNING';
      sevCounts[cyc.severity]++;
    }

    // God component severity
    let actionableCount = 0;
    let utilityCount = 0;
    for (const g of godItems) {
      const isUtil = isUtilityPath(g.file);
      g.category = isUtil ? 'utility' : 'actionable';
      if (isUtil) {
        utilityCount++;
        g.severity = g.degree > 150 ? 'CRITICAL' : g.degree > 90 ? 'WARNING' : 'INFO';
      } else {
        actionableCount++;
        g.severity = g.degree > 50 ? 'CRITICAL' : g.degree > 30 ? 'WARNING' : 'INFO';
      }
      sevCounts[g.severity]++;
    }
    godItems.sort((a, b) => {
      const catA = a.category === 'actionable' ? 0 : 1;
      const catB = b.category === 'actionable' ? 0 : 1;
      return catA - catB || b.degree - a.degree;
    });

    // Bottleneck severity
    const BN_UTIL_MULT = 1.5;
    let bnActionable = 0;
    let bnUtility = 0;
    for (const b of bnItems) {
      const isUtil = isUtilityPath(b.file);
      b.category = isUtil ? 'utility' : 'actionable';
      const mult = isUtil ? BN_UTIL_MULT : 1.0;
      if (isUtil) bnUtility++; else bnActionable++;
      if (b.betweenness > bnP90 * mult) b.severity = 'CRITICAL';
      else if (b.betweenness > bnP70 * mult) b.severity = 'WARNING';
      else b.severity = 'INFO';
      sevCounts[b.severity]++;
    }
    bnItems.sort((a, b) => {
      const catA = a.category === 'actionable' ? 0 : 1;
      const catB = b.category === 'actionable' ? 0 : 1;
      return catA - catB || b.betweenness - a.betweenness;
    });

    for (const v of violations) {
      v.severity = 'WARNING';
      sevCounts.WARNING++;
    }

    // --- Tangle ratio ---
    const totalSymbols = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get().cnt || 1;
    const cycleSymbolIds = new Set();
    for (const scc of cycles) for (const id of scc) cycleSymbolIds.add(id);
    const tangleRatio = Math.round(cycleSymbolIds.size / totalSymbols * 1000) / 10;

    // --- Propagation Cost ---
    const propCost = propagationCost(G);

    // --- Algebraic Connectivity ---
    const fiedler = algebraicConnectivity(G);

    // --- Composite health score (0-100) ---
    const godCritical = godItems.filter(g => g.severity === 'CRITICAL').length;
    const godSignal = godCritical * 3 + godItems.length * 0.5;
    const bnCritical = bnItems.filter(b => b.severity === 'CRITICAL').length;
    const bnSignal = bnCritical * 2 + bnItems.length * 0.3;

    const healthFactors = [
      [healthFactor(tangleRatio, 10), 0.30],
      [healthFactor(godSignal, 5), 0.20],
      [healthFactor(bnSignal, 4), 0.15],
      [healthFactor(violations.length, 5), 0.15],
    ];

    try {
      const avgRow = db.prepare('SELECT AVG(health_score) as avg FROM file_stats WHERE health_score IS NOT NULL').get();
      if (avgRow && avgRow.avg != null) {
        healthFactors.push([Math.min(1.0, avgRow.avg / 10.0), 0.20]);
      } else {
        healthFactors.push([1.0, 0.20]);
      }
    } catch {
      healthFactors.push([1.0, 0.20]);
    }

    const logScore = healthFactors.reduce((sum, [h, w]) => sum + w * Math.log(Math.max(h, 1e-9)), 0);
    const healthScore = Math.max(0, Math.min(100, Math.floor(100 * Math.exp(logScore))));

    // --- Verdict ---
    let verdict;
    if (healthScore >= 80) verdict = `Healthy codebase (${healthScore}/100) \u2014 ${sevCounts.CRITICAL} critical issues`;
    else if (healthScore >= 60) verdict = `Fair codebase (${healthScore}/100) \u2014 ${sevCounts.CRITICAL} critical, ${sevCounts.WARNING} warnings`;
    else if (healthScore >= 40) verdict = `Needs attention (${healthScore}/100) \u2014 ${sevCounts.CRITICAL} critical, ${sevCounts.WARNING} warnings`;
    else verdict = `Unhealthy codebase (${healthScore}/100) \u2014 ${sevCounts.CRITICAL} critical, ${sevCounts.WARNING} warnings`;

    // SARIF export
    if (opts.sarif) {
      const sarifItems = [];
      for (const c of formattedCycles) {
        sarifItems.push({ name: `cycle-${c.size}`, kind: 'cycle', category: 'cycle', severity: c.severity, detail: `Cycle of ${c.size} symbols across ${c.directories} dirs` });
      }
      for (const g of godItems) {
        sarifItems.push({ name: g.name, kind: g.kind, file: g.file, category: 'god', severity: g.severity, detail: `God component: degree=${g.degree}` });
      }
      for (const b of bnItems) {
        sarifItems.push({ name: b.name, kind: b.kind, file: b.file, category: 'bottleneck', severity: b.severity, detail: `Bottleneck: betweenness=${b.betweenness}` });
      }
      for (const v of violations) {
        const src = vLookup.get(v.source) || {};
        sarifItems.push({ name: src.name || '?', category: 'layer', severity: 'WARNING', detail: `Layer violation: L${v.source_layer} → L${v.target_layer}` });
      }
      const log = createSarifLog();
      const { rules, results } = healthToSarif(sarifItems);
      addRun(log, 'health', rules, results);
      writeSarif(log, opts.sarif);
      console.log(`SARIF written to ${opts.sarif}`);
    }

    if (jsonMode) {
      const issueCount = cycles.length + godItems.length + bnItems.length + violations.length;
      console.log(toJson(jsonEnvelope('health', {
        summary: {
          verdict, health_score: healthScore, tangle_ratio: tangleRatio,
          propagation_cost: propCost, algebraic_connectivity: fiedler,
          issue_count: issueCount, severity: sevCounts,
        },
        health_score: healthScore,
        tangle_ratio: tangleRatio,
        propagation_cost: propCost,
        algebraic_connectivity: fiedler,
        issue_count: issueCount,
        severity: sevCounts,
        framework_filtered: filteredCount,
        actionable_count: actionableCount,
        utility_count: utilityCount,
        cycles: formattedCycles.map(c => ({
          size: c.size, severity: c.severity, directories: c.directories,
          symbols: c.symbols.map(s => s.name), files: c.files,
        })),
        cycle_break_suggestions: breakSuggestions.map(bs => ({
          source: bs.source_name, target: bs.target_name, reason: bs.reason, scc_size: bs.scc_size,
        })),
        god_components: godItems.map(g => ({ ...g })),
        bottleneck_thresholds: { p70: Math.round(bnP70 * 10) / 10, p90: Math.round(bnP90 * 10) / 10, utility_multiplier: BN_UTIL_MULT, population: allBw.length },
        bottlenecks: bnItems.map(b => ({ ...b })),
        layer_violations: violations.map(v => ({
          severity: 'WARNING',
          source: (vLookup.get(v.source) || {}).name || '?',
          source_layer: v.source_layer,
          target: (vLookup.get(v.target) || {}).name || '?',
          target_layer: v.target_layer,
        })),
      })));
      return;
    }

    // --- Text output ---
    console.log(`VERDICT: ${verdict}\n`);
    const issueCount = cycles.length + godItems.length + bnItems.length + violations.length;

    console.log(`Health Score: ${healthScore}/100  |  Tangle: ${tangleRatio}% (${cycleSymbolIds.size}/${totalSymbols} symbols in cycles)`);
    console.log(`Propagation Cost: ${(propCost * 100).toFixed(1)}%  |  Algebraic Connectivity: ${fiedler.toFixed(4)}`);
    console.log();

    if (issueCount === 0) {
      console.log('Issues: None detected');
    } else {
      const sevParts = [];
      if (sevCounts.CRITICAL) sevParts.push(`${sevCounts.CRITICAL} CRITICAL`);
      if (sevCounts.WARNING) sevParts.push(`${sevCounts.WARNING} WARNING`);
      if (sevCounts.INFO) sevParts.push(`${sevCounts.INFO} INFO`);
      console.log(`Health: ${issueCount} issue${issueCount !== 1 ? 's' : ''} \u2014 ${sevParts.join(', ')}`);
    }
    console.log();

    console.log('=== Cycles ===');
    if (formattedCycles.length) {
      for (let i = 0; i < formattedCycles.length; i++) {
        const cyc = formattedCycles[i];
        const names = cyc.symbols.map(s => s.name);
        const dirNote = `, ${cyc.directories} dir${cyc.directories !== 1 ? 's' : ''}`;
        console.log(`  [${cyc.severity}] cycle ${i + 1} (${cyc.size} symbols${dirNote}): ${names.slice(0, 10).join(', ')}`);
        if (names.length > 10) console.log(`    (+${names.length - 10} more)`);
        console.log(`    files: ${cyc.files.slice(0, 5).join(', ')}`);
      }
      if (breakSuggestions.length) {
        console.log('\n  Cycle break suggestions:');
        for (const bs of breakSuggestions) {
          console.log(`    Break: remove dependency ${bs.source_name} -> ${bs.target_name} (${bs.reason})`);
        }
      }
    } else {
      console.log('  (none)');
    }

    console.log('\n=== God Components (degree > 20) ===');
    if (godItems.length) {
      const godRows = godItems.map(g => [
        g.severity, g.name, abbrevKind(g.kind), String(g.degree),
        g.category === 'utility' ? 'util' : 'act', loc(g.file),
      ]);
      console.log(formatTable(['Sev', 'Name', 'Kind', 'Degree', 'Cat', 'File'], godRows, 20));
    } else {
      console.log('  (none)');
    }

    console.log('\n=== Bottlenecks (high betweenness) ===');
    if (bnItems.length) {
      const bnRows = bnItems.map(b => {
        const bwStr = b.betweenness >= 10 ? `${b.betweenness.toFixed(0)}` : `${b.betweenness.toFixed(1)}`;
        return [b.severity, b.name, abbrevKind(b.kind), bwStr, b.category === 'utility' ? 'util' : 'act', loc(b.file)];
      });
      console.log(formatTable(['Sev', 'Name', 'Kind', 'Betweenness', 'Cat', 'File'], bnRows, 15));
    } else {
      console.log('  (none)');
    }

    console.log(`\n=== Layer Violations (${violations.length}) ===`);
    if (violations.length) {
      const vRows = violations.slice(0, 20).map(v => {
        const src = vLookup.get(v.source) || {};
        const tgt = vLookup.get(v.target) || {};
        return [src.name || '?', `L${v.source_layer}`, tgt.name || '?', `L${v.target_layer}`];
      });
      console.log(formatTable(['Source', 'Layer', 'Target', 'Layer'], vRows, 20));
      if (violations.length > 20) console.log(`  (+${violations.length - 20} more)`);
    } else if (layerMap.size) {
      console.log('  (none)');
    } else {
      console.log('  (no layers detected)');
    }
  } finally {
    db.close();
  }
}
