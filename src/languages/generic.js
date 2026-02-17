/**
 * Generic fallback extractor for any tree-sitter grammar.
 * Used for Ruby, PHP, C#, Kotlin, Swift, Scala, etc.
 */

import { LanguageExtractor } from './base.js';

const _FUNCTION_TYPES = new Set([
  'function_definition', 'function_declaration', 'method_definition',
  'method_declaration', 'function_item', 'fn_item',
  'function', 'singleton_method', 'method',
]);

const _CLASS_TYPES = new Set([
  'class_definition', 'class_declaration', 'class_specifier',
  'class', 'module', 'struct_item', 'struct_specifier',
]);

const _INTERFACE_TYPES = new Set([
  'interface_declaration', 'trait_item', 'protocol_declaration',
  'trait_declaration',
]);

const _ENUM_TYPES = new Set([
  'enum_declaration', 'enum_specifier', 'enum_item',
]);

const _MODULE_TYPES = new Set([
  'module_definition', 'module_declaration', 'mod_item',
  'namespace_definition', 'package_declaration',
]);

const _CLASS_BODY_TYPES = new Set([
  'declaration_list', 'class_body', 'block', 'body',
  'field_declaration_list', 'enum_body',
]);

const _LITERAL_TYPES = new Set([
  'string', 'encapsed_string', 'string_content', 'string_literal',
  'interpreted_string_literal', 'raw_string_literal',
  'number', 'integer', 'float', 'integer_literal', 'float_literal',
  'decimal_integer_literal', 'decimal_floating_point_literal',
  'true', 'false', 'boolean', 'null', 'nil', 'none', 'None',
  'number_literal',
]);

export class GenericExtractor extends LanguageExtractor {
  constructor(language = 'unknown') {
    super();
    this._language = language;
  }

  get languageName() { return this._language; }
  get fileExtensions() { return []; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    this._walkSymbols(tree.rootNode, source, symbols, null, 0);
    return symbols;
  }

  extractReferences(tree, source, filePath) {
    const refs = [];
    this._walkRefs(tree.rootNode, source, refs, null);
    return refs;
  }

  getDocstring(node, source) {
    const prev = node.previousSibling;
    if (prev && ['comment', 'block_comment', 'line_comment'].includes(prev.type)) {
      let text = this.nodeText(prev, source).trim();
      for (const prefix of ['/**', '/*', '///', '//!', '//', '#']) {
        if (text.startsWith(prefix)) { text = text.slice(prefix.length); break; }
      }
      if (text.endsWith('*/')) text = text.slice(0, -2);
      return text.trim() || null;
    }
    return null;
  }

  _getName(node, source) {
    const nameNode = node.childForFieldName('name');
    if (nameNode) return this.nodeText(nameNode, source);
    for (const child of node.children) {
      if (['identifier', 'type_identifier', 'constant',
        'property_identifier', 'field_identifier'].includes(child.type)) {
        return this.nodeText(child, source);
      }
    }
    return null;
  }

  // ---- Symbol extraction ----

  _walkSymbols(node, source, symbols, parentName, depth = 0) {
    if (depth > 50) return;
    for (const child of node.children) {
      const kind = this._classifyNode(child);
      if (kind) {
        const name = this._getName(child, source);
        if (name) {
          const qualified = parentName ? `${parentName}.${name}` : name;
          const sig = this.getSignature(child, source);
          symbols.push(this.makeSymbol(name, kind,
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              docstring: this.getDocstring(child, source),
              parentName,
            }));

          if (['class', 'interface', 'module', 'struct', 'enum'].includes(kind)) {
            const body = child.childForFieldName('body');
            if (body) {
              this._walkSymbols(body, source, symbols, qualified, depth + 1);
            } else {
              let bodyFound = false;
              for (const sub of child.children) {
                if (_CLASS_BODY_TYPES.has(sub.type)) {
                  this._walkSymbols(sub, source, symbols, qualified, depth + 1);
                  bodyFound = true;
                  break;
                }
              }
              if (!bodyFound) {
                this._walkSymbols(child, source, symbols, qualified, depth + 1);
              }
            }
          }
          continue;
        }
      }
      this._walkSymbols(child, source, symbols, parentName, depth + 1);
    }
  }

  _classifyNode(node) {
    const ntype = node.type;
    if (_FUNCTION_TYPES.has(ntype)) return 'function';
    if (_CLASS_TYPES.has(ntype)) return 'class';
    if (_INTERFACE_TYPES.has(ntype)) return 'interface';
    if (_ENUM_TYPES.has(ntype)) return 'enum';
    if (_MODULE_TYPES.has(ntype)) return 'module';
    return null;
  }

  // ---- Reference extraction ----

  _walkRefs(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (['call_expression', 'call', 'method_invocation'].includes(child.type)) {
        let func = child.childForFieldName('function') || child.childForFieldName('method');
        if (!func) {
          for (const sub of child.children) {
            if (['identifier', 'member_expression', 'attribute',
              'scoped_identifier', 'field_expression'].includes(sub.type)) {
              func = sub;
              break;
            }
          }
        }
        if (func) {
          refs.push(this.makeReference(this.nodeText(func, source), 'call',
            child.startPosition.row + 1, { sourceName: scopeName }));
        }
      } else {
        let newScope = scopeName;
        const kind = this._classifyNode(child);
        if (kind) {
          const n = this._getName(child, source);
          if (n) newScope = scopeName ? `${scopeName}.${n}` : n;
        }
        this._walkRefs(child, source, refs, newScope);
      }
    }
  }
}
