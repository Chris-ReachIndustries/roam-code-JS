import { describe, it, expect } from 'vitest';
import { fileHash } from '../../src/index/incremental.js';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('fileHash', () => {
  const testFile = join(tmpdir(), `roam-hash-test-${Date.now()}.txt`);

  it('returns consistent hash for same content', () => {
    writeFileSync(testFile, 'hello world');
    const hash1 = fileHash(testFile);
    const hash2 = fileHash(testFile);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    rmSync(testFile, { force: true });
  });

  it('returns different hash for different content', () => {
    writeFileSync(testFile, 'content A');
    const hash1 = fileHash(testFile);
    writeFileSync(testFile, 'content B');
    const hash2 = fileHash(testFile);
    expect(hash1).not.toBe(hash2);
    rmSync(testFile, { force: true });
  });

  it('throws for nonexistent file', () => {
    expect(() => fileHash('/nonexistent/path')).toThrow();
  });
});
