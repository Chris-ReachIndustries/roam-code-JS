import { describe, it, expect } from 'vitest';
import { detectLanguage, EXTENSION_MAP, REGEX_ONLY_LANGUAGES, GRAMMAR_ALIASES } from '../../src/index/parser.js';

describe('detectLanguage', () => {
  it('detects Python', () => {
    expect(detectLanguage('app.py')).toBe('python');
    expect(detectLanguage('types.pyi')).toBe(null); // .pyi not in EXTENSION_MAP by default
  });

  it('detects JavaScript variants', () => {
    expect(detectLanguage('app.js')).toBe('javascript');
    expect(detectLanguage('component.jsx')).toBe('javascript');
  });

  it('detects TypeScript variants', () => {
    expect(detectLanguage('app.ts')).toBe('typescript');
    expect(detectLanguage('component.tsx')).toBe('tsx');
  });

  it('detects Go', () => {
    expect(detectLanguage('main.go')).toBe('go');
  });

  it('detects Java', () => {
    expect(detectLanguage('App.java')).toBe('java');
  });

  it('detects Rust', () => {
    expect(detectLanguage('lib.rs')).toBe('rust');
  });

  it('detects C/C++', () => {
    expect(detectLanguage('main.c')).toBe('c');
    expect(detectLanguage('util.h')).toBe('c');
    expect(detectLanguage('app.cpp')).toBe('cpp');
  });

  it('detects Salesforce languages', () => {
    expect(detectLanguage('Service.cls')).toBe('apex');
    expect(detectLanguage('Handler.trigger')).toBe('apex');
    expect(detectLanguage('Page.page')).toBe('visualforce');
    expect(detectLanguage('Component.cmp')).toBe('aura');
    expect(detectLanguage('App.app')).toBe('aura');
  });

  it('detects Protobuf', () => {
    expect(detectLanguage('schema.proto')).toBe('protobuf');
  });

  it('detects Salesforce metadata XML', () => {
    expect(detectLanguage('Account.object-meta.xml')).toBe('sfxml');
  });

  it('detects Vue', () => {
    expect(detectLanguage('App.vue')).toBe('vue');
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('data.csv')).toBeNull();
    expect(detectLanguage('image.png')).toBeNull();
  });
});

describe('EXTENSION_MAP', () => {
  it('has all expected extensions', () => {
    expect(EXTENSION_MAP['.py']).toBe('python');
    expect(EXTENSION_MAP['.js']).toBe('javascript');
    expect(EXTENSION_MAP['.ts']).toBe('typescript');
    expect(EXTENSION_MAP['.go']).toBe('go');
    expect(EXTENSION_MAP['.java']).toBe('java');
    expect(EXTENSION_MAP['.rs']).toBe('rust');
    expect(EXTENSION_MAP['.proto']).toBe('protobuf');
  });
});

describe('REGEX_ONLY_LANGUAGES', () => {
  it('includes expected languages', () => {
    expect(REGEX_ONLY_LANGUAGES.has('protobuf')).toBe(true);
    expect(REGEX_ONLY_LANGUAGES.has('aura')).toBe(true);
    expect(REGEX_ONLY_LANGUAGES.has('visualforce')).toBe(true);
    expect(REGEX_ONLY_LANGUAGES.has('sfxml')).toBe(true);
    expect(REGEX_ONLY_LANGUAGES.has('foxpro')).toBe(true);
  });

  it('does not include tree-sitter languages', () => {
    expect(REGEX_ONLY_LANGUAGES.has('python')).toBe(false);
    expect(REGEX_ONLY_LANGUAGES.has('javascript')).toBe(false);
  });
});

describe('GRAMMAR_ALIASES', () => {
  it('maps apex to java', () => {
    expect(GRAMMAR_ALIASES.apex).toBe('java');
  });
});
