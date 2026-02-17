/**
 * Quality gate presets — framework-specific thresholds for fitness evaluation.
 */

const DEFAULT_GATES = {
  max_complexity_avg: 25,
  max_complexity_max: 75,
  max_dead_pct: 15,
  min_test_ratio: 0.1,
  max_cycle_count: 5,
  max_coupling_density: 0.3,
  max_god_components: 3,
  max_tangle_ratio: 10,
};

/**
 * Named presets with overrides on top of DEFAULT_GATES.
 */
export const PRESETS = {
  default: {
    ...DEFAULT_GATES,
    description: 'Default quality gates for general projects',
  },
  strict: {
    ...DEFAULT_GATES,
    max_complexity_avg: 15,
    max_complexity_max: 40,
    max_dead_pct: 5,
    min_test_ratio: 0.3,
    max_cycle_count: 0,
    max_coupling_density: 0.15,
    max_god_components: 0,
    max_tangle_ratio: 3,
    description: 'Strict quality gates for high-reliability projects',
  },
  python: {
    ...DEFAULT_GATES,
    max_complexity_avg: 20,
    max_dead_pct: 12,
    min_test_ratio: 0.15,
    description: 'Python project quality gates',
  },
  javascript: {
    ...DEFAULT_GATES,
    max_complexity_avg: 22,
    max_dead_pct: 18,
    min_test_ratio: 0.08,
    max_coupling_density: 0.35,
    description: 'JavaScript/TypeScript project quality gates',
  },
  go: {
    ...DEFAULT_GATES,
    max_complexity_avg: 15,
    max_complexity_max: 50,
    max_dead_pct: 8,
    min_test_ratio: 0.2,
    max_cycle_count: 2,
    description: 'Go project quality gates',
  },
  java: {
    ...DEFAULT_GATES,
    max_complexity_avg: 20,
    max_complexity_max: 60,
    max_dead_pct: 20,
    min_test_ratio: 0.15,
    max_coupling_density: 0.25,
    description: 'Java project quality gates',
  },
  rust: {
    ...DEFAULT_GATES,
    max_complexity_avg: 18,
    max_complexity_max: 50,
    max_dead_pct: 5,
    min_test_ratio: 0.2,
    max_cycle_count: 1,
    max_tangle_ratio: 2,
    description: 'Rust project quality gates',
  },
};

/**
 * Get a preset by name, falling back to default.
 * @param {string} name
 * @returns {object}
 */
export function getPreset(name) {
  const preset = PRESETS[name || 'default'];
  if (!preset) {
    console.error(`Unknown preset '${name}', using default.`);
    return { ...PRESETS.default };
  }
  return { ...preset };
}

/**
 * List available preset names.
 * @returns {string[]}
 */
export function listPresets() {
  return Object.keys(PRESETS);
}

/**
 * Evaluate metrics against a quality gate preset.
 * @param {object} metrics — actual project metrics
 * @param {string|object} preset — preset name or preset object
 * @returns {{passed: boolean, checks: Array<{name: string, pass: boolean, actual: number, threshold: number, op: string}>}}
 */
export function evaluateGates(metrics, preset) {
  const gates = typeof preset === 'string' ? getPreset(preset) : { ...PRESETS.default, ...preset };

  const checks = [];

  const check = (name, actual, threshold, op = '<=') => {
    let pass;
    if (op === '<=') pass = actual <= threshold;
    else if (op === '>=') pass = actual >= threshold;
    else pass = actual === threshold;
    checks.push({ name, pass, actual: Math.round(actual * 100) / 100, threshold, op });
  };

  if (metrics.avg_complexity != null) check('avg_complexity', metrics.avg_complexity, gates.max_complexity_avg);
  if (metrics.max_complexity != null) check('max_complexity', metrics.max_complexity, gates.max_complexity_max);
  if (metrics.dead_pct != null) check('dead_code_pct', metrics.dead_pct, gates.max_dead_pct);
  if (metrics.test_ratio != null) check('test_ratio', metrics.test_ratio, gates.min_test_ratio, '>=');
  if (metrics.cycle_count != null) check('cycle_count', metrics.cycle_count, gates.max_cycle_count);
  if (metrics.coupling_density != null) check('coupling_density', metrics.coupling_density, gates.max_coupling_density);
  if (metrics.god_components != null) check('god_components', metrics.god_components, gates.max_god_components);
  if (metrics.tangle_ratio != null) check('tangle_ratio', metrics.tangle_ratio, gates.max_tangle_ratio);

  const passed = checks.every(c => c.pass);
  return { passed, checks };
}
