import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasGrammar = false;
try { require('tree-sitter-java'); hasGrammar = true; } catch {}

let parser, extractor;

describe.skipIf(!hasGrammar)('JavaExtractor', () => {
  beforeAll(async () => {
    await initExtractors();
    const Language = require('tree-sitter-java');
    parser = new Parser();
    parser.setLanguage(Language);
    extractor = getExtractor('java');
  });

  function parse(source) {
    return [parser.parse(source), source];
  }

  it('extracts classes', () => {
    const source = `public class Calculator {\n  public int add(int a, int b) {\n    return a + b;\n  }\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'Calculator.java', extractor);
    const cls = symbols.find(s => s.name === 'Calculator');
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
    expect(cls.visibility).toBe('public');
  });

  it('extracts methods', () => {
    const source = `public class Calc {\n  public int add(int a, int b) {\n    return a + b;\n  }\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'Calc.java', extractor);
    const method = symbols.find(s => s.name === 'add');
    expect(method).toBeDefined();
    expect(method.kind).toBe('method');
  });

  it('extracts enums', () => {
    const source = `public enum Status {\n  ACTIVE,\n  INACTIVE,\n  PENDING\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'Status.java', extractor);
    const enumSym = symbols.find(s => s.name === 'Status');
    expect(enumSym).toBeDefined();
    expect(enumSym.kind).toBe('enum');
  });

  it('extracts annotations', () => {
    const source = `public class Service {\n  @Override\n  public String toString() { return ""; }\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'Service.java', extractor);
    const method = symbols.find(s => s.name === 'toString');
    expect(method).toBeDefined();
  });

  it('extracts imports', () => {
    const source = `import java.util.List;\nimport java.util.Map;\n\npublic class App {}\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'App.java', extractor);
    expect(refs.some(r => r.kind === 'import')).toBe(true);
  });

  it('extracts interfaces', () => {
    const source = `public interface Repository {\n  void save(Object entity);\n  Object find(int id);\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'Repository.java', extractor);
    const iface = symbols.find(s => s.name === 'Repository');
    expect(iface).toBeDefined();
    expect(iface.kind).toBe('interface');
  });
});
