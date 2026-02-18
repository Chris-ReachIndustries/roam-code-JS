import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasGrammar = false;
try { require('tree-sitter-c'); hasGrammar = true; } catch {}

let parser, extractor;

describe.skipIf(!hasGrammar)('CExtractor', () => {
  beforeAll(async () => {
    await initExtractors();
    const Language = require('tree-sitter-c');
    parser = new Parser();
    parser.setLanguage(Language);
    extractor = getExtractor('c');
  });

  function parse(source) {
    return [parser.parse(source), source];
  }

  it('extracts functions', () => {
    const source = `int add(int a, int b) {\n    return a + b;\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'math.c', extractor);
    const fn = symbols.find(s => s.name === 'add');
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
  });

  it('extracts structs', () => {
    const source = `struct Point {\n    int x;\n    int y;\n};\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'geo.c', extractor);
    const strct = symbols.find(s => s.name === 'Point');
    expect(strct).toBeDefined();
    expect(strct.kind).toBe('struct');
  });

  it('extracts typedefs', () => {
    const source = `typedef struct {\n    int x;\n    int y;\n} Point;\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'types.c', extractor);
    expect(symbols.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts enums', () => {
    const source = `enum Color {\n    RED,\n    GREEN,\n    BLUE\n};\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'color.c', extractor);
    const enumSym = symbols.find(s => s.name === 'Color');
    expect(enumSym).toBeDefined();
    expect(enumSym.kind).toBe('enum');
  });

  it('extracts includes as references', () => {
    const source = `#include <stdio.h>\n#include "utils.h"\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'main.c', extractor);
    expect(refs.some(r => r.kind === 'import')).toBe(true);
  });
});
