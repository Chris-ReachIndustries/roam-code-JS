import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';

let extractor;

describe('AuraExtractor (regex-based)', () => {
  beforeAll(async () => {
    await initExtractors();
    extractor = getExtractor('aura');
  });

  it('extracts component symbol', () => {
    const source = `<aura:component>\n  <aura:attribute name="title" type="String" />\n</aura:component>`;
    // For regex-only extractors: tree=null, source=source
    const symbols = extractor.extractSymbols(null, source, 'MyComponent.cmp');
    expect(symbols.length).toBeGreaterThanOrEqual(1);
    const comp = symbols.find(s => s.kind === 'component' || s.kind === 'class');
    expect(comp).toBeDefined();
  });

  it('extracts attributes as fields', () => {
    const source = `<aura:component>\n  <aura:attribute name="title" type="String" access="public" />\n  <aura:attribute name="count" type="Integer" />\n</aura:component>`;
    const symbols = extractor.extractSymbols(null, source, 'MyComponent.cmp');
    const attrs = symbols.filter(s => s.kind === 'field');
    expect(attrs.length).toBeGreaterThanOrEqual(2);
    const title = attrs.find(a => a.name === 'title');
    expect(title).toBeDefined();
  });

  it('extracts expression references', () => {
    const source = `<aura:component>\n  <div>{!v.title}</div>\n  <div>{!c.handleClick}</div>\n</aura:component>`;
    const refs = extractor.extractReferences(null, source, 'MyComponent.cmp');
    expect(refs.some(r => r.target_name === 'title')).toBe(true);
    expect(refs.some(r => r.target_name === 'handleClick')).toBe(true);
  });

  it('extracts component references', () => {
    const source = `<aura:component>\n  <lightning:button label="Click" />\n  <c:ChildComponent />\n</aura:component>`;
    const refs = extractor.extractReferences(null, source, 'Parent.cmp');
    expect(refs.some(r => r.target_name === 'lightning:button' || r.target_name === 'c:ChildComponent')).toBe(true);
  });

  it('extracts event handlers', () => {
    const source = `<aura:component>\n  <aura:handler name="init" value="{!this}" action="{!c.doInit}" />\n</aura:component>`;
    const refs = extractor.extractReferences(null, source, 'MyComponent.cmp');
    expect(refs.some(r => r.target_name === 'doInit')).toBe(true);
  });
});
