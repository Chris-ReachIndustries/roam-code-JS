/**
 * Salesforce metadata XML extractor.
 * Parses *-meta.xml files using HTML tree-sitter grammar.
 */

import { LanguageExtractor } from './base.js';

export class SfxmlExtractor extends LanguageExtractor {
  get languageName() { return 'sfxml'; }
  get fileExtensions() { return []; } // Detected by -meta.xml suffix, not extension

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    if (!source) return symbols;

    // Determine metadata type from file name
    const metaType = this._detectMetaType(filePath);
    const objName = this._extractObjectName(filePath);

    if (metaType === 'object') {
      this._extractObjectMetadata(source, symbols, objName);
    } else if (metaType === 'field') {
      this._extractFieldMetadata(source, symbols, objName);
    } else if (metaType === 'class' || metaType === 'trigger') {
      this._extractClassMetadata(source, symbols, objName, metaType);
    } else if (metaType === 'layout') {
      this._extractLayoutMetadata(source, symbols, objName);
    } else if (metaType === 'flow') {
      this._extractFlowMetadata(source, symbols, objName);
    } else if (metaType === 'permissionset' || metaType === 'profile') {
      this._extractPermissionMetadata(source, symbols, objName);
    } else {
      // Generic metadata: just create a single symbol for the file
      symbols.push(this.makeSymbol(objName, 'module',
        1, source.split('\n').length, {
          signature: `${metaType} ${objName}`,
          visibility: 'public',
          isExported: true,
        }));
    }

    return symbols;
  }

  extractReferences(tree, source, filePath) {
    const refs = [];
    if (!source) return refs;

    // Extract referenceTo fields (lookup/master-detail relationships)
    this._extractRelationshipRefs(source, refs);

    return refs;
  }

  _detectMetaType(filePath) {
    const p = filePath.replace(/\\/g, '/').toLowerCase();
    if (p.includes('/objects/') && p.endsWith('.object-meta.xml')) return 'object';
    if (p.includes('/fields/') && p.endsWith('.field-meta.xml')) return 'field';
    if (p.includes('/classes/') && p.endsWith('.cls-meta.xml')) return 'class';
    if (p.includes('/triggers/') && p.endsWith('.trigger-meta.xml')) return 'trigger';
    if (p.includes('/layouts/') && p.endsWith('.layout-meta.xml')) return 'layout';
    if (p.includes('/flows/') && p.endsWith('.flow-meta.xml')) return 'flow';
    if (p.includes('/permissionsets/')) return 'permissionset';
    if (p.includes('/profiles/')) return 'profile';
    return 'metadata';
  }

  _extractObjectName(filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const fileName = parts[parts.length - 1];
    // Remove -meta.xml suffix and any remaining extension
    return fileName.replace(/-meta\.xml$/i, '').replace(/\.\w+$/, '');
  }

  _extractObjectMetadata(source, symbols, objName) {
    symbols.push(this.makeSymbol(objName, 'class',
      1, source.split('\n').length, {
        signature: `CustomObject ${objName}`,
        visibility: 'public',
        isExported: true,
      }));

    // Extract fields
    const fieldRe = /<fields>\s*<fullName>([^<]+)<\/fullName>[\s\S]*?<\/fields>/gi;
    let match;
    while ((match = fieldRe.exec(source)) !== null) {
      const fieldName = match[1];
      const line = source.slice(0, match.index).split('\n').length;
      const typeMatch = match[0].match(/<type>([^<]+)<\/type>/i);
      const type = typeMatch ? typeMatch[1] : 'Text';

      symbols.push(this.makeSymbol(fieldName, 'field', line, line, {
        qualifiedName: `${objName}.${fieldName}`,
        signature: `${type} ${fieldName}`,
        visibility: 'public',
        isExported: true,
        parentName: objName,
      }));
    }

    // Extract validation rules
    const ruleRe = /<validationRules>\s*<fullName>([^<]+)<\/fullName>[\s\S]*?<\/validationRules>/gi;
    while ((match = ruleRe.exec(source)) !== null) {
      const ruleName = match[1];
      const line = source.slice(0, match.index).split('\n').length;

      symbols.push(this.makeSymbol(ruleName, 'function', line, line, {
        qualifiedName: `${objName}.${ruleName}`,
        signature: `validationRule ${ruleName}`,
        visibility: 'public',
        isExported: true,
        parentName: objName,
      }));
    }

    // Extract record types
    const rtRe = /<recordTypes>\s*<fullName>([^<]+)<\/fullName>[\s\S]*?<\/recordTypes>/gi;
    while ((match = rtRe.exec(source)) !== null) {
      const rtName = match[1];
      const line = source.slice(0, match.index).split('\n').length;

      symbols.push(this.makeSymbol(rtName, 'class', line, line, {
        qualifiedName: `${objName}.${rtName}`,
        signature: `recordType ${rtName}`,
        visibility: 'public',
        isExported: true,
        parentName: objName,
      }));
    }
  }

  _extractFieldMetadata(source, symbols, fieldName) {
    const typeMatch = source.match(/<type>([^<]+)<\/type>/i);
    const type = typeMatch ? typeMatch[1] : 'Text';

    symbols.push(this.makeSymbol(fieldName, 'field',
      1, source.split('\n').length, {
        signature: `${type} ${fieldName}`,
        visibility: 'public',
        isExported: true,
      }));
  }

  _extractClassMetadata(source, symbols, name, kind) {
    const apiMatch = source.match(/<apiVersion>([^<]+)<\/apiVersion>/i);
    const statusMatch = source.match(/<status>([^<]+)<\/status>/i);
    const api = apiMatch ? apiMatch[1] : '?';
    const status = statusMatch ? statusMatch[1] : 'Active';

    symbols.push(this.makeSymbol(name, 'module',
      1, source.split('\n').length, {
        signature: `${kind} ${name} (API ${api}, ${status})`,
        visibility: 'public',
        isExported: true,
      }));
  }

  _extractLayoutMetadata(source, symbols, layoutName) {
    symbols.push(this.makeSymbol(layoutName, 'class',
      1, source.split('\n').length, {
        signature: `layout ${layoutName}`,
        visibility: 'public',
        isExported: true,
      }));
  }

  _extractFlowMetadata(source, symbols, flowName) {
    symbols.push(this.makeSymbol(flowName, 'class',
      1, source.split('\n').length, {
        signature: `flow ${flowName}`,
        visibility: 'public',
        isExported: true,
      }));

    // Extract flow elements (decisions, assignments, screens, etc.)
    const elemRe = /<(decisions|assignments|screens|recordCreates|recordUpdates|recordDeletes|recordLookups|subflows|loops)>\s*<name>([^<]+)<\/name>/gi;
    let match;
    while ((match = elemRe.exec(source)) !== null) {
      const elemType = match[1];
      const elemName = match[2];
      const line = source.slice(0, match.index).split('\n').length;

      symbols.push(this.makeSymbol(elemName, 'function', line, line, {
        qualifiedName: `${flowName}.${elemName}`,
        signature: `${elemType} ${elemName}`,
        visibility: 'public',
        isExported: false,
        parentName: flowName,
      }));
    }
  }

  _extractPermissionMetadata(source, symbols, name) {
    symbols.push(this.makeSymbol(name, 'module',
      1, source.split('\n').length, {
        signature: `permissionSet ${name}`,
        visibility: 'public',
        isExported: true,
      }));
  }

  _extractRelationshipRefs(source, refs) {
    // <referenceTo>Account</referenceTo>
    const refRe = /<referenceTo>([^<]+)<\/referenceTo>/gi;
    let match;
    while ((match = refRe.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      refs.push(this.makeReference(match[1], 'reference', line));
    }
  }
}
