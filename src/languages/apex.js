/**
 * Apex symbol and reference extractor.
 * Extends JavaExtractor since Apex uses the Java tree-sitter grammar.
 */

import { JavaExtractor } from './java.js';

// Apex-specific annotations
const APEX_ANNOTATIONS = new Set([
  'AuraEnabled', 'Deprecated', 'Future', 'HttpDelete', 'HttpGet',
  'HttpPatch', 'HttpPost', 'HttpPut', 'InvocableMethod', 'InvocableVariable',
  'IsTest', 'JsonAccess', 'NamespaceAccessible', 'ReadOnly', 'RemoteAction',
  'RestResource', 'SuppressWarnings', 'TestSetup', 'TestVisible',
]);

// DML operation keywords
const DML_OPS = new Set(['insert', 'update', 'delete', 'upsert', 'merge', 'undelete']);

export class ApexExtractor extends JavaExtractor {
  get languageName() { return 'apex'; }
  get fileExtensions() { return ['.cls', '.trigger']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    this._pendingInherits = [];
    this._soqlRefs = [];

    if (!tree) return symbols;

    // Detect trigger files and handle specially
    const rootText = this.nodeText(tree.rootNode, source);
    const triggerMatch = rootText.match(
      /^\s*trigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]*)\)/
    );
    if (triggerMatch) {
      return this._extractTrigger(triggerMatch, tree, source, filePath);
    }

    this._walkSymbols(tree.rootNode, source, symbols, null);
    return symbols;
  }

  extractReferences(tree, source, filePath) {
    const refs = [];
    if (!tree) return refs;

    this._walkRefs(tree.rootNode, source, refs, null);
    refs.push(...(this._pendingInherits || []));
    this._pendingInherits = [];

    // Add SOQL references
    refs.push(...(this._soqlRefs || []));
    this._soqlRefs = [];

    // Scan for inline SOQL queries
    this._scanSOQL(source, refs);

    // Scan for DML statements
    this._scanDML(source, refs);

    return refs;
  }

  _getVisibility(node, source) {
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        const text = this.nodeText(child, source).toLowerCase();
        if (text.includes('private')) return 'private';
        if (text.includes('protected')) return 'protected';
        if (text.includes('global')) return 'public';
        if (text.includes('public')) return 'public';
      }
    }
    // Apex default visibility is private (unlike Java's package)
    return 'private';
  }

  _getApexModifiers(node, source) {
    const mods = [];
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        const text = this.nodeText(child, source).toLowerCase();
        if (text.includes('global')) mods.push('global');
        if (text.includes('webservice')) mods.push('webservice');
        if (text.includes('virtual')) mods.push('virtual');
        if (text.includes('abstract')) mods.push('abstract');
        if (text.includes('transient')) mods.push('transient');
        if (text.includes('with sharing')) mods.push('with sharing');
        if (text.includes('without sharing')) mods.push('without sharing');
        if (text.includes('inherited sharing')) mods.push('inherited sharing');
      }
    }
    return mods;
  }

  _getApexAnnotations(node, source) {
    const annotations = [];
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const sub of child.children) {
          if (sub.type === 'annotation' || sub.type === 'marker_annotation') {
            const text = this.nodeText(sub, source);
            annotations.push(text);
          }
        }
      }
    }
    return annotations;
  }

  _hasApexAnnotation(node, source, annotationName) {
    const annotations = this._getApexAnnotations(node, source);
    return annotations.some(a =>
      a.toLowerCase().includes(annotationName.toLowerCase())
    );
  }

  _isTestAnnotated(node, source) {
    return this._hasApexAnnotation(node, source, 'IsTest') ||
           this._hasApexAnnotation(node, source, 'TestSetup');
  }

  _extractClass(node, source, symbols, parentName, kind = 'class') {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._getVisibility(node, source);
    const annotations = this._getApexAnnotations(node, source);
    const apexMods = this._getApexModifiers(node, source);
    const qualified = parentName ? `${parentName}.${name}` : name;
    const isTest = this._isTestAnnotated(node, source);

    let sig = '';
    if (apexMods.length) sig += apexMods.join(' ') + ' ';
    sig += `${kind} ${name}`;

    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) sig += this.nodeText(typeParams, source);

    const superclass = node.childForFieldName('superclass');
    if (superclass) {
      sig += ` ${this.nodeText(superclass, source)}`;
      for (const child of superclass.children) {
        if (child.type === 'type_identifier') {
          this._pendingInherits.push(this.makeReference(
            this.nodeText(child, source), 'inherits',
            node.startPosition.row + 1, { sourceName: qualified }));
          break;
        }
      }
    }

    const interfaces = node.childForFieldName('interfaces');
    if (interfaces) {
      sig += ` ${this.nodeText(interfaces, source)}`;
      this._collectTypeRefs(interfaces, source, 'implements', node.startPosition.row + 1, qualified);
    }

    if (annotations.length) sig = annotations.join('\n') + '\n' + sig;

    const isExported = vis === 'public' ||
      apexMods.includes('global') ||
      apexMods.includes('webservice');

    symbols.push(this.makeSymbol(name, kind,
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: isTest ? false : isExported,
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) this._walkSymbols(body, source, symbols, qualified);
  }

  _extractMethod(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._getVisibility(node, source);
    const annotations = this._getApexAnnotations(node, source);
    const apexMods = this._getApexModifiers(node, source);
    const isTest = this._isTestAnnotated(node, source);
    const retType = node.childForFieldName('type');
    const params = node.childForFieldName('parameters');

    let sig = '';
    if (retType) sig += this.nodeText(retType, source) + ' ';
    sig += `${name}(${this.paramsText(params, source)})`;
    if (this._hasModifier(node, source, 'static')) sig = 'static ' + sig;
    if (apexMods.includes('virtual')) sig = 'virtual ' + sig;
    if (apexMods.includes('abstract')) sig = 'abstract ' + sig;
    if (annotations.length) sig = annotations.join('\n') + '\n' + sig;

    const isExported = vis === 'public' ||
      apexMods.includes('global') ||
      apexMods.includes('webservice');

    const qualified = parentName ? `${parentName}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'method',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: isTest ? false : isExported,
        parentName,
      }));
  }

  _extractField(node, source, symbols, parentName) {
    const vis = this._getVisibility(node, source);
    const typeNode = node.childForFieldName('type');
    const typeText = typeNode ? this.nodeText(typeNode, source) : '';
    const isStatic = this._hasModifier(node, source, 'static');
    const isFinal = this._hasModifier(node, source, 'final');
    const apexMods = this._getApexModifiers(node, source);
    const isTransient = apexMods.includes('transient');

    for (const child of node.children) {
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = this.nodeText(nameNode, source);
          const kind = (isStatic && isFinal) ? 'constant' : 'field';
          let sig = `${typeText} ${name}`;
          if (isStatic) sig = 'static ' + sig;
          if (isFinal) sig = 'final ' + sig;
          if (isTransient) sig = 'transient ' + sig;

          const isExported = vis === 'public' ||
            apexMods.includes('global') ||
            apexMods.includes('webservice');

          const qualified = parentName ? `${parentName}.${name}` : name;
          symbols.push(this.makeSymbol(name, kind,
            node.startPosition.row + 1, node.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              visibility: vis,
              isExported,
              parentName,
            }));
        }
      }
    }
  }

  _extractTrigger(match, tree, source, filePath) {
    const [, triggerName, objectName, events] = match;
    const symbols = [];
    const eventList = events.split(',').map(e => e.trim()).filter(Boolean);

    symbols.push(this.makeSymbol(triggerName, 'trigger',
      1, source.split('\n').length, {
        qualifiedName: `${objectName}.${triggerName}`,
        signature: `trigger ${triggerName} on ${objectName} (${eventList.join(', ')})`,
        visibility: 'public',
        isExported: true,
      }));

    // Also extract any methods defined inside the trigger body
    if (tree) {
      this._walkSymbols(tree.rootNode, source, symbols, triggerName);
    }

    return symbols;
  }

  _scanSOQL(source, refs) {
    // Match inline SOQL: [SELECT ... FROM ObjectName ...]
    const soqlRe = /\[\s*SELECT\s+.*?\s+FROM\s+(\w+)/gi;
    const lines = source.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      const lineRe = /\[\s*SELECT\s+.*?\s+FROM\s+(\w+)/gi;
      while ((match = lineRe.exec(line)) !== null) {
        refs.push(this.makeReference(match[1], 'soql_query', i + 1));
      }
      offset += line.length + 1;
    }
  }

  _scanDML(source, refs) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      for (const op of DML_OPS) {
        if (line.toLowerCase().startsWith(op + ' ')) {
          // Try to extract the type from "insert accountList" or "update new Account(...)"
          const rest = line.slice(op.length).trim();
          const typeMatch = rest.match(/^new\s+(\w+)/i) || rest.match(/^(\w+)/);
          if (typeMatch) {
            const targetName = typeMatch[1];
            // Skip if it looks like a variable (lowercase first char) and is common
            if (targetName[0] === targetName[0].toUpperCase()) {
              refs.push(this.makeReference(targetName, 'dml_' + op, i + 1));
            }
          }
        }
      }
    }
  }
}
