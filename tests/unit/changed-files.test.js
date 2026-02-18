import { describe, it, expect } from 'vitest';
import { getChangedFiles, isTestFile, isLowRiskFile } from '../../src/commands/changed-files.js';

describe('isTestFile', () => {
  it('detects test files', () => {
    expect(isTestFile('tests/unit/foo.test.js')).toBe(true);
    expect(isTestFile('test_calculator.py')).toBe(true);
    expect(isTestFile('spec/models/user_spec.rb')).toBe(true);
  });

  it('rejects non-test files', () => {
    expect(isTestFile('src/app.js')).toBe(false);
    expect(isTestFile('lib/utils.py')).toBe(false);
  });
});

describe('isLowRiskFile', () => {
  it('classifies docs as low-risk', () => {
    expect(isLowRiskFile('README.md')).toBe(true);
    expect(isLowRiskFile('docs/guide.md')).toBe(true);
  });

  it('classifies config as low-risk', () => {
    expect(isLowRiskFile('.github/workflows/ci.yml')).toBe(true);
    expect(isLowRiskFile('package.json')).toBe(true);
  });

  it('classifies source as not low-risk', () => {
    expect(isLowRiskFile('src/app.js')).toBe(false);
    expect(isLowRiskFile('lib/server.py')).toBe(false);
  });
});

describe('getChangedFiles', () => {
  it('returns empty array when git is unavailable', () => {
    const result = getChangedFiles('/tmp/nonexistent-dir-for-test-' + Date.now());
    expect(result).toEqual([]);
  });
});
