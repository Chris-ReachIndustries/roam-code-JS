/**
 * Aura component extractor.
 * Parses Aura markup (.cmp, .app, .evt, .intf, .design) using HTML tree-sitter grammar.
 */

import { LanguageExtractor } from './base.js';

// Aura expression pattern: {!v.attr}, {!c.method}, {!helper.fn}
const EXPR_RE = /\{!([^}]+)\}/g;

export class AuraExtractor extends LanguageExtractor {
  get languageName() { return 'aura'; }
  get fileExtensions() { return ['.cmp', '.app', '.evt', '.intf', '.design']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    if (!source) return symbols;

    // Determine component type from file extension and root tag
    const rootText = source.slice(0, 500).toLowerCase();
    let componentKind = 'class';
    let componentType = 'component';

    if (rootText.includes('<aura:interface')) {
      componentKind = 'interface';
      componentType = 'interface';
    } else if (rootText.includes('<aura:event')) {
      componentKind = 'class';
      componentType = 'event';
    } else if (rootText.includes('<aura:application')) {
      componentKind = 'class';
      componentType = 'application';
    }

    // Extract component name from file path
    const parts = filePath.replace(/\\/g, '/').split('/');
    const fileName = parts[parts.length - 1];
    const componentName = fileName.replace(/\.\w+$/, '');

    // Extract implements attribute
    const implMatch = source.match(/implements\s*=\s*"([^"]*)"/i);
    let sig = `${componentType} ${componentName}`;
    if (implMatch) sig += ` implements ${implMatch[1]}`;

    symbols.push(this.makeSymbol(componentName, componentKind,
      1, source.split('\n').length, {
        signature: sig,
        visibility: 'public',
        isExported: true,
      }));

    // Extract aura:attribute definitions
    this._extractAttributes(source, symbols, componentName);

    // Extract aura:registerEvent
    this._extractRegisteredEvents(source, symbols, componentName);

    // Extract design:attribute (for app builder exposed properties)
    this._extractDesignAttributes(source, symbols, componentName);

    // For event files, extract event attributes
    if (componentType === 'event') {
      this._extractEventAttributes(source, symbols, componentName);
    }

    return symbols;
  }

  extractReferences(tree, source, filePath) {
    const refs = [];

    // Extract component references (<c:Name>, <lightning:Name>, <ui:Name>)
    this._extractComponentRefs(source, refs);

    // Extract event handler references
    this._extractHandlerRefs(source, refs);

    // Extract expression bindings
    this._extractExpressionRefs(source, refs);

    // Extract implements references
    this._extractImplementsRefs(source, refs);

    return refs;
  }

  _extractAttributes(source, symbols, parentName) {
    const attrRe = /<aura:attribute\s+([^/>]*)\/?>/gi;
    const lines = source.split('\n');
    let match;
    while ((match = attrRe.exec(source)) !== null) {
      const attrs = match[1];
      const nameMatch = attrs.match(/name\s*=\s*"([^"]*)"/i);
      const typeMatch = attrs.match(/type\s*=\s*"([^"]*)"/i);
      const accessMatch = attrs.match(/access\s*=\s*"([^"]*)"/i);
      const defaultMatch = attrs.match(/default\s*=\s*"([^"]*)"/i);

      if (nameMatch) {
        const name = nameMatch[1];
        const type = typeMatch ? typeMatch[1] : 'Object';
        const access = accessMatch ? accessMatch[1].toLowerCase() : 'public';
        const line = source.slice(0, match.index).split('\n').length;

        symbols.push(this.makeSymbol(name, 'field', line, line, {
          qualifiedName: `${parentName}.${name}`,
          signature: `${type} ${name}`,
          visibility: access === 'private' ? 'private' : 'public',
          isExported: access !== 'private',
          parentName,
          defaultValue: defaultMatch ? defaultMatch[1] : null,
        }));
      }
    }
  }

  _extractRegisteredEvents(source, symbols, parentName) {
    const eventRe = /<aura:registerEvent\s+([^/>]*)\/?>/gi;
    let match;
    while ((match = eventRe.exec(source)) !== null) {
      const attrs = match[1];
      const nameMatch = attrs.match(/name\s*=\s*"([^"]*)"/i);
      const typeMatch = attrs.match(/type\s*=\s*"([^"]*)"/i);

      if (nameMatch) {
        const name = nameMatch[1];
        const type = typeMatch ? typeMatch[1] : '';
        const line = source.slice(0, match.index).split('\n').length;

        symbols.push(this.makeSymbol(name, 'field', line, line, {
          qualifiedName: `${parentName}.${name}`,
          signature: `event ${name} : ${type}`,
          visibility: 'public',
          isExported: true,
          parentName,
        }));
      }
    }
  }

  _extractDesignAttributes(source, symbols, parentName) {
    const designRe = /<design:attribute\s+([^/>]*)\/?>/gi;
    let match;
    while ((match = designRe.exec(source)) !== null) {
      const attrs = match[1];
      const nameMatch = attrs.match(/name\s*=\s*"([^"]*)"/i);
      if (nameMatch) {
        const name = nameMatch[1];
        const line = source.slice(0, match.index).split('\n').length;
        symbols.push(this.makeSymbol(name, 'field', line, line, {
          qualifiedName: `${parentName}.${name}`,
          signature: `design:attribute ${name}`,
          visibility: 'public',
          isExported: true,
          parentName,
        }));
      }
    }
  }

  _extractEventAttributes(source, symbols, parentName) {
    const attrRe = /<aura:attribute\s+([^/>]*)\/?>/gi;
    // Event attributes are already handled by _extractAttributes
    // but we could add extra event-specific extraction here if needed
  }

  _extractComponentRefs(source, refs) {
    // Match <c:ComponentName>, <lightning:button>, <ui:inputText>, etc.
    const compRe = /<(c|lightning|ui|ltng|aura|force|flowruntime):(\w+)/gi;
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      const lineRe = /<(c|lightning|ui|ltng|aura|force|flowruntime):(\w+)/gi;
      while ((match = lineRe.exec(lines[i])) !== null) {
        const ns = match[1];
        const name = match[2];
        // Skip aura framework tags
        if (ns === 'aura' && ['attribute', 'registerEvent', 'handler',
          'set', 'if', 'iteration', 'renderIf', 'component',
          'interface', 'event', 'application', 'dependency',
          'require'].includes(name)) continue;
        refs.push(this.makeReference(`${ns}:${name}`, 'reference', i + 1));
      }
    }
  }

  _extractHandlerRefs(source, refs) {
    // Match <aura:handler ... action="{!c.method}" event="c:EventName" />
    const handlerRe = /<aura:handler\s+([^/>]*)\/?>/gi;
    let match;
    while ((match = handlerRe.exec(source)) !== null) {
      const attrs = match[1];
      const line = source.slice(0, match.index).split('\n').length;

      // Extract event reference
      const eventMatch = attrs.match(/event\s*=\s*"([^"]*)"/i);
      if (eventMatch) {
        refs.push(this.makeReference(eventMatch[1], 'reference', line));
      }

      // Extract action reference
      const actionMatch = attrs.match(/action\s*=\s*"\{!c\.(\w+)\}"/i);
      if (actionMatch) {
        refs.push(this.makeReference(actionMatch[1], 'call', line));
      }
    }
  }

  _extractExpressionRefs(source, refs) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      const exprRe = /\{!([^}]+)\}/g;
      while ((match = exprRe.exec(lines[i])) !== null) {
        const expr = match[1].trim();

        // v.attributeName -> attribute reference
        const vMatch = expr.match(/^v\.(\w+)/);
        if (vMatch) {
          refs.push(this.makeReference(vMatch[1], 'reference', i + 1));
          continue;
        }

        // c.methodName -> controller method reference
        const cMatch = expr.match(/^c\.(\w+)/);
        if (cMatch) {
          refs.push(this.makeReference(cMatch[1], 'call', i + 1));
          continue;
        }

        // helper.methodName -> helper method reference
        const hMatch = expr.match(/^helper\.(\w+)/);
        if (hMatch) {
          refs.push(this.makeReference(hMatch[1], 'call', i + 1));
        }
      }
    }
  }

  _extractImplementsRefs(source, refs) {
    const implMatch = source.match(/implements\s*=\s*"([^"]*)"/i);
    if (implMatch) {
      const interfaces = implMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const iface of interfaces) {
        refs.push(this.makeReference(iface, 'implements', 1));
      }
    }
  }
}
