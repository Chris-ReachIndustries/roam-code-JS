/**
 * VisualForce page extractor.
 * Parses VisualForce pages (.page) using HTML tree-sitter grammar.
 */

import { LanguageExtractor } from './base.js';

export class VisualForceExtractor extends LanguageExtractor {
  get languageName() { return 'visualforce'; }
  get fileExtensions() { return ['.page']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    if (!source) return symbols;

    // Extract page name from file path
    const parts = filePath.replace(/\\/g, '/').split('/');
    const fileName = parts[parts.length - 1];
    const pageName = fileName.replace(/\.\w+$/, '');

    // Extract controller info from <apex:page> tag
    const pageMatch = source.match(/<apex:page\s+([^>]*?)>/i);
    let controller = null;
    let standardController = null;
    let extensions = [];

    if (pageMatch) {
      const attrs = pageMatch[1];
      const ctrlMatch = attrs.match(/controller\s*=\s*"([^"]*)"/i);
      const stdCtrlMatch = attrs.match(/standardController\s*=\s*"([^"]*)"/i);
      const extMatch = attrs.match(/extensions\s*=\s*"([^"]*)"/i);

      if (ctrlMatch) controller = ctrlMatch[1];
      if (stdCtrlMatch) standardController = stdCtrlMatch[1];
      if (extMatch) extensions = extMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    }

    let sig = `page ${pageName}`;
    if (controller) sig += ` controller=${controller}`;
    else if (standardController) sig += ` standardController=${standardController}`;
    if (extensions.length) sig += ` extensions=${extensions.join(',')}`;

    symbols.push(this.makeSymbol(pageName, 'class',
      1, source.split('\n').length, {
        signature: sig,
        visibility: 'public',
        isExported: true,
      }));

    return symbols;
  }

  extractReferences(tree, source, filePath) {
    const refs = [];

    // Extract controller references
    this._extractControllerRefs(source, refs);

    // Extract action method references
    this._extractActionRefs(source, refs);

    // Extract merge field references
    this._extractMergeFieldRefs(source, refs);

    // Extract custom component references
    this._extractComponentRefs(source, refs);

    // Extract include/composition references
    this._extractIncludeRefs(source, refs);

    return refs;
  }

  _extractControllerRefs(source, refs) {
    const pageMatch = source.match(/<apex:page\s+([^>]*?)>/i);
    if (!pageMatch) return;
    const attrs = pageMatch[1];

    const ctrlMatch = attrs.match(/controller\s*=\s*"([^"]*)"/i);
    if (ctrlMatch) {
      refs.push(this.makeReference(ctrlMatch[1], 'import', 1));
    }

    const stdCtrlMatch = attrs.match(/standardController\s*=\s*"([^"]*)"/i);
    if (stdCtrlMatch) {
      refs.push(this.makeReference(stdCtrlMatch[1], 'reference', 1));
    }

    const extMatch = attrs.match(/extensions\s*=\s*"([^"]*)"/i);
    if (extMatch) {
      const exts = extMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const ext of exts) {
        refs.push(this.makeReference(ext, 'import', 1));
      }
    }
  }

  _extractActionRefs(source, refs) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // action="{!methodName}" or action="{!controller.methodName}"
      const actionRe = /action\s*=\s*"\{!([^}]+)\}"/gi;
      let match;
      while ((match = actionRe.exec(lines[i])) !== null) {
        const expr = match[1].trim();
        const name = expr.includes('.') ? expr.split('.').pop() : expr;
        refs.push(this.makeReference(name, 'call', i + 1));
      }
    }
  }

  _extractMergeFieldRefs(source, refs) {
    const lines = source.split('\n');
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      // {!expr}, {!obj.field}, {!$ObjectType.Account.Fields.Name}
      const mergeRe = /\{!([^}]+)\}/g;
      let match;
      while ((match = mergeRe.exec(lines[i])) !== null) {
        const expr = match[1].trim();
        // Skip global variables ($CurrentPage, $User, etc.)
        if (expr.startsWith('$')) continue;
        // Skip NOT, AND, OR operators
        if (/^(NOT|AND|OR|IF|ISBLANK|ISNULL|LEN|TEXT|VALUE)\s*\(/i.test(expr)) continue;
        // Skip literals
        if (/^['"]/.test(expr) || /^\d/.test(expr) || expr === 'true' || expr === 'false' || expr === 'null') continue;

        // Extract the first identifier/dotted path
        const pathMatch = expr.match(/^([\w.]+)/);
        if (pathMatch) {
          const path = pathMatch[1];
          const key = `${path}:${i}`;
          if (!seen.has(key)) {
            seen.add(key);
            const name = path.includes('.') ? path.split('.')[0] : path;
            refs.push(this.makeReference(name, 'reference', i + 1));
          }
        }
      }
    }
  }

  _extractComponentRefs(source, refs) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // <c:ComponentName> custom components
      const compRe = /<c:(\w+)/gi;
      let match;
      while ((match = compRe.exec(lines[i])) !== null) {
        refs.push(this.makeReference(match[1], 'reference', i + 1));
      }
    }
  }

  _extractIncludeRefs(source, refs) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // <apex:include pageName="OtherPage"/>
      const includeRe = /<apex:include\s+[^>]*pageName\s*=\s*"([^"]*)"/gi;
      let match;
      while ((match = includeRe.exec(lines[i])) !== null) {
        refs.push(this.makeReference(match[1], 'import', i + 1));
      }

      // <apex:composition template="TemplatePage">
      const compRe = /<apex:composition\s+[^>]*template\s*=\s*"([^"]*)"/gi;
      while ((match = compRe.exec(lines[i])) !== null) {
        refs.push(this.makeReference(match[1], 'import', i + 1));
      }
    }
  }
}
