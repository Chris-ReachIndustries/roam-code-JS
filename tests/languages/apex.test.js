import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Apex uses Java grammar
let hasGrammar = false;
try { require('tree-sitter-java'); hasGrammar = true; } catch {}

let parser, extractor;

describe.skipIf(!hasGrammar)('ApexExtractor', () => {
  beforeAll(async () => {
    await initExtractors();
    const Language = require('tree-sitter-java');
    parser = new Parser();
    parser.setLanguage(Language);
    extractor = getExtractor('apex');
  });

  function parse(source) {
    return [parser.parse(source), source];
  }

  it('extracts class with Apex visibility', () => {
    const source = `public class AccountService {\n  public void processAccount(Account a) {}\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'AccountService.cls', extractor);
    const cls = symbols.find(s => s.name === 'AccountService');
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
  });

  it('extracts @AuraEnabled methods', () => {
    const source = `public class Controller {\n  @AuraEnabled\n  public static String getData() { return ""; }\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'Controller.cls', extractor);
    const method = symbols.find(s => s.name === 'getData');
    expect(method).toBeDefined();
  });

  it('marks @IsTest classes as non-exported', () => {
    const source = `@IsTest\npublic class AccountTest {\n  @IsTest\n  static void testCreate() {}\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'AccountTest.cls', extractor);
    const cls = symbols.find(s => s.name === 'AccountTest');
    expect(cls).toBeDefined();
    expect(cls.is_exported).toBe(false);
  });

  it('detects SOQL queries as references', () => {
    const source = `public class Svc {\n  public void run() {\n    List<Account> accs = [SELECT Id FROM Account];\n  }\n}\n`;
    const [tree, src] = parse(source);
    const refs = extractReferences(tree, src, 'Svc.cls', extractor);
    expect(refs.some(r => r.target_name === 'Account')).toBe(true);
  });

  it('extracts with sharing class', () => {
    const source = `public with sharing class SecureService {\n  public void secure() {}\n}\n`;
    const [tree, src] = parse(source);
    const symbols = extractSymbols(tree, src, 'SecureService.cls', extractor);
    expect(symbols.length).toBeGreaterThanOrEqual(1);
  });
});
