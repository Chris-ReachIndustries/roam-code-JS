/**
 * Pluggable test naming convention adapters.
 * Maps source files <-> expected test file paths and vice versa.
 */

import { basename, extname, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

class TestConvention {
  get name() { throw new Error('Not implemented'); }
  get languages() { throw new Error('Not implemented'); }
  sourceToTestPaths(sourcePath) { throw new Error('Not implemented'); }
  testToSourcePaths(testPath) { throw new Error('Not implemented'); }
  isTestFile(path) { throw new Error('Not implemented'); }
}

// ---------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------

class PythonConvention extends TestConvention {
  get name() { return 'python'; }
  get languages() { return new Set(['python']); }

  sourceToTestPaths(sourcePath) {
    const p = sourcePath.replace(/\\/g, '/');
    const base = basename(p);
    const name = base.replace(extname(base), '');
    const dir = dirname(p);
    const candidates = [];
    candidates.push(`tests/test_${name}.py`);
    candidates.push(dir !== '.' ? `${dir}/test_${name}.py` : `test_${name}.py`);
    candidates.push(dir !== '.' ? `${dir}/${name}_test.py` : `${name}_test.py`);
    if (dir !== '.') candidates.push(`tests/${dir}/test_${name}.py`);
    return candidates;
  }

  testToSourcePaths(testPath) {
    const p = testPath.replace(/\\/g, '/');
    const base = basename(p);
    const name = base.replace(extname(base), '');
    const dir = dirname(p);
    let srcName;
    if (name.startsWith('test_')) srcName = name.slice(5);
    else if (name.endsWith('_test')) srcName = name.slice(0, -5);
    else return [];
    const candidates = [`src/${srcName}.py`, `${srcName}.py`];
    if (dir !== '.' && dir !== 'tests') candidates.push(`${dir}/${srcName}.py`);
    if (dir.startsWith('tests/')) {
      const srcDir = dir.slice(6);
      candidates.push(`${srcDir}/${srcName}.py`);
      candidates.push(`src/${srcDir}/${srcName}.py`);
    }
    return candidates;
  }

  isTestFile(path) {
    const base = basename(path);
    return (base.startsWith('test_') && base.endsWith('.py')) ||
      base.endsWith('_test.py') || base === 'conftest.py';
  }
}

class GoConvention extends TestConvention {
  get name() { return 'go'; }
  get languages() { return new Set(['go']); }

  sourceToTestPaths(sourcePath) {
    const p = sourcePath.replace(/\\/g, '/');
    if (p.endsWith('_test.go')) return [];
    return [p.replace(/\.go$/, '_test.go')];
  }

  testToSourcePaths(testPath) {
    const p = testPath.replace(/\\/g, '/');
    if (!p.endsWith('_test.go')) return [];
    return [p.replace(/_test\.go$/, '.go')];
  }

  isTestFile(path) {
    return path.replace(/\\/g, '/').endsWith('_test.go');
  }
}

class JavaScriptConvention extends TestConvention {
  get name() { return 'javascript'; }
  get languages() { return new Set(['javascript', 'typescript']); }

  _testPattern = /^.*\.(test|spec)\.[jt]sx?$/;

  sourceToTestPaths(sourcePath) {
    const p = sourcePath.replace(/\\/g, '/');
    const base = basename(p);
    if (this._testPattern.test(base)) return [];
    const name = base.replace(extname(base), '');
    const ext = extname(base);
    const dir = dirname(p);
    const candidates = [];
    for (const suffix of ['.test', '.spec']) {
      const testName = `${name}${suffix}${ext}`;
      if (dir !== '.') {
        candidates.push(`${dir}/${testName}`);
        candidates.push(`${dir}/__tests__/${testName}`);
      } else {
        candidates.push(testName);
        candidates.push(`__tests__/${testName}`);
      }
    }
    return candidates;
  }

  testToSourcePaths(testPath) {
    const p = testPath.replace(/\\/g, '/');
    const base = basename(p);
    const m = base.match(/^(.*)\.(test|spec)(\.[jt]sx?)$/);
    if (!m) return [];
    const [, name, , ext] = m;
    const dir = dirname(p);
    const srcName = `${name}${ext}`;
    const candidates = [];
    if (dir.includes('__tests__')) {
      const parent = dir.replace(/__tests__\/?/, '').replace(/\/__tests__$/, '');
      candidates.push(parent ? `${parent}/${srcName}` : srcName);
    }
    if (dir !== '.') candidates.push(`${dir}/${srcName}`);
    candidates.push(`src/${srcName}`);
    return candidates;
  }

  isTestFile(path) {
    return this._testPattern.test(basename(path));
  }
}

class JavaMavenConvention extends TestConvention {
  get name() { return 'java-maven'; }
  get languages() { return new Set(['java']); }

  sourceToTestPaths(sourcePath) {
    const p = sourcePath.replace(/\\/g, '/');
    if (p.includes('src/test/')) return [];
    const name = basename(p).replace(extname(basename(p)), '');
    const testPath = p.replace('src/main/', 'src/test/').replace(extname(p), '');
    return [`${testPath}Test.java`, `${testPath}Tests.java`];
  }

  testToSourcePaths(testPath) {
    const p = testPath.replace(/\\/g, '/');
    if (!p.includes('src/test/')) return [];
    let base = basename(p).replace(extname(basename(p)), '');
    if (base.endsWith('Tests')) base = base.slice(0, -5);
    else if (base.endsWith('Test')) base = base.slice(0, -4);
    else return [];
    const srcPath = p.replace('src/test/', 'src/main/');
    return [`${dirname(srcPath)}/${base}.java`];
  }

  isTestFile(path) {
    const base = basename(path);
    return (base.endsWith('Test.java') || base.endsWith('Tests.java')) &&
      path.replace(/\\/g, '/').includes('src/test/');
  }
}

class RubyConvention extends TestConvention {
  get name() { return 'ruby'; }
  get languages() { return new Set(['ruby']); }

  sourceToTestPaths(sourcePath) {
    const p = sourcePath.replace(/\\/g, '/');
    const name = basename(p).replace(extname(basename(p)), '');
    const dir = dirname(p);
    const specDir = dir.includes('lib/') ? dir.replace('lib/', 'spec/') : `spec/${dir}`;
    return [`${specDir}/${name}_spec.rb`];
  }

  testToSourcePaths(testPath) {
    const p = testPath.replace(/\\/g, '/');
    const base = basename(p);
    if (!base.endsWith('_spec.rb')) return [];
    const name = base.slice(0, -8);
    const dir = dirname(p);
    const srcDir = dir.includes('spec/') ? dir.replace('spec/', 'lib/') : dir;
    return [`${srcDir}/${name}.rb`];
  }

  isTestFile(path) {
    return path.replace(/\\/g, '/').endsWith('_spec.rb');
  }
}

class ApexConvention extends TestConvention {
  get name() { return 'apex'; }
  get languages() { return new Set(['apex']); }

  sourceToTestPaths(sourcePath) {
    const p = sourcePath.replace(/\\/g, '/');
    const name = basename(p).replace(extname(basename(p)), '');
    if (name.endsWith('Test') || name.endsWith('_Test')) return [];
    const dir = dirname(p);
    const prefix = dir !== '.' ? `${dir}/` : '';
    return [`${prefix}${name}Test.cls`, `${prefix}${name}_Test.cls`];
  }

  testToSourcePaths(testPath) {
    const p = testPath.replace(/\\/g, '/');
    const name = basename(p).replace(extname(basename(p)), '');
    const dir = dirname(p);
    const prefix = dir !== '.' ? `${dir}/` : '';
    if (name.endsWith('_Test')) return [`${prefix}${name.slice(0, -5)}.cls`];
    if (name.endsWith('Test')) return [`${prefix}${name.slice(0, -4)}.cls`];
    return [];
  }

  isTestFile(path) {
    const base = basename(path).replace(extname(basename(path)), '');
    return base.endsWith('Test') || base.endsWith('_Test');
  }
}

class CSharpConvention extends TestConvention {
  get name() { return 'csharp'; }
  get languages() { return new Set(['c_sharp', 'csharp', 'c#']); }

  sourceToTestPaths(sourcePath) {
    const p = sourcePath.replace(/\\/g, '/');
    const base = basename(p);
    const name = base.replace(extname(base), '');
    if (name.endsWith('Test') || name.endsWith('Tests')) return [];

    const dir = dirname(p);
    const parts = dir ? dir.split('/') : [];
    let projectName = null;
    let relativeSubdir = '';

    if (parts.includes('src')) {
      const srcIdx = parts.indexOf('src');
      if (srcIdx + 1 < parts.length) {
        projectName = parts[srcIdx + 1];
        if (srcIdx + 2 < parts.length) relativeSubdir = parts.slice(srcIdx + 2).join('/');
      }
    } else if (parts.length > 0) {
      projectName = parts[0];
      if (parts.length > 1) relativeSubdir = parts.slice(1).join('/');
    }

    const candidates = [];
    for (const testSuffix of ['Tests', 'Test']) {
      const testName = `${name}${testSuffix}.cs`;
      if (projectName) {
        for (const tps of ['.Tests', '.UnitTests', '.IntegrationTests']) {
          const tp = `${projectName}${tps}`;
          const sub = relativeSubdir ? `${relativeSubdir}/` : '';
          candidates.push(`tests/${tp}/${sub}${testName}`);
          candidates.push(`test/${tp}/${sub}${testName}`);
          candidates.push(`${tp}/${sub}${testName}`);
        }
      } else {
        const sub = dir && dir !== '.' ? `${dir}/` : '';
        candidates.push(`tests/${sub}${testName}`);
        candidates.push(`test/${sub}${testName}`);
      }
    }
    return candidates;
  }

  testToSourcePaths(testPath) {
    const p = testPath.replace(/\\/g, '/');
    const base = basename(p);
    const name = base.replace(extname(base), '');
    let srcName;
    if (name.endsWith('Tests')) srcName = name.slice(0, -5);
    else if (name.endsWith('Test')) srcName = name.slice(0, -4);
    else return [];

    const dir = dirname(p);
    const parts = dir ? dir.split('/') : [];
    let projectName = null;
    let relativeSubdir = '';

    for (let i = 0; i < parts.length; i++) {
      if (parts[i].endsWith('.Tests') || parts[i].endsWith('.UnitTests') || parts[i].endsWith('.IntegrationTests')) {
        if (parts[i].endsWith('.Tests')) projectName = parts[i].slice(0, -6);
        else if (parts[i].endsWith('.UnitTests')) projectName = parts[i].slice(0, -10);
        else projectName = parts[i].slice(0, -17);
        if (i + 1 < parts.length) relativeSubdir = parts.slice(i + 1).join('/');
        break;
      }
    }

    const candidates = [];
    const srcFile = `${srcName}.cs`;
    if (projectName) {
      const sub = relativeSubdir ? `${relativeSubdir}/` : '';
      candidates.push(`src/${projectName}/${sub}${srcFile}`);
      candidates.push(`${projectName}/${sub}${srcFile}`);
    } else {
      if (parts[0] === 'tests' || parts[0] === 'test') {
        const srcDir = parts.length > 1 ? parts.slice(1).join('/') : '';
        if (srcDir) {
          candidates.push(`src/${srcDir}/${srcFile}`);
          candidates.push(`${srcDir}/${srcFile}`);
        } else {
          candidates.push(`src/${srcFile}`);
        }
      } else if (dir && dir !== '.') {
        candidates.push(`${dir}/${srcFile}`);
      }
    }
    return candidates;
  }

  isTestFile(path) {
    const base = basename(path);
    const name = base.replace(extname(base), '');
    const hasTestSuffix = name.endsWith('Test') || name.endsWith('Tests');
    const p = path.replace(/\\/g, '/');
    const inTestDir = p.includes('/tests/') || p.includes('/test/') ||
      p.startsWith('tests/') || p.startsWith('test/');
    const inTestProject = p.includes('.Tests/') || p.includes('.UnitTests/') ||
      p.includes('.IntegrationTests/');
    return hasTestSuffix && (inTestDir || inTestProject);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _ALL_CONVENTIONS = [
  new PythonConvention(),
  new GoConvention(),
  new JavaScriptConvention(),
  new JavaMavenConvention(),
  new RubyConvention(),
  new ApexConvention(),
  new CSharpConvention(),
];

export function getConventions() {
  return [..._ALL_CONVENTIONS];
}

export function getConventionForLanguage(language) {
  for (const conv of _ALL_CONVENTIONS) {
    if (conv.languages.has(language)) return conv;
  }
  return null;
}

export function findTestCandidates(sourcePath, language = null) {
  if (language) {
    const conv = getConventionForLanguage(language);
    return conv ? conv.sourceToTestPaths(sourcePath) : [];
  }
  const candidates = [];
  for (const conv of _ALL_CONVENTIONS) candidates.push(...conv.sourceToTestPaths(sourcePath));
  return [...new Map(candidates.map(c => [c, c])).values()];
}

export function findSourceCandidates(testPath, language = null) {
  if (language) {
    const conv = getConventionForLanguage(language);
    return conv ? conv.testToSourcePaths(testPath) : [];
  }
  const candidates = [];
  for (const conv of _ALL_CONVENTIONS) candidates.push(...conv.testToSourcePaths(testPath));
  return [...new Map(candidates.map(c => [c, c])).values()];
}
