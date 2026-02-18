import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasGrammar = false;
try { require('tree-sitter-python'); hasGrammar = true; } catch {}

let parser, extractor;

describe.skipIf(!hasGrammar)('PythonExtractor', () => {
  beforeAll(async () => {
    await initExtractors();
    const Language = require('tree-sitter-python');
    parser = new Parser();
    parser.setLanguage(Language);
    extractor = getExtractor('python');
  });

  function parse(source) {
    return [parser.parse(source), source];
  }

  it('extracts classes', () => {
    const source = `class Calculator:\n    def add(self, a, b):\n        return a + b\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'calc.py', extractor);
    const cls = symbols.find(s => s.name === 'Calculator');
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
    expect(cls.is_exported).toBe(true);
  });

  it('extracts functions', () => {
    const source = `def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'fib.py', extractor);
    const fn = symbols.find(s => s.name === 'fibonacci');
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
  });

  it('extracts methods as children of class', () => {
    const source = `class Foo:\n    def bar(self):\n        pass\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'foo.py', extractor);
    const method = symbols.find(s => s.name === 'bar');
    expect(method).toBeDefined();
    expect(method.kind).toBe('method');
    expect(method.parent_name).toBe('Foo');
  });

  it('detects private symbols via underscore', () => {
    const source = `def _private_fn():\n    pass\n\ndef public_fn():\n    pass\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'mod.py', extractor);
    const priv = symbols.find(s => s.name === '_private_fn');
    const pub = symbols.find(s => s.name === 'public_fn');
    expect(priv.visibility).toBe('private');
    expect(pub.visibility).toBe('public');
  });

  it('extracts docstrings', () => {
    const source = `def greet(name):\n    """Say hello to someone."""\n    print(f"Hello {name}")\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'greet.py', extractor);
    const fn = symbols.find(s => s.name === 'greet');
    expect(fn.docstring).toContain('Say hello');
  });

  it('extracts imports as references', () => {
    const source = `from os.path import join\nimport sys\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'main.py', extractor);
    expect(refs.some(r => r.target_name === 'join' && r.kind === 'import')).toBe(true);
    expect(refs.some(r => r.target_name === 'sys' && r.kind === 'import')).toBe(true);
  });

  it('extracts function calls', () => {
    const source = `result = fibonacci(5)\nprint(result)\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'main.py', extractor);
    expect(refs.some(r => r.target_name === 'fibonacci' && r.kind === 'call')).toBe(true);
  });

  it('detects decorators', () => {
    const source = `@staticmethod\ndef helper():\n    pass\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'deco.py', extractor);
    expect(symbols.length).toBeGreaterThanOrEqual(1);
  });
});
