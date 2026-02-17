/**
 * JavaScript symbol and reference extractor.
 */

import { basename } from 'node:path';
import { LanguageExtractor } from './base.js';

const _JS_KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'super', 'arguments',
  'new', 'void', 'typeof', 'instanceof', 'in', 'of', 'async', 'await',
  'yield', 'return', 'throw', 'delete', 'NaN', 'Infinity',
]);

export class JavaScriptExtractor extends LanguageExtractor {
  get languageName() { return 'javascript'; }
  get fileExtensions() { return ['.js', '.jsx', '.mjs', '.cjs']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    this._pendingInherits = [];
    this._walkSymbols(tree.rootNode, source, filePath, symbols, null, false);
    return symbols;
  }

  extractReferences(tree, source, filePath) {
    const refs = [];
    this._walkRefs(tree.rootNode, source, refs, null);
    refs.push(...(this._pendingInherits || []));
    this._pendingInherits = [];
    return refs;
  }

  getDocstring(node, source) {
    const prev = node.previousSibling;
    if (prev && prev.type === 'comment') {
      let text = this.nodeText(prev, source).trim();
      if (text.startsWith('/**')) {
        text = text.slice(3);
        if (text.endsWith('*/')) text = text.slice(0, -2);
        return text.trim() || null;
      }
    }
    return null;
  }

  // ---- Symbol extraction ----

  _walkSymbols(node, source, filePath, symbols, parentName, isExported) {
    for (const child of node.children) {
      const exported = isExported || this._isExportNode(child);

      if (child.type === 'function_declaration') {
        this._extractFunction(child, source, symbols, parentName, exported);
      } else if (child.type === 'generator_function_declaration') {
        this._extractFunction(child, source, symbols, parentName, exported, true);
      } else if (child.type === 'class_declaration' || child.type === 'class') {
        this._extractClass(child, source, filePath, symbols, parentName, exported);
      } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
        this._extractVariableDecl(child, source, filePath, symbols, parentName, exported);
      } else if (child.type === 'export_statement') {
        this._walkSymbols(child, source, filePath, symbols, parentName, true);
      } else if (child.type === 'expression_statement') {
        this._extractModuleExports(child, source, symbols, parentName);
      } else {
        this._walkSymbols(child, source, filePath, symbols, parentName, isExported);
      }
    }
  }

  _isExportNode(node) {
    return node.type === 'export_statement';
  }

  _extractFunction(node, source, symbols, parentName, isExported, generator = false) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const params = node.childForFieldName('parameters');
    const prefix = generator ? 'function*' : 'function';
    const sig = `${prefix} ${name}(${this.paramsText(params, source)})`;

    const qualified = parentName ? `${parentName}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'function',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        isExported,
        parentName,
      }));
  }

  _extractClass(node, source, filePath, symbols, parentName, isExported) {
    const nameNode = node.childForFieldName('name');
    let name;
    if (!nameNode) {
      const bn = basename(filePath);
      name = bn.split('.')[0];
      name = name.charAt(0).toUpperCase() + name.slice(1) || 'Anonymous';
    } else {
      name = this.nodeText(nameNode, source);
    }
    let sig = `class ${name}`;
    const qualified = parentName ? `${parentName}.${name}` : name;

    // Check for extends/implements
    for (const child of node.children) {
      if (child.type === 'class_heritage') {
        sig += ` ${this.nodeText(child, source)}`;
        for (const sub of child.children) {
          if (sub.type === 'extends_clause') {
            for (const exn of sub.children) {
              if (exn.type === 'identifier' || exn.type === 'type_identifier') {
                this._pendingInherits.push(this.makeReference(
                  this.nodeText(exn, source), 'inherits',
                  node.startPosition.row + 1, { sourceName: qualified }));
                break;
              }
            }
          } else if (sub.type === 'implements_clause') {
            for (const imp of sub.children) {
              if (imp.type === 'type_identifier' || imp.type === 'identifier') {
                this._pendingInherits.push(this.makeReference(
                  this.nodeText(imp, source), 'implements',
                  node.startPosition.row + 1, { sourceName: qualified }));
              }
            }
          } else if (sub.type === 'identifier') {
            this._pendingInherits.push(this.makeReference(
              this.nodeText(sub, source), 'inherits',
              node.startPosition.row + 1, { sourceName: qualified }));
          }
        }
        break;
      }
    }

    symbols.push(this.makeSymbol(name, 'class',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        isExported,
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) this._extractClassMembers(body, source, symbols, qualified);
  }

  _extractClassMembers(bodyNode, source, symbols, className) {
    for (const child of bodyNode.children) {
      if (child.type === 'method_definition' || child.type === 'public_field_definition' || child.type === 'field_definition') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) continue;
        const name = this.nodeText(nameNode, source);
        const qualified = `${className}.${name}`;

        if (child.type === 'method_definition') {
          const params = child.childForFieldName('parameters');
          let sig = `${name}(${this.paramsText(params, source)})`;

          const prefixes = [];
          for (const sub of child.children) {
            if (sub === nameNode) continue;
            const t = this.nodeText(sub, source);
            if (['static', 'async', 'get', 'set'].includes(t)) {
              prefixes.push(t);
            }
          }
          if (prefixes.length) sig = prefixes.join(' ') + ' ' + sig;

          const kind = name === 'constructor' ? 'constructor' : 'method';
          symbols.push(this.makeSymbol(name, kind,
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              docstring: this.getDocstring(child, source),
              parentName: className,
            }));
        } else {
          symbols.push(this.makeSymbol(name, 'property',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              parentName: className,
            }));
        }
      }
    }
  }

  _extractVariableDecl(node, source, filePath, symbols, parentName, isExported) {
    let declKindText = '';
    for (const child of node.children) {
      const t = this.nodeText(child, source);
      if (['const', 'let', 'var'].includes(t)) {
        declKindText = t;
        break;
      }
    }

    for (const child of node.children) {
      if (child.type !== 'variable_declarator') continue;
      const nameNode = child.childForFieldName('name');
      const valueNode = child.childForFieldName('value');
      if (!nameNode) continue;

      if (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') {
        this._extractDestructured(nameNode, node, source, symbols,
          parentName, isExported, declKindText, valueNode);
        continue;
      }

      const name = this.nodeText(nameNode, source);
      const qualified = parentName ? `${parentName}.${name}` : name;

      if (valueNode && ['arrow_function', 'function_expression', 'generator_function'].includes(valueNode.type)) {
        const params = valueNode.childForFieldName('parameters');
        const pText = this.paramsText(params, source);
        const sig = valueNode.type === 'arrow_function'
          ? `const ${name} = (${pText}) =>`
          : `const ${name} = function(${pText})`;

        symbols.push(this.makeSymbol(name, 'function',
          node.startPosition.row + 1, node.endPosition.row + 1, {
            qualifiedName: qualified,
            signature: sig,
            docstring: this.getDocstring(node, source),
            isExported,
            parentName,
          }));
      } else if (valueNode && valueNode.type === 'class') {
        const sig = `const ${name} = class`;
        symbols.push(this.makeSymbol(name, 'class',
          node.startPosition.row + 1, node.endPosition.row + 1, {
            qualifiedName: qualified,
            signature: sig,
            isExported,
            parentName,
          }));
      } else {
        const kind = declKindText === 'const' ? 'constant' : 'variable';
        const valText = valueNode ? this.nodeText(valueNode, source).slice(0, 80) : '';
        const sig = `${declKindText} ${name}` + (valText ? ` = ${valText}` : '');

        symbols.push(this.makeSymbol(name, kind,
          node.startPosition.row + 1, node.endPosition.row + 1, {
            qualifiedName: qualified,
            signature: sig,
            isExported,
            parentName,
          }));
      }
    }
  }

  _extractModuleExports(node, source, symbols, parentName) {
    for (const child of node.children) {
      if (child.type !== 'assignment_expression') continue;
      const left = child.childForFieldName('left');
      const right = child.childForFieldName('right');
      if (!left || !right) continue;

      const leftText = this.nodeText(left, source);

      if (leftText === 'module.exports' || leftText === 'exports') {
        if (right.type === 'identifier') {
          const rname = this.nodeText(right, source);
          for (const sym of symbols) {
            if (sym.name === rname) sym.is_exported = true;
          }
        } else if (right.type === 'object') {
          this._extractObjectExportMembers(right, source, symbols);
        }
        continue;
      }

      if (left.type === 'member_expression') {
        const objNode = left.childForFieldName('object');
        const propNode = left.childForFieldName('property');
        if (!objNode || !propNode) continue;
        let objText = this.nodeText(objNode, source);
        const propName = this.nodeText(propNode, source);

        if (objNode.type === 'member_expression') {
          const innerProp = objNode.childForFieldName('property');
          const innerObj = objNode.childForFieldName('object');
          if (innerProp && this.nodeText(innerProp, source) === 'prototype' && innerObj) {
            objText = this.nodeText(innerObj, source);
          }
        }

        const isExports = objText === 'exports' || objText === 'module.exports';

        if (right.type === 'identifier' && isExports) {
          const rname = this.nodeText(right, source);
          for (const sym of symbols) {
            if (sym.name === rname) sym.is_exported = true;
          }
          continue;
        }

        if (['function_expression', 'arrow_function', 'generator_function'].includes(right.type)) {
          const params = right.childForFieldName('parameters');
          const pText = this.paramsText(params, source);
          const sig = `${objText}.${propName} = function(${pText})`;
          const qualified = `${objText}.${propName}`;
          symbols.push(this.makeSymbol(propName, 'function',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              docstring: this.getDocstring(node, source),
              isExported: isExports,
              parentName: objText,
            }));
        } else {
          const valText = this.nodeText(right, source).slice(0, 80);
          const qualified = `${objText}.${propName}`;
          symbols.push(this.makeSymbol(propName, 'constant',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: `${objText}.${propName} = ${valText}`,
              isExported: isExports,
              parentName: objText,
            }));
        }
      }
    }
  }

  _extractObjectExportMembers(objNode, source, symbols) {
    for (const child of objNode.children) {
      if (child.type === 'method_definition') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) continue;
        const name = this.nodeText(nameNode, source);
        const params = child.childForFieldName('parameters');
        symbols.push(this.makeSymbol(name, 'function',
          child.startPosition.row + 1, child.endPosition.row + 1, {
            qualifiedName: `exports.${name}`,
            signature: `exports.${name}(${this.paramsText(params, source)})`,
            isExported: true,
            parentName: 'exports',
          }));
      } else if (child.type === 'pair') {
        const keyNode = child.childForFieldName('key');
        const valueNode = child.childForFieldName('value');
        if (!keyNode || !valueNode) continue;
        const name = this.nodeText(keyNode, source);
        if (['function_expression', 'arrow_function', 'generator_function'].includes(valueNode.type)) {
          const params = valueNode.childForFieldName('parameters');
          symbols.push(this.makeSymbol(name, 'function',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: `exports.${name}`,
              signature: `exports.${name} = function(${this.paramsText(params, source)})`,
              isExported: true,
              parentName: 'exports',
            }));
        } else {
          const valText = this.nodeText(valueNode, source).slice(0, 80);
          symbols.push(this.makeSymbol(name, 'constant',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: `exports.${name}`,
              signature: `exports.${name} = ${valText}`,
              isExported: true,
              parentName: 'exports',
            }));
        }
      } else if (child.type === 'shorthand_property_identifier') {
        const name = this.nodeText(child, source);
        for (const sym of symbols) {
          if (sym.name === name) sym.is_exported = true;
        }
      }
    }
  }

  _extractDestructured(patternNode, declNode, source, symbols, parentName, isExported, declKind, valueNode) {
    const names = this._collectPatternNames(patternNode, source);
    const kind = declKind === 'const' ? 'constant' : 'variable';
    for (const name of names) {
      const qualified = parentName ? `${parentName}.${name}` : name;
      symbols.push(this.makeSymbol(name, kind,
        declNode.startPosition.row + 1, declNode.endPosition.row + 1, {
          qualifiedName: qualified,
          signature: `${declKind} ${name}`,
          isExported,
          parentName,
        }));
    }
  }

  _collectPatternNames(patternNode, source) {
    const names = [];
    for (const child of patternNode.children) {
      if (['shorthand_property_identifier_pattern', 'shorthand_property_identifier', 'identifier'].includes(child.type)) {
        names.push(this.nodeText(child, source));
      } else if (child.type === 'pair_pattern') {
        const value = child.childForFieldName('value');
        if (value) {
          if (value.type === 'identifier') {
            names.push(this.nodeText(value, source));
          } else if (value.type === 'object_pattern' || value.type === 'array_pattern') {
            names.push(...this._collectPatternNames(value, source));
          }
        }
      } else if (child.type === 'rest_pattern') {
        for (const sub of child.children) {
          if (sub.type === 'identifier') names.push(this.nodeText(sub, source));
        }
      } else if (child.type === 'assignment_pattern') {
        const left = child.childForFieldName('left');
        if (left) {
          if (left.type === 'identifier' || left.type === 'shorthand_property_identifier_pattern' || left.type === 'shorthand_property_identifier') {
            names.push(this.nodeText(left, source));
          }
        }
      } else if (child.type === 'object_pattern' || child.type === 'array_pattern') {
        names.push(...this._collectPatternNames(child, source));
      }
    }
    return names;
  }

  // ---- Reference extraction ----

  _walkRefs(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'import_statement') {
        this._extractEsmImport(child, source, refs, scopeName);
      } else if (child.type === 'export_statement') {
        this._walkRefs(child, source, refs, scopeName);
      } else if (child.type === 'call_expression') {
        this._extractCall(child, source, refs, scopeName);
      } else if (child.type === 'new_expression') {
        this._extractNew(child, source, refs, scopeName);
      } else if (child.type === 'identifier' && node.type === 'arguments') {
        const name = this.nodeText(child, source);
        if (name && !_JS_KEYWORDS.has(name)) {
          refs.push(this.makeReference(name, 'reference',
            child.startPosition.row + 1, { sourceName: scopeName }));
        }
      } else if (child.type === 'shorthand_property_identifier') {
        const name = this.nodeText(child, source);
        if (name) {
          refs.push(this.makeReference(name, 'reference',
            child.startPosition.row + 1, { sourceName: scopeName }));
        }
      } else {
        let newScope = scopeName;
        if (['function_declaration', 'class_declaration', 'generator_function_declaration'].includes(child.type)) {
          const n = child.childForFieldName('name');
          if (n) {
            const fname = this.nodeText(n, source);
            newScope = scopeName ? `${scopeName}.${fname}` : fname;
          }
        } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
          for (const sub of child.children) {
            if (sub.type === 'variable_declarator') {
              const n = sub.childForFieldName('name');
              if (n && n.type === 'identifier') {
                const vname = this.nodeText(n, source);
                newScope = scopeName ? `${scopeName}.${vname}` : vname;
                break;
              }
            }
          }
        }
        this._walkRefs(child, source, refs, newScope);
      }
    }
  }

  _resolveSalesforceImport(path) {
    if (!path.startsWith('@salesforce/')) return null;
    const rest = path.slice('@salesforce/'.length);
    if (rest.startsWith('apex/')) return [rest.slice('apex/'.length), 'call'];
    if (rest.startsWith('schema/')) return [rest.slice('schema/'.length), 'schema_ref'];
    if (rest.startsWith('label/')) {
      let target = rest.slice('label/'.length);
      if (target.startsWith('c.')) target = 'Label.' + target.slice(2);
      return [target, 'label'];
    }
    if (rest.startsWith('messageChannel/')) return [rest.slice('messageChannel/'.length), 'import'];
    return null;
  }

  _extractEsmImport(node, source, refs, scopeName) {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return;
    const path = this.nodeText(sourceNode, source).replace(/^['"]|['"]$/g, '');

    const sfResolved = this._resolveSalesforceImport(path);
    if (sfResolved) {
      refs.push(this.makeReference(sfResolved[0], sfResolved[1],
        node.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
      return;
    }

    const names = [];
    for (const child of node.children) {
      if (child.type === 'import_clause') {
        for (const sub of child.children) {
          if (sub.type === 'identifier') {
            names.push(this.nodeText(sub, source));
          } else if (sub.type === 'named_imports') {
            for (const spec of sub.children) {
              if (spec.type === 'import_specifier') {
                const nameNode = spec.childForFieldName('name');
                if (nameNode) names.push(this.nodeText(nameNode, source));
              }
            }
          } else if (sub.type === 'namespace_import') {
            for (const nsChild of sub.children) {
              if (nsChild.type === 'identifier') names.push(this.nodeText(nsChild, source));
            }
          }
        }
      }
    }

    if (names.length) {
      for (const name of names) {
        refs.push(this.makeReference(name, 'import',
          node.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
      }
    } else {
      refs.push(this.makeReference(path, 'import',
        node.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
    }
  }

  _extractCall(node, source, refs, scopeName) {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    let name;
    if (funcNode.type === 'member_expression') {
      const prop = funcNode.childForFieldName('property');
      name = prop ? this.nodeText(prop, source) : this.nodeText(funcNode, source);
    } else {
      name = this.nodeText(funcNode, source);
    }

    if (name === 'require') {
      const args = node.childForFieldName('arguments');
      if (args) {
        for (const argChild of args.children) {
          if (argChild.type === 'string') {
            const path = this.nodeText(argChild, source).replace(/^['"]|['"]$/g, '');
            let target = path.includes('/') ? path.split('/').pop() : path;
            for (const ext of ['.js', '.json', '.mjs', '.cjs']) {
              if (target.endsWith(ext)) { target = target.slice(0, -ext.length); break; }
            }
            refs.push(this.makeReference(target, 'import',
              node.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
            return;
          }
        }
      }
    }

    refs.push(this.makeReference(name, 'call',
      node.startPosition.row + 1, { sourceName: scopeName }));

    const args = node.childForFieldName('arguments');
    if (args) this._walkRefs(args, source, refs, scopeName);
  }

  _extractNew(node, source, refs, scopeName) {
    const ctor = node.childForFieldName('constructor');
    if (!ctor) return;

    let name;
    if (ctor.type === 'member_expression') {
      const prop = ctor.childForFieldName('property');
      name = prop ? this.nodeText(prop, source) : this.nodeText(ctor, source);
    } else {
      name = this.nodeText(ctor, source);
    }

    refs.push(this.makeReference(name, 'call',
      ctor.startPosition.row + 1, { sourceName: scopeName }));

    const args = node.childForFieldName('arguments');
    if (args) this._walkRefs(args, source, refs, scopeName);
  }
}
