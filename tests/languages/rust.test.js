import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasGrammar = false;
try { require('tree-sitter-rust'); hasGrammar = true; } catch {}

let parser, extractor;

describe.skipIf(!hasGrammar)('RustExtractor', () => {
  beforeAll(async () => {
    await initExtractors();
    const Language = require('tree-sitter-rust');
    parser = new Parser();
    parser.setLanguage(Language);
    extractor = getExtractor('rust');
  });

  function parse(source) {
    return [parser.parse(source), source];
  }

  it('extracts pub struct', () => {
    const source = `pub struct User {\n    pub name: String,\n    age: u32,\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'model.rs', extractor);
    const strct = symbols.find(s => s.name === 'User');
    expect(strct).toBeDefined();
    expect(strct.kind).toBe('struct');
    expect(strct.visibility).toBe('public');
  });

  it('extracts traits', () => {
    const source = `pub trait Display {\n    fn fmt(&self) -> String;\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'display.rs', extractor);
    const trait = symbols.find(s => s.name === 'Display');
    expect(trait).toBeDefined();
    expect(trait.kind).toBe('trait');
  });

  it('extracts enums', () => {
    const source = `pub enum Color {\n    Red,\n    Blue,\n    Green,\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'color.rs', extractor);
    const enumSym = symbols.find(s => s.name === 'Color');
    expect(enumSym).toBeDefined();
    expect(enumSym.kind).toBe('enum');
  });

  it('extracts functions', () => {
    const source = `pub fn calculate(a: i32, b: i32) -> i32 {\n    a + b\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'calc.rs', extractor);
    const fn = symbols.find(s => s.name === 'calculate');
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
    expect(fn.is_exported).toBe(true);
  });

  it('marks private functions', () => {
    const source = `fn helper() {}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'util.rs', extractor);
    const fn = symbols.find(s => s.name === 'helper');
    expect(fn).toBeDefined();
    expect(fn.visibility).toBe('private');
  });

  it('extracts use imports', () => {
    const source = `use std::collections::HashMap;\nuse std::io;\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'main.rs', extractor);
    expect(refs.some(r => r.kind === 'import')).toBe(true);
  });
});
