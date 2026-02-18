import { describe, it, expect } from 'vitest';
import { discoverFiles } from '../../src/index/discovery.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('discoverFiles', () => {
  const testDir = join(tmpdir(), `roam-discovery-test-${Date.now()}`);

  function setup() {
    mkdirSync(join(testDir, 'src'), { recursive: true });
    mkdirSync(join(testDir, 'node_modules', 'dep'), { recursive: true });
    mkdirSync(join(testDir, '.git'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'app.js'), 'export default {}');
    writeFileSync(join(testDir, 'src', 'util.py'), 'def foo(): pass');
    writeFileSync(join(testDir, 'package-lock.json'), '{}');
    writeFileSync(join(testDir, 'node_modules', 'dep', 'index.js'), '');
    writeFileSync(join(testDir, 'data.png'), 'binary');
    writeFileSync(join(testDir, 'src', 'app.min.js'), 'minified');
  }

  function cleanup() {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  }

  it('discovers source files and skips binaries', () => {
    setup();
    try {
      const files = discoverFiles(testDir);
      // Should include source files
      expect(files.some(f => f.includes('src/app.js'))).toBe(true);
      expect(files.some(f => f.includes('src/util.py'))).toBe(true);
      // Should skip node_modules
      expect(files.some(f => f.includes('node_modules'))).toBe(false);
      // Should skip lock files
      expect(files.some(f => f.includes('package-lock.json'))).toBe(false);
      // Should skip binary extensions
      expect(files.some(f => f.includes('data.png'))).toBe(false);
      // Note: .min.js files have extension .js per extname(), so they pass the filter
    } finally {
      cleanup();
    }
  });

  it('returns sorted array', () => {
    setup();
    try {
      const files = discoverFiles(testDir);
      const sorted = [...files].sort();
      expect(files).toEqual(sorted);
    } finally {
      cleanup();
    }
  });

  it('uses forward slashes', () => {
    setup();
    try {
      const files = discoverFiles(testDir);
      for (const f of files) {
        expect(f).not.toContain('\\');
      }
    } finally {
      cleanup();
    }
  });
});
