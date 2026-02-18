import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasGrammar = false;
try { require('tree-sitter-javascript'); hasGrammar = true; } catch {}

let parser, extractor;

describe.skipIf(!hasGrammar)('JavaScriptExtractor', () => {
  beforeAll(async () => {
    await initExtractors();
    const Language = require('tree-sitter-javascript');
    parser = new Parser();
    parser.setLanguage(Language);
    extractor = getExtractor('javascript');
  });

  function parse(source) {
    return [parser.parse(source), source];
  }

  it('extracts exported class', () => {
    const source = `export class App {\n  constructor() {}\n  run() { return 42; }\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'app.js', extractor);
    const cls = symbols.find(s => s.name === 'App');
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
    expect(cls.is_exported).toBe(true);
  });

  it('extracts exported functions', () => {
    const source = `export function main() {\n  return new App();\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'main.js', extractor);
    const fn = symbols.find(s => s.name === 'main');
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
    expect(fn.is_exported).toBe(true);
  });

  it('extracts arrow functions in const', () => {
    const source = `export const greet = (name) => {\n  console.log(name);\n};\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'util.js', extractor);
    const fn = symbols.find(s => s.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn.is_exported).toBe(true);
  });

  it('extracts ESM imports', () => {
    const source = `import { Logger } from "./utils/logger.js";\nimport fs from "fs";\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'app.js', extractor);
    expect(refs.some(r => r.target_name === 'Logger' && r.kind === 'import')).toBe(true);
  });

  it('extracts class methods', () => {
    const source = `class Foo {\n  bar() { return 1; }\n  static baz() {}\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'foo.js', extractor);
    const bar = symbols.find(s => s.name === 'bar');
    expect(bar).toBeDefined();
    expect(bar.kind).toBe('method');
    expect(bar.parent_name).toBe('Foo');
  });

  it('extracts function calls as references', () => {
    const source = `const result = calculate(1, 2);\nlog(result);\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'main.js', extractor);
    expect(refs.some(r => r.target_name === 'calculate' && r.kind === 'call')).toBe(true);
  });

  it('extracts constants', () => {
    const source = `export const MAX_SIZE = 100;\nexport const NAME = "app";\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'constants.js', extractor);
    const maxSize = symbols.find(s => s.name === 'MAX_SIZE');
    expect(maxSize).toBeDefined();
  });
});
