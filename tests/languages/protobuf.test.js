import { describe, it, expect, beforeAll } from 'vitest';
import { initExtractors, getExtractor } from '../../src/languages/registry.js';
import { extractSymbols, extractReferences } from '../../src/index/symbols.js';

let extractor;

describe('ProtobufExtractor (regex-based)', () => {
  beforeAll(async () => {
    await initExtractors();
    extractor = getExtractor('protobuf');
  });

  it('extracts messages', () => {
    const source = `syntax = "proto3";\n\nmessage User {\n  string name = 1;\n  int32 age = 2;\n}\n`;
    const symbols = extractor.extractSymbols(null, source, 'user.proto');
    const msg = symbols.find(s => s.name === 'User' && s.kind === 'class');
    expect(msg).toBeDefined();
  });

  it('extracts message fields', () => {
    const source = `syntax = "proto3";\n\nmessage User {\n  string name = 1;\n  int32 age = 2;\n}\n`;
    const symbols = extractor.extractSymbols(null, source, 'user.proto');
    const fields = symbols.filter(s => s.kind === 'field');
    expect(fields.length).toBeGreaterThanOrEqual(2);
    expect(fields.some(f => f.name === 'name')).toBe(true);
  });

  it('extracts services and RPCs', () => {
    const source = `syntax = "proto3";\n\nservice UserService {\n  rpc GetUser (GetUserRequest) returns (User);\n  rpc ListUsers (ListUsersRequest) returns (ListUsersResponse);\n}\n`;
    const symbols = extractor.extractSymbols(null, source, 'service.proto');
    const svc = symbols.find(s => s.name === 'UserService' && s.kind === 'class');
    expect(svc).toBeDefined();
    const rpcs = symbols.filter(s => s.kind === 'method');
    expect(rpcs.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts enums', () => {
    const source = `syntax = "proto3";\n\nenum Status {\n  UNKNOWN = 0;\n  ACTIVE = 1;\n  INACTIVE = 2;\n}\n`;
    const symbols = extractor.extractSymbols(null, source, 'status.proto');
    const enumSym = symbols.find(s => s.name === 'Status' && s.kind === 'enum');
    expect(enumSym).toBeDefined();
  });

  it('extracts nested messages', () => {
    const source = `syntax = "proto3";\n\nmessage Outer {\n  message Inner {\n    string value = 1;\n  }\n  Inner nested = 1;\n}\n`;
    const symbols = extractor.extractSymbols(null, source, 'nested.proto');
    const inner = symbols.find(s => s.name === 'Inner');
    expect(inner).toBeDefined();
    expect(inner.qualified_name).toContain('Outer');
  });

  it('extracts import references', () => {
    const source = `syntax = "proto3";\n\nimport "google/protobuf/timestamp.proto";\nimport "other.proto";\n`;
    const refs = extractor.extractReferences(null, source, 'main.proto');
    expect(refs.some(r => r.kind === 'import')).toBe(true);
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts field type references (non-scalar)', () => {
    const source = `syntax = "proto3";\n\nmessage Order {\n  User user = 1;\n  repeated Item items = 2;\n}\n`;
    const refs = extractor.extractReferences(null, source, 'order.proto');
    expect(refs.some(r => r.target_name === 'User' && r.kind === 'reference')).toBe(true);
    expect(refs.some(r => r.target_name === 'Item' && r.kind === 'reference')).toBe(true);
  });

  it('extracts package declaration', () => {
    const source = `syntax = "proto3";\n\npackage myapp.v1;\n\nmessage Foo {\n  string bar = 1;\n}\n`;
    const symbols = extractor.extractSymbols(null, source, 'foo.proto');
    const pkg = symbols.find(s => s.kind === 'module');
    expect(pkg).toBeDefined();
    expect(pkg.name).toBe('myapp.v1');
  });
});
