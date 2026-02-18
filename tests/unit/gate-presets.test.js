import { describe, it, expect } from 'vitest';
import { PRESETS, getPreset, listPresets, evaluateGates } from '../../src/analysis/gate-presets.js';

describe('PRESETS', () => {
  it('has expected preset keys', () => {
    expect(Object.keys(PRESETS)).toContain('default');
    expect(Object.keys(PRESETS)).toContain('strict');
    expect(Object.keys(PRESETS)).toContain('python');
    expect(Object.keys(PRESETS)).toContain('javascript');
    expect(Object.keys(PRESETS)).toContain('go');
    expect(Object.keys(PRESETS)).toContain('java');
    expect(Object.keys(PRESETS)).toContain('rust');
  });

  it('strict is stricter than default', () => {
    expect(PRESETS.strict.max_complexity_avg).toBeLessThan(PRESETS.default.max_complexity_avg);
    expect(PRESETS.strict.max_dead_pct).toBeLessThan(PRESETS.default.max_dead_pct);
    expect(PRESETS.strict.min_test_ratio).toBeGreaterThan(PRESETS.default.min_test_ratio);
  });
});

describe('getPreset', () => {
  it('returns correct preset by name', () => {
    const p = getPreset('strict');
    expect(p.max_complexity_avg).toBe(15);
    expect(p.description).toContain('Strict');
  });

  it('returns default for null/undefined', () => {
    const p = getPreset(null);
    expect(p.description).toContain('Default');
  });

  it('falls back to default for unknown preset', () => {
    const p = getPreset('nonexistent');
    expect(p.description).toContain('Default');
  });
});

describe('listPresets', () => {
  it('returns all preset names', () => {
    const names = listPresets();
    expect(names).toContain('default');
    expect(names).toContain('strict');
    expect(names.length).toBeGreaterThanOrEqual(7);
  });
});

describe('evaluateGates', () => {
  it('passes when all metrics are within thresholds', () => {
    const metrics = {
      avg_complexity: 10,
      max_complexity: 30,
      dead_pct: 5,
      test_ratio: 0.2,
      cycle_count: 2,
      coupling_density: 0.1,
      god_components: 1,
      tangle_ratio: 3,
    };
    const { passed, checks } = evaluateGates(metrics, 'default');
    expect(passed).toBe(true);
    expect(checks.every(c => c.pass)).toBe(true);
  });

  it('fails when metrics exceed thresholds', () => {
    const metrics = {
      avg_complexity: 50, // exceeds default threshold of 25
      dead_pct: 30,       // exceeds default threshold of 15
      test_ratio: 0.01,   // below minimum of 0.1
    };
    const { passed, checks } = evaluateGates(metrics, 'default');
    expect(passed).toBe(false);
    expect(checks.filter(c => !c.pass).length).toBeGreaterThanOrEqual(3);
  });

  it('uses correct comparison operators', () => {
    const metrics = { test_ratio: 0.05 }; // Below min_test_ratio of 0.1
    const { checks } = evaluateGates(metrics, 'default');
    const testCheck = checks.find(c => c.name === 'test_ratio');
    expect(testCheck.op).toBe('>=');
    expect(testCheck.pass).toBe(false);
  });

  it('accepts preset object directly', () => {
    const metrics = { avg_complexity: 30 };
    const { passed } = evaluateGates(metrics, { max_complexity_avg: 50 });
    expect(passed).toBe(true);
  });

  it('skips metrics that are null', () => {
    const metrics = { avg_complexity: 10 };
    const { checks } = evaluateGates(metrics, 'default');
    expect(checks.length).toBe(1);
  });
});
