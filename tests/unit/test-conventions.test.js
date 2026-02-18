import { describe, it, expect } from 'vitest';
import {
  getConventions, getConventionForLanguage,
  findTestCandidates, findSourceCandidates,
} from '../../src/index/test-conventions.js';

describe('getConventions', () => {
  it('returns all registered conventions', () => {
    const convs = getConventions();
    expect(convs.length).toBeGreaterThanOrEqual(7);
    const names = convs.map(c => c.name);
    expect(names).toContain('python');
    expect(names).toContain('go');
    expect(names).toContain('javascript');
    expect(names).toContain('java-maven');
    expect(names).toContain('ruby');
    expect(names).toContain('apex');
    expect(names).toContain('csharp');
  });
});

describe('getConventionForLanguage', () => {
  it('returns correct convention for language', () => {
    expect(getConventionForLanguage('python').name).toBe('python');
    expect(getConventionForLanguage('go').name).toBe('go');
    expect(getConventionForLanguage('javascript').name).toBe('javascript');
    expect(getConventionForLanguage('typescript').name).toBe('javascript');
    expect(getConventionForLanguage('java').name).toBe('java-maven');
    expect(getConventionForLanguage('ruby').name).toBe('ruby');
    expect(getConventionForLanguage('apex').name).toBe('apex');
  });

  it('returns null for unknown language', () => {
    expect(getConventionForLanguage('brainfuck')).toBeNull();
  });
});

describe('Python conventions', () => {
  it('maps source to test paths', () => {
    const candidates = findTestCandidates('src/calculator.py', 'python');
    expect(candidates.some(c => c.includes('test_calculator'))).toBe(true);
  });

  it('maps test to source paths', () => {
    const candidates = findSourceCandidates('tests/test_calculator.py', 'python');
    expect(candidates.some(c => c.includes('calculator.py'))).toBe(true);
  });
});

describe('Go conventions', () => {
  it('maps source to test paths', () => {
    const candidates = findTestCandidates('pkg/handler.go', 'go');
    expect(candidates).toContain('pkg/handler_test.go');
  });

  it('maps test to source paths', () => {
    const candidates = findSourceCandidates('pkg/handler_test.go', 'go');
    expect(candidates).toContain('pkg/handler.go');
  });

  it('returns empty for test file as source', () => {
    expect(findTestCandidates('pkg/handler_test.go', 'go')).toEqual([]);
  });
});

describe('JavaScript conventions', () => {
  it('maps source to test paths', () => {
    const candidates = findTestCandidates('src/app.js', 'javascript');
    expect(candidates.some(c => c.includes('app.test.js'))).toBe(true);
    expect(candidates.some(c => c.includes('app.spec.js'))).toBe(true);
  });

  it('maps test to source paths', () => {
    const candidates = findSourceCandidates('src/app.test.js', 'javascript');
    expect(candidates.some(c => c.includes('app.js'))).toBe(true);
  });

  it('works for TypeScript too', () => {
    const candidates = findTestCandidates('src/utils.ts', 'typescript');
    expect(candidates.some(c => c.includes('utils.test.ts'))).toBe(true);
  });
});

describe('Java Maven conventions', () => {
  it('maps source to test paths', () => {
    const candidates = findTestCandidates('src/main/java/com/App.java', 'java');
    expect(candidates.some(c => c.includes('AppTest.java'))).toBe(true);
  });

  it('maps test to source paths', () => {
    const candidates = findSourceCandidates('src/test/java/com/AppTest.java', 'java');
    expect(candidates.some(c => c.includes('App.java'))).toBe(true);
  });
});

describe('Ruby conventions', () => {
  it('maps source to test paths', () => {
    const candidates = findTestCandidates('lib/models/user.rb', 'ruby');
    expect(candidates.some(c => c.includes('user_spec.rb'))).toBe(true);
  });

  it('maps test to source paths', () => {
    const candidates = findSourceCandidates('spec/models/user_spec.rb', 'ruby');
    expect(candidates.some(c => c.includes('user.rb'))).toBe(true);
  });
});

describe('Apex conventions', () => {
  it('maps source to test paths', () => {
    const candidates = findTestCandidates('classes/AccountService.cls', 'apex');
    expect(candidates.some(c => c.includes('AccountServiceTest.cls'))).toBe(true);
  });

  it('maps test to source paths', () => {
    const candidates = findSourceCandidates('classes/AccountServiceTest.cls', 'apex');
    expect(candidates.some(c => c.includes('AccountService.cls'))).toBe(true);
  });
});
