import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasGrammar = false;
try { require('tree-sitter-go'); hasGrammar = true; } catch {}

let parser, extractor;

describe.skipIf(!hasGrammar)('GoExtractor', () => {
  beforeAll(async () => {
    await initExtractors();
    const Language = require('tree-sitter-go');
    parser = new Parser();
    parser.setLanguage(Language);
    extractor = getExtractor('go');
  });

  function parse(source) {
    return [parser.parse(source), source];
  }

  it('extracts exported function', () => {
    const source = `package main\n\nfunc Handle(w http.ResponseWriter, r *http.Request) {\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'handler.go', extractor);
    const fn = symbols.find(s => s.name === 'Handle');
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
    expect(fn.is_exported).toBe(true);
  });

  it('marks lowercase as private', () => {
    const source = `package main\n\nfunc helper() {}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'util.go', extractor);
    const fn = symbols.find(s => s.name === 'helper');
    expect(fn).toBeDefined();
    expect(fn.visibility).toBe('private');
    expect(fn.is_exported).toBe(false);
  });

  it('extracts structs with fields', () => {
    const source = `package main\n\ntype User struct {\n\tName string\n\tAge  int\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'model.go', extractor);
    const strct = symbols.find(s => s.name === 'User');
    expect(strct).toBeDefined();
    expect(strct.kind).toBe('struct');
  });

  it('extracts interfaces', () => {
    const source = `package main\n\ntype Reader interface {\n\tRead(p []byte) (n int, err error)\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'io.go', extractor);
    const iface = symbols.find(s => s.name === 'Reader');
    expect(iface).toBeDefined();
    expect(iface.kind).toBe('interface');
  });

  it('extracts constants', () => {
    const source = `package main\n\nconst MaxSize = 100\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'const.go', extractor);
    const c = symbols.find(s => s.name === 'MaxSize');
    expect(c).toBeDefined();
    expect(c.kind).toBe('constant');
  });

  it('extracts imports', () => {
    const source = `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'main.go', extractor);
    expect(refs.some(r => r.kind === 'import')).toBe(true);
  });
});
