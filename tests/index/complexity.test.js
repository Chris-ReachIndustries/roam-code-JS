import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasGrammar = false;
try { require('tree-sitter-python'); hasGrammar = true; } catch {}

let computeSymbolComplexity;
let parser;

describe.skipIf(!hasGrammar)('computeSymbolComplexity', () => {
  beforeAll(async () => {
    const mod = await import('../../src/index/complexity.js');
    computeSymbolComplexity = mod.computeSymbolComplexity;
    const Language = require('tree-sitter-python');
    parser = new Parser();
    parser.setLanguage(Language);
  });

  // computeSymbolComplexity(tree, source, lineStart, lineEnd)
  it('returns low complexity for simple function', () => {
    const source = `def simple(x):\n    return x + 1\n`;
    const tree = parser.parse(source);
    const metrics = computeSymbolComplexity(tree, source, 1, 2);
    expect(metrics.cognitive_complexity).toBeLessThan(5);
    expect(metrics.param_count).toBe(1);
    expect(metrics.return_count).toBeGreaterThanOrEqual(1);
  });

  it('returns higher complexity for nested conditionals', () => {
    const source = `def complex(x, y, z):\n    if x > 0:\n        if y > 0:\n            if z > 0:\n                return x + y + z\n        else:\n            return -1\n    return 0\n`;
    const tree = parser.parse(source);
    const metrics = computeSymbolComplexity(tree, source, 1, 8);
    expect(metrics.cognitive_complexity).toBeGreaterThan(3);
    expect(metrics.nesting_depth).toBeGreaterThanOrEqual(3);
    expect(metrics.param_count).toBe(3);
  });

  it('counts boolean operators', () => {
    const source = `def check(a, b, c):\n    if a and b or c:\n        return True\n    return False\n`;
    const tree = parser.parse(source);
    const metrics = computeSymbolComplexity(tree, source, 1, 4);
    expect(metrics.bool_op_count).toBeGreaterThanOrEqual(1);
  });
});
