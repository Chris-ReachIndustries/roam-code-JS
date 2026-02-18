/**
 * Protocol Buffer (.proto) extractor.
 * Regex-based parsing since no tree-sitter-proto grammar is available.
 * Handles proto2 and proto3 syntax.
 */

import { LanguageExtractor } from './base.js';

// Builtin scalar types (not references to other messages)
const SCALAR_TYPES = new Set([
  'double', 'float', 'int32', 'int64', 'uint32', 'uint64',
  'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64',
  'bool', 'string', 'bytes',
]);

export class ProtobufExtractor extends LanguageExtractor {
  get languageName() { return 'protobuf'; }
  get fileExtensions() { return ['.proto']; }

  extractSymbols(tree, source, filePath) {
    if (!source) return [];
    const symbols = [];
    const lines = source.split('\n');
    const scopeStack = []; // [{name, kind, startLine}]
    let braceDepth = 0;
    let scopeDepths = []; // braceDepth at which each scope was entered

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.replace(/\/\/.*$/, '').trim();
      if (!trimmed) continue;

      const lineNum = i + 1;

      // Track brace depth
      const opens = (trimmed.match(/\{/g) || []).length;
      const closes = (trimmed.match(/\}/g) || []).length;

      // Package declaration
      const pkgMatch = trimmed.match(/^package\s+([\w.]+)\s*;/);
      if (pkgMatch) {
        symbols.push(this.makeSymbol(pkgMatch[1], 'module', lineNum, lineNum, {
          signature: `package ${pkgMatch[1]}`,
          isExported: true,
        }));
      }

      // Syntax declaration (informational, not a symbol)
      // syntax = "proto3";

      // Option declarations (informational)
      const optMatch = trimmed.match(/^option\s+(\w+)\s*=\s*"?([^";\s]+)"?\s*;/);
      // Skip options - they're metadata, not symbols

      // Message declaration
      const msgMatch = trimmed.match(/^message\s+(\w+)\s*\{?/);
      if (msgMatch) {
        const name = msgMatch[1];
        const parent = scopeStack.length ? scopeStack[scopeStack.length - 1].name : null;
        const qualified = parent ? `${parent}.${name}` : name;

        symbols.push(this.makeSymbol(name, 'class', lineNum, lineNum, {
          qualifiedName: qualified,
          signature: `message ${name}`,
          visibility: 'public',
          isExported: true,
          parentName: parent,
        }));

        if (opens > closes) {
          scopeStack.push({ name: qualified, kind: 'message', startLine: lineNum });
          scopeDepths.push(braceDepth);
        }
      }

      // Enum declaration
      const enumMatch = trimmed.match(/^enum\s+(\w+)\s*\{?/);
      if (enumMatch && !msgMatch) {
        const name = enumMatch[1];
        const parent = scopeStack.length ? scopeStack[scopeStack.length - 1].name : null;
        const qualified = parent ? `${parent}.${name}` : name;

        symbols.push(this.makeSymbol(name, 'enum', lineNum, lineNum, {
          qualifiedName: qualified,
          signature: `enum ${name}`,
          visibility: 'public',
          isExported: true,
          parentName: parent,
        }));

        if (opens > closes) {
          scopeStack.push({ name: qualified, kind: 'enum', startLine: lineNum });
          scopeDepths.push(braceDepth);
        }
      }

      // Service declaration
      const svcMatch = trimmed.match(/^service\s+(\w+)\s*\{?/);
      if (svcMatch) {
        const name = svcMatch[1];
        symbols.push(this.makeSymbol(name, 'class', lineNum, lineNum, {
          qualifiedName: name,
          signature: `service ${name}`,
          visibility: 'public',
          isExported: true,
        }));

        if (opens > closes) {
          scopeStack.push({ name, kind: 'service', startLine: lineNum });
          scopeDepths.push(braceDepth);
        }
      }

      // RPC method (inside service)
      const rpcMatch = trimmed.match(
        /^rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w[\w.]*)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w[\w.]*)\s*\)/
      );
      if (rpcMatch) {
        const name = rpcMatch[1];
        const reqStream = rpcMatch[2] ? 'stream ' : '';
        const reqType = rpcMatch[3];
        const resStream = rpcMatch[4] ? 'stream ' : '';
        const resType = rpcMatch[5];
        const parent = scopeStack.length ? scopeStack[scopeStack.length - 1].name : null;
        const qualified = parent ? `${parent}.${name}` : name;

        symbols.push(this.makeSymbol(name, 'method', lineNum, lineNum, {
          qualifiedName: qualified,
          signature: `rpc ${name}(${reqStream}${reqType}) returns (${resStream}${resType})`,
          visibility: 'public',
          isExported: true,
          parentName: parent,
        }));
      }

      // Enum values
      if (scopeStack.length && scopeStack[scopeStack.length - 1].kind === 'enum') {
        const enumValMatch = trimmed.match(/^(\w+)\s*=\s*(-?\d+)/);
        if (enumValMatch && !trimmed.startsWith('option') && !trimmed.startsWith('reserved')) {
          const name = enumValMatch[1];
          const parent = scopeStack[scopeStack.length - 1].name;

          symbols.push(this.makeSymbol(name, 'constant', lineNum, lineNum, {
            qualifiedName: `${parent}.${name}`,
            signature: `${name} = ${enumValMatch[2]}`,
            visibility: 'public',
            isExported: true,
            parentName: parent,
          }));
        }
      }

      // Message fields
      if (scopeStack.length && scopeStack[scopeStack.length - 1].kind === 'message') {
        // Standard field: [repeated|optional|required] type name = number;
        const fieldMatch = trimmed.match(
          /^(repeated\s+|optional\s+|required\s+)?(map<[^>]+>|[\w.]+)\s+(\w+)\s*=\s*(\d+)/
        );
        if (fieldMatch && !trimmed.startsWith('option') && !trimmed.startsWith('reserved') &&
            !trimmed.startsWith('message') && !trimmed.startsWith('enum') &&
            !trimmed.startsWith('oneof') && !trimmed.startsWith('rpc')) {
          const modifier = (fieldMatch[1] || '').trim();
          const type = fieldMatch[2];
          const name = fieldMatch[3];
          const parent = scopeStack[scopeStack.length - 1].name;

          let sig = `${type} ${name}`;
          if (modifier) sig = `${modifier} ${sig}`;

          symbols.push(this.makeSymbol(name, 'field', lineNum, lineNum, {
            qualifiedName: `${parent}.${name}`,
            signature: sig,
            visibility: 'public',
            isExported: true,
            parentName: parent,
          }));
        }

        // Oneof group
        const oneofMatch = trimmed.match(/^oneof\s+(\w+)\s*\{?/);
        if (oneofMatch) {
          const name = oneofMatch[1];
          const parent = scopeStack[scopeStack.length - 1].name;

          symbols.push(this.makeSymbol(name, 'field', lineNum, lineNum, {
            qualifiedName: `${parent}.${name}`,
            signature: `oneof ${name}`,
            visibility: 'public',
            isExported: true,
            parentName: parent,
          }));

          if (opens > closes) {
            scopeStack.push({ name: `${parent}.${name}`, kind: 'oneof', startLine: lineNum });
            scopeDepths.push(braceDepth);
          }
        }
      }

      // Oneof fields
      if (scopeStack.length && scopeStack[scopeStack.length - 1].kind === 'oneof') {
        const fieldMatch = trimmed.match(/^([\w.]+)\s+(\w+)\s*=\s*(\d+)/);
        if (fieldMatch) {
          const type = fieldMatch[1];
          const name = fieldMatch[2];
          // Parent is the message, not the oneof
          const parent = scopeStack.length >= 2 ? scopeStack[scopeStack.length - 2].name : null;

          symbols.push(this.makeSymbol(name, 'field', lineNum, lineNum, {
            qualifiedName: parent ? `${parent}.${name}` : name,
            signature: `${type} ${name}`,
            visibility: 'public',
            isExported: true,
            parentName: parent,
          }));
        }
      }

      // Update brace depth and pop scope if needed
      braceDepth += opens - closes;
      while (scopeStack.length && scopeDepths.length && braceDepth <= scopeDepths[scopeDepths.length - 1]) {
        // Update end line of the scope symbol
        const scope = scopeStack.pop();
        scopeDepths.pop();
        // Find the symbol and update its line_end
        for (let j = symbols.length - 1; j >= 0; j--) {
          if (symbols[j].qualified_name === scope.name && symbols[j].line_start === scope.startLine) {
            symbols[j].line_end = lineNum;
            break;
          }
        }
      }
    }

    return symbols;
  }

  extractReferences(tree, source, filePath) {
    if (!source) return [];
    const refs = [];
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].replace(/\/\/.*$/, '').trim();
      if (!trimmed) continue;
      const lineNum = i + 1;

      // Import statements
      const importMatch = trimmed.match(/^import\s+(?:public\s+|weak\s+)?"([^"]+)"\s*;/);
      if (importMatch) {
        refs.push(this.makeReference(importMatch[1], 'import', lineNum, {
          importPath: importMatch[1],
        }));
        continue;
      }

      // RPC method type references
      const rpcMatch = trimmed.match(
        /^rpc\s+\w+\s*\(\s*(?:stream\s+)?(\w[\w.]*)\s*\)\s*returns\s*\(\s*(?:stream\s+)?(\w[\w.]*)\s*\)/
      );
      if (rpcMatch) {
        if (!SCALAR_TYPES.has(rpcMatch[1])) {
          refs.push(this.makeReference(rpcMatch[1], 'reference', lineNum));
        }
        if (!SCALAR_TYPES.has(rpcMatch[2])) {
          refs.push(this.makeReference(rpcMatch[2], 'reference', lineNum));
        }
        continue;
      }

      // Field type references (for non-scalar types)
      const fieldMatch = trimmed.match(
        /^(?:repeated\s+|optional\s+|required\s+)?(map<([^,]+),\s*([^>]+)>|[\w.]+)\s+\w+\s*=\s*\d+/
      );
      if (fieldMatch) {
        if (fieldMatch[2] && fieldMatch[3]) {
          // map<K, V> - check both key and value types
          const keyType = fieldMatch[2].trim();
          const valType = fieldMatch[3].trim();
          if (!SCALAR_TYPES.has(keyType)) {
            refs.push(this.makeReference(keyType, 'reference', lineNum));
          }
          if (!SCALAR_TYPES.has(valType)) {
            refs.push(this.makeReference(valType, 'reference', lineNum));
          }
        } else {
          const type = fieldMatch[1];
          if (!SCALAR_TYPES.has(type) && !type.startsWith('map<')) {
            refs.push(this.makeReference(type, 'reference', lineNum));
          }
        }
      }
    }

    return refs;
  }
}
