import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasGrammar = false;
try { require('tree-sitter-typescript/typescript'); hasGrammar = true; } catch {}

let parser, extractor;

describe.skipIf(!hasGrammar)('TypeScriptExtractor', () => {
  beforeAll(async () => {
    await initExtractors();
    const Language = require('tree-sitter-typescript/typescript');
    parser = new Parser();
    parser.setLanguage(Language);
    extractor = getExtractor('typescript');
  });

  function parse(source) {
    return [parser.parse(source), source];
  }

  it('extracts interfaces', () => {
    const source = `export interface AppConfig {\n  port: number;\n  host: string;\n  debug: boolean;\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'config.ts', extractor);
    const iface = symbols.find(s => s.name === 'AppConfig');
    expect(iface).toBeDefined();
    expect(iface.kind).toBe('interface');
    expect(iface.is_exported).toBe(true);
  });

  it('extracts type aliases', () => {
    const source = `export type Handler = (req: Request, res: Response) => void;\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'types.ts', extractor);
    const typeAlias = symbols.find(s => s.name === 'Handler');
    expect(typeAlias).toBeDefined();
    expect(typeAlias.kind).toBe('type_alias');
  });

  it('extracts enums', () => {
    const source = `export enum Color {\n  Red = "RED",\n  Blue = "BLUE",\n  Green = "GREEN"\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'enums.ts', extractor);
    const enumSym = symbols.find(s => s.name === 'Color');
    expect(enumSym).toBeDefined();
    expect(enumSym.kind).toBe('enum');
  });

  it('extracts class with generics', () => {
    const source = `export class Store<T> {\n  private data: T[];\n  add(item: T): void {}\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'store.ts', extractor);
    const cls = symbols.find(s => s.name === 'Store');
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
  });

  it('extracts typed functions', () => {
    const source = `export function loadConfig(path: string): AppConfig {\n  return {} as AppConfig;\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'config.ts', extractor);
    const fn = symbols.find(s => s.name === 'loadConfig');
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
  });
});
