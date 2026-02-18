import { describe, it, expect } from 'vitest';
import {
  createSarifLog, addRun, makeRule, makeResult, makeLocation,
  deadCodeToSarif, complexityToSarif, conventionToSarif, healthToSarif,
} from '../../src/output/sarif.js';

describe('createSarifLog', () => {
  it('creates valid SARIF structure', () => {
    const log = createSarifLog();
    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toContain('sarif');
    expect(log.runs).toEqual([]);
    expect(log._toolName).toBe('roam-code');
  });

  it('accepts custom tool name', () => {
    const log = createSarifLog('my-tool', '1.0.0');
    expect(log._toolName).toBe('my-tool');
    expect(log._toolVersion).toBe('1.0.0');
  });
});

describe('makeRule', () => {
  it('creates a rule with all fields', () => {
    const rule = makeRule('TEST001', 'test-rule', 'A test rule', 'Full description', 'error');
    expect(rule.id).toBe('TEST001');
    expect(rule.name).toBe('test-rule');
    expect(rule.shortDescription.text).toBe('A test rule');
    expect(rule.fullDescription.text).toBe('Full description');
    expect(rule.defaultConfiguration.level).toBe('error');
    expect(rule.properties.tags).toContain('roam-code');
  });

  it('defaults to warning level', () => {
    const rule = makeRule('TEST002', 'warn-rule', 'A warning rule');
    expect(rule.defaultConfiguration.level).toBe('warning');
  });

  it('uses short description as full when not provided', () => {
    const rule = makeRule('TEST003', 'simple', 'Short desc');
    expect(rule.fullDescription.text).toBe('Short desc');
  });
});

describe('makeResult', () => {
  it('creates a result with locations', () => {
    const loc = makeLocation('src/app.js', 10, 20);
    const result = makeResult('TEST001', 'Found issue', [loc], 'warning');
    expect(result.ruleId).toBe('TEST001');
    expect(result.message.text).toBe('Found issue');
    expect(result.locations).toHaveLength(1);
    expect(result.level).toBe('warning');
  });

  it('omits optional fields when not provided', () => {
    const result = makeResult('TEST001', 'Simple');
    expect(result.level).toBeUndefined();
    expect(result.properties).toBeUndefined();
    expect(result.locations).toEqual([]);
  });
});

describe('makeLocation', () => {
  it('creates location with line range', () => {
    const loc = makeLocation('src/app.js', 10, 20);
    expect(loc.physicalLocation.artifactLocation.uri).toBe('src/app.js');
    expect(loc.physicalLocation.region.startLine).toBe(10);
    expect(loc.physicalLocation.region.endLine).toBe(20);
  });

  it('creates location without line numbers', () => {
    const loc = makeLocation('src/app.js');
    expect(loc.physicalLocation.artifactLocation.uri).toBe('src/app.js');
    expect(loc.physicalLocation.region).toBeUndefined();
  });

  it('normalizes backslashes', () => {
    const loc = makeLocation('src\\utils\\app.js');
    expect(loc.physicalLocation.artifactLocation.uri).toBe('src/utils/app.js');
  });
});

describe('addRun', () => {
  it('adds a run to the log', () => {
    const log = createSarifLog();
    const rules = [makeRule('R1', 'rule1', 'Test rule')];
    const results = [makeResult('R1', 'Found something')];
    addRun(log, 'test-run', rules, results);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe('roam-code');
    expect(log.runs[0].tool.driver.rules).toHaveLength(1);
    expect(log.runs[0].results).toHaveLength(1);
  });
});

describe('deadCodeToSarif', () => {
  it('converts dead code items', () => {
    const items = [
      { name: 'unused', kind: 'function', file_path: 'src/app.js', line_start: 10, line_end: 15, _confidence: 100 },
      { name: 'maybe_unused', kind: 'class', file_path: 'src/lib.js', line_start: 5, _confidence: 70 },
    ];
    const { rules, results } = deadCodeToSarif(items);
    expect(rules.length).toBe(4);
    expect(results.length).toBe(2);
    expect(results[0].ruleId).toBe('ROAM-DEAD-100');
    expect(results[1].ruleId).toBe('ROAM-DEAD-070');
  });
});

describe('complexityToSarif', () => {
  it('converts complexity items', () => {
    const items = [
      { name: 'complexFn', kind: 'function', file_path: 'src/app.js', line_start: 10, cognitive_complexity: 30 },
      { name: 'veryComplex', kind: 'function', file_path: 'src/lib.js', line_start: 5, cognitive_complexity: 60 },
    ];
    const { rules, results } = complexityToSarif(items);
    expect(rules.length).toBe(2);
    expect(results.length).toBe(2);
    expect(results[0].ruleId).toBe('ROAM-CC-HIGH');
    expect(results[1].ruleId).toBe('ROAM-CC-CRITICAL');
  });
});

describe('conventionToSarif', () => {
  it('converts convention violations', () => {
    const items = [
      { name: 'badName', file_path: 'src/app.js', line_start: 10, violation: 'naming issue', expected: 'camelCase' },
    ];
    const { rules, results } = conventionToSarif(items);
    expect(rules.length).toBe(3);
    expect(results.length).toBe(1);
    expect(results[0].level).toBe('note');
  });
});

describe('healthToSarif', () => {
  it('converts health issues', () => {
    const items = [
      { name: 'cycle1', kind: 'cycle', file: 'src/a.js', severity: 'WARNING', category: 'cycle', detail: 'A -> B -> A' },
      { name: 'god1', kind: 'god', file: 'src/big.js', severity: 'CRITICAL', category: 'god', detail: 'God component' },
    ];
    const { rules, results } = healthToSarif(items);
    expect(rules.length).toBe(4);
    expect(results.length).toBe(2);
    expect(results[0].ruleId).toBe('ROAM-HEALTH-CYCLE');
    expect(results[1].ruleId).toBe('ROAM-HEALTH-GOD');
    expect(results[1].level).toBe('error');
  });
});
