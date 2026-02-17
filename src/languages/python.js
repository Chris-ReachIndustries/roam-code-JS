/**
 * Full Python symbol and reference extractor.
 *
 * Tree-sitter Node.js API:
 *   node.childForFieldName('x')  (not child_by_field_name)
 *   node.startPosition.row       (not start_point[0])
 *   node.endPosition.row         (not end_point[0])
 *   node.startIndex / endIndex   (not start_byte / end_byte)
 *   node.previousSibling         (not prev_sibling)
 *   source is a string           (not bytes)
 */

import { LanguageExtractor } from './base.js';

const BUILTIN_TYPES = new Set([
  'int', 'str', 'float', 'bool', 'bytes', 'None',
  'list', 'dict', 'set', 'tuple', 'type', 'object',
]);

export class PythonExtractor extends LanguageExtractor {
  get languageName() { return 'python'; }
  get fileExtensions() { return ['.py', '.pyi']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    this._pendingInherits = [];
    const dunderAll = this._findDunderAll(tree.rootNode, source);
    this._walkNode(tree.rootNode, source, filePath, symbols, null, dunderAll);
    return symbols;
  }

  extractReferences(tree, source, filePath) {
    const refs = [];
    this._walkRefs(tree.rootNode, source, filePath, refs, null);
    // Add inheritance references collected during symbol extraction
    for (const info of (this._pendingInherits || [])) {
      refs.push(this.makeReference(info.base_name, 'inherits', info.line, { sourceName: info.class_name }));
    }
    return refs;
  }

  getDocstring(node, source) {
    const body = node.childForFieldName('body');
    if (!body) return null;
    for (const child of body.children) {
      if (child.type === 'expression_statement') {
        for (const sub of child.children) {
          if (sub.type === 'string') {
            return this._extractStringContent(sub, source);
          }
        }
        break;
      } else if (child.type === 'string') {
        return this._extractStringContent(child, source);
      } else if (child.type === 'comment') {
        continue;
      } else {
        break;
      }
    }
    return null;
  }

  _extractStringContent(stringNode, source) {
    for (const child of stringNode.children) {
      if (child.type === 'string_content') {
        return this.nodeText(child, source).trim();
      }
    }
    const text = this.nodeText(stringNode, source);
    for (const q of ['"""', "'''", '"', "'"]) {
      if (text.startsWith(q) && text.endsWith(q)) {
        return text.slice(q.length, -q.length).trim();
      }
    }
    return text;
  }

  _findDunderAll(root, source) {
    for (const child of root.children) {
      if (child.type === 'assignment') {
        const left = child.childForFieldName('left');
        const right = child.childForFieldName('right');
        if (left && this.nodeText(left, source) === '__all__' && right) {
          return this._parseAllList(right, source);
        }
      } else if (child.type === 'expression_statement') {
        for (const sub of child.children) {
          if (sub.type === 'assignment') {
            const left = sub.childForFieldName('left');
            const right = sub.childForFieldName('right');
            if (left && this.nodeText(left, source) === '__all__' && right) {
              return this._parseAllList(right, source);
            }
          }
        }
      }
    }
    return null;
  }

  _parseAllList(node, source) {
    const names = new Set();
    if (node.type === 'list') {
      for (const child of node.children) {
        if (child.type === 'string') {
          const content = this._extractStringContent(child, source);
          if (content) names.add(content);
        }
      }
    }
    return names;
  }

  _getDecorators(node, source) {
    const decorators = [];
    for (const child of node.children) {
      if (child.type === 'decorator') {
        decorators.push(this.nodeText(child, source));
      }
    }
    return decorators;
  }

  _visibility(name) {
    if (name.startsWith('__') && !name.endsWith('__')) return 'private';
    if (name.startsWith('_')) return 'private';
    return 'public';
  }

  _isExported(name, dunderAll) {
    if (dunderAll !== null) return dunderAll.has(name);
    return !name.startsWith('_');
  }

  _walkNode(node, source, filePath, symbols, parentName, dunderAll) {
    for (const child of node.children) {
      if (child.type === 'function_definition') {
        this._extractFunction(child, source, symbols, parentName, dunderAll);
      } else if (child.type === 'class_definition') {
        this._extractClass(child, source, filePath, symbols, parentName, dunderAll);
      } else if (child.type === 'decorated_definition') {
        for (const sub of child.children) {
          if (sub.type === 'function_definition') {
            this._extractFunction(sub, source, symbols, parentName, dunderAll, child);
          } else if (sub.type === 'class_definition') {
            this._extractClass(sub, source, filePath, symbols, parentName, dunderAll, child);
          }
        }
      } else if (child.type === 'assignment') {
        if (parentName === null) {
          this._extractAssignment(child, source, symbols, dunderAll);
        } else {
          this._extractClassProperty(child, source, symbols, parentName);
        }
      } else if (child.type === 'expression_statement') {
        for (const sub of child.children) {
          if (sub.type === 'assignment') {
            if (parentName === null) {
              this._extractAssignment(sub, source, symbols, dunderAll);
            } else {
              this._extractClassProperty(sub, source, symbols, parentName);
            }
          }
        }
      }
    }
  }

  _extractFunction(node, source, symbols, parentName, dunderAll, decoratorNode = null) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const params = node.childForFieldName('parameters');
    let sig = `def ${name}(${this.paramsText(params, source)})`;
    const ret = node.childForFieldName('return_type');
    if (ret) sig += ` -> ${this.nodeText(ret, source)}`;

    const decorators = this._getDecorators(decoratorNode || node, source);
    if (decorators.length) sig = decorators.join('\n') + '\n' + sig;

    const kind = parentName ? 'method' : 'function';
    const qualified = parentName ? `${parentName}.${name}` : name;
    const vis = this._visibility(name);
    const isExported = this._isExported(name, dunderAll);

    const outer = decoratorNode || node;
    symbols.push(this.makeSymbol(name, kind, outer.startPosition.row + 1, node.endPosition.row + 1, {
      qualifiedName: qualified,
      signature: sig,
      docstring: this.getDocstring(node, source),
      visibility: vis,
      isExported,
      parentName,
    }));

    // Extract instance attributes from __init__
    if (name === '__init__' && parentName) {
      const body = node.childForFieldName('body');
      if (body) {
        const selfName = this._detectSelfName(node, source);
        this._extractInitAttributes(body, source, symbols, parentName, dunderAll, selfName);
      }
    }
  }

  _extractClass(node, source, filePath, symbols, parentName, dunderAll, decoratorNode = null) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);

    const bases = node.childForFieldName('superclasses');
    let sig = `class ${name}`;
    if (bases) {
      const basesText = this.nodeText(bases, source);
      sig += basesText.startsWith('(') ? basesText : `(${basesText})`;
    }

    const decorators = this._getDecorators(decoratorNode || node, source);
    if (decorators.length) sig = decorators.join('\n') + '\n' + sig;

    const qualified = parentName ? `${parentName}.${name}` : name;
    const vis = this._visibility(name);
    const isExported = this._isExported(name, dunderAll);

    const outer = decoratorNode || node;
    symbols.push(this.makeSymbol(name, 'class', outer.startPosition.row + 1, node.endPosition.row + 1, {
      qualifiedName: qualified,
      signature: sig,
      docstring: this.getDocstring(node, source),
      visibility: vis,
      isExported,
      parentName,
    }));

    // Track inheritance
    const basesNode = node.childForFieldName('superclasses');
    if (basesNode) {
      for (const child of basesNode.children) {
        if (child.type === 'identifier') {
          const baseName = this.nodeText(child, source);
          if (baseName) {
            this._pendingInherits.push({
              class_name: qualified,
              base_name: baseName,
              line: node.startPosition.row + 1,
            });
          }
        } else if (child.type === 'attribute') {
          const baseName = this.nodeText(child, source);
          if (baseName) {
            const shortName = baseName.split('.').pop();
            this._pendingInherits.push({
              class_name: qualified,
              base_name: shortName,
              line: node.startPosition.row + 1,
            });
          }
        }
      }
    }

    // Walk class body
    const body = node.childForFieldName('body');
    if (body) {
      this._walkNode(body, source, filePath, symbols, qualified, dunderAll);
    }
  }

  _extractAssignment(node, source, symbols, dunderAll) {
    const left = node.childForFieldName('left');
    if (!left) return;
    const name = this.nodeText(left, source);
    if (name.includes('.') || name.includes('[')) return;
    if (name === '__all__') return;

    const right = node.childForFieldName('right');
    const sig = right ? `${name} = ${this.nodeText(right, source).slice(0, 80)}` : name;
    const kind = (name === name.toUpperCase() && name.includes('_')) || name === name.toUpperCase() ? 'constant' : 'variable';

    symbols.push(this.makeSymbol(name, kind, node.startPosition.row + 1, node.endPosition.row + 1, {
      signature: sig,
      visibility: this._visibility(name),
      isExported: this._isExported(name, dunderAll),
    }));
  }

  _extractClassProperty(node, source, symbols, parentName) {
    const left = node.childForFieldName('left');
    if (!left) return;
    const name = this.nodeText(left, source);
    if (name.includes('.') || name.includes('[')) return;
    if (name === '__all__') return;

    const right = node.childForFieldName('right');
    const defaultValue = right ? this._extractLiteralValue(right, source) : null;

    const qualified = parentName ? `${parentName}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'property', node.startPosition.row + 1, node.endPosition.row + 1, {
      qualifiedName: qualified,
      visibility: this._visibility(name),
      parentName,
      defaultValue,
    }));
  }

  _extractLiteralValue(node, source) {
    const literalTypes = new Set(['string', 'integer', 'float', 'true', 'false', 'none', 'None', 'concatenated_string']);
    if (literalTypes.has(node.type)) {
      const text = this.nodeText(node, source);
      return text.length <= 200 ? text : null;
    }
    if (node.type === 'string') {
      for (const child of node.children) {
        if (child.type === 'string_content') return this.nodeText(child, source);
      }
      return this.nodeText(node, source).slice(0, 200);
    }
    if (node.type === 'unary_operator') {
      const op = this.nodeText(node, source);
      if (/^-[\d.]+$/.test(op.trim())) return op;
    }
    if (['list', 'tuple', 'dictionary'].includes(node.type)) {
      const text = this.nodeText(node, source);
      if (text.length <= 80) return text;
    }
    return null;
  }

  _detectSelfName(funcNode, source) {
    const params = funcNode.childForFieldName('parameters');
    if (params) {
      for (const child of params.children) {
        if (child.type === 'identifier') return this.nodeText(child, source);
        if (child.type === 'typed_parameter' || child.type === 'typed_default_parameter') {
          const nameNode = child.childForFieldName('name');
          if (nameNode && nameNode.type === 'identifier') return this.nodeText(nameNode, source);
        }
      }
    }
    return 'self';
  }

  _extractInitAttributes(bodyNode, source, symbols, parentName, dunderAll, selfName) {
    const seen = new Set();
    for (const sym of symbols) {
      if (sym.parent_name === parentName && sym.kind === 'property') {
        seen.add(sym.name);
      }
    }
    this._collectSelfAssignments(bodyNode, source, symbols, parentName, dunderAll, selfName, seen);
  }

  _collectSelfAssignments(node, source, symbols, parentName, dunderAll, selfName, seen) {
    for (const child of node.children) {
      if (child.type === 'expression_statement') {
        for (const sub of child.children) {
          if (sub.type === 'assignment') {
            this._tryExtractSelfAttr(sub, source, symbols, parentName, selfName, seen);
          }
        }
      } else if (child.type === 'assignment') {
        this._tryExtractSelfAttr(child, source, symbols, parentName, selfName, seen);
      } else if (['if_statement', 'try_statement', 'with_statement', 'for_statement', 'block'].includes(child.type)) {
        this._collectSelfAssignments(child, source, symbols, parentName, dunderAll, selfName, seen);
      }
    }
  }

  _tryExtractSelfAttr(assignNode, source, symbols, parentName, selfName, seen) {
    const left = assignNode.childForFieldName('left');
    if (!left || left.type !== 'attribute') return;
    const obj = left.childForFieldName('object');
    if (!obj || obj.type !== 'identifier' || this.nodeText(obj, source) !== selfName) return;
    const attrNode = left.childForFieldName('attribute');
    if (!attrNode) return;
    const attrName = this.nodeText(attrNode, source);
    if (seen.has(attrName)) return;
    seen.add(attrName);

    const right = assignNode.childForFieldName('right');
    const defaultValue = right ? this._extractLiteralValue(right, source) : null;

    const qualified = `${parentName}.${attrName}`;
    symbols.push(this.makeSymbol(attrName, 'property', assignNode.startPosition.row + 1, assignNode.endPosition.row + 1, {
      qualifiedName: qualified,
      visibility: this._visibility(attrName),
      parentName,
      defaultValue,
    }));
  }

  // ---- Reference extraction ----

  _walkRefs(node, source, filePath, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'import_statement') {
        this._extractImport(child, source, refs, scopeName);
      } else if (child.type === 'import_from_statement') {
        this._extractFromImport(child, source, refs, scopeName);
      } else if (child.type === 'call') {
        this._extractCall(child, source, refs, scopeName);
      } else if (child.type === 'decorated_definition') {
        this._extractDecoratorRefs(child, source, refs, scopeName);
        this._walkRefs(child, source, filePath, refs, scopeName);
      } else if (child.type === 'assignment' || child.type === 'expression_statement') {
        this._extractAssignmentTypeRefs(child, source, refs, scopeName);
        this._walkRefs(child, source, filePath, refs, scopeName);
      } else if (child.type === 'raise_statement') {
        this._extractRaiseRefs(child, source, refs, scopeName);
      } else if (child.type === 'except_clause') {
        this._extractExceptRefs(child, source, refs, scopeName);
        this._walkRefs(child, source, filePath, refs, scopeName);
      } else {
        let newScope = scopeName;
        if (child.type === 'function_definition' || child.type === 'class_definition') {
          const n = child.childForFieldName('name');
          if (n) {
            const fname = this.nodeText(n, source);
            newScope = scopeName ? `${scopeName}.${fname}` : fname;
          }
          if (child.type === 'function_definition') {
            this._extractTypeRefs(child, source, refs, newScope);
          }
        }
        this._walkRefs(child, source, filePath, refs, newScope);
      }
    }
  }

  _extractDecoratorRefs(decoratedNode, source, refs, scopeName) {
    for (const child of decoratedNode.children) {
      if (child.type === 'decorator') {
        for (const sub of child.children) {
          if (sub.type === 'identifier') {
            refs.push(this.makeReference(this.nodeText(sub, source), 'call', sub.startPosition.row + 1, { sourceName: scopeName }));
          } else if (sub.type === 'attribute') {
            refs.push(this.makeReference(this.nodeText(sub, source), 'call', sub.startPosition.row + 1, { sourceName: scopeName }));
          } else if (sub.type === 'call') {
            this._extractCall(sub, source, refs, scopeName);
          }
        }
      }
    }
  }

  _extractRaiseRefs(raiseNode, source, refs, scopeName) {
    for (const child of raiseNode.children) {
      if (child.type === 'call') {
        this._extractCall(child, source, refs, scopeName);
      } else if (child.type === 'identifier') {
        refs.push(this.makeReference(this.nodeText(child, source), 'call', child.startPosition.row + 1, { sourceName: scopeName }));
      }
    }
  }

  _extractExceptRefs(exceptNode, source, refs, scopeName) {
    for (const child of exceptNode.children) {
      if (child.type === 'identifier') {
        const name = this.nodeText(child, source);
        if (!BUILTIN_TYPES.has(name) && name !== 'except' && name !== 'as') {
          refs.push(this.makeReference(name, 'type_ref', child.startPosition.row + 1, { sourceName: scopeName }));
          return;
        }
      } else if (child.type === 'as_pattern') {
        for (const sub of child.children) {
          if (sub.type === 'identifier') {
            const name = this.nodeText(sub, source);
            if (!BUILTIN_TYPES.has(name)) {
              refs.push(this.makeReference(name, 'type_ref', sub.startPosition.row + 1, { sourceName: scopeName }));
            }
            return;
          } else if (sub.type === 'tuple') {
            for (const t of sub.children) {
              if (t.type === 'identifier') {
                const name = this.nodeText(t, source);
                if (!BUILTIN_TYPES.has(name)) {
                  refs.push(this.makeReference(name, 'type_ref', t.startPosition.row + 1, { sourceName: scopeName }));
                }
              }
            }
            return;
          } else if (sub.type === 'attribute') {
            refs.push(this.makeReference(this.nodeText(sub, source), 'type_ref', sub.startPosition.row + 1, { sourceName: scopeName }));
            return;
          }
        }
      } else if (child.type === 'tuple') {
        for (const sub of child.children) {
          if (sub.type === 'identifier') {
            const name = this.nodeText(sub, source);
            if (!BUILTIN_TYPES.has(name)) {
              refs.push(this.makeReference(name, 'type_ref', sub.startPosition.row + 1, { sourceName: scopeName }));
            }
          }
        }
        return;
      } else if (child.type === 'attribute') {
        refs.push(this.makeReference(this.nodeText(child, source), 'type_ref', child.startPosition.row + 1, { sourceName: scopeName }));
        return;
      }
    }
  }

  _extractTypeRefs(funcNode, source, refs, scopeName) {
    const params = funcNode.childForFieldName('parameters');
    if (params) {
      for (const param of params.children) {
        const typeNode = param.childForFieldName('type');
        if (typeNode) this._walkTypeNode(typeNode, source, refs, scopeName);
      }
    }
    const ret = funcNode.childForFieldName('return_type');
    if (ret) this._walkTypeNode(ret, source, refs, scopeName);
  }

  _extractAssignmentTypeRefs(node, source, refs, scopeName) {
    const targets = [];
    if (node.type === 'assignment') targets.push(node);
    if (node.type === 'expression_statement') {
      for (const sub of node.children) {
        if (sub.type === 'assignment') targets.push(sub);
      }
    }
    for (const assign of targets) {
      const typeNode = assign.childForFieldName('type');
      if (typeNode) this._walkTypeNode(typeNode, source, refs, scopeName);
    }
  }

  _walkTypeNode(node, source, refs, scopeName) {
    if (node.type === 'identifier') {
      const name = this.nodeText(node, source);
      if (!BUILTIN_TYPES.has(name)) {
        refs.push(this.makeReference(name, 'type_ref', node.startPosition.row + 1, { sourceName: scopeName }));
      }
    } else if (node.type === 'attribute') {
      refs.push(this.makeReference(this.nodeText(node, source), 'type_ref', node.startPosition.row + 1, { sourceName: scopeName }));
    } else if (node.type === 'string') {
      // Forward reference
      for (const child of node.children) {
        if (child.type === 'string_content') {
          const name = this.nodeText(child, source).trim();
          if (/^[a-zA-Z_]\w*$/.test(name) && !BUILTIN_TYPES.has(name)) {
            refs.push(this.makeReference(name, 'type_ref', child.startPosition.row + 1, { sourceName: scopeName }));
          } else if (name.includes('.') && name.split('.').every(p => /^[a-zA-Z_]\w*$/.test(p))) {
            refs.push(this.makeReference(name, 'type_ref', child.startPosition.row + 1, { sourceName: scopeName }));
          }
        }
      }
    } else {
      for (const child of node.children) {
        this._walkTypeNode(child, source, refs, scopeName);
      }
    }
  }

  _extractImport(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'dotted_name') {
        const mod = this.nodeText(child, source);
        refs.push(this.makeReference(mod, 'import', child.startPosition.row + 1, { sourceName: scopeName, importPath: mod }));
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const mod = this.nodeText(nameNode, source);
          refs.push(this.makeReference(mod, 'import', child.startPosition.row + 1, { sourceName: scopeName, importPath: mod }));
        }
      }
    }
  }

  _extractFromImport(node, source, refs, scopeName) {
    const moduleNode = node.childForFieldName('module_name');
    const modPath = moduleNode ? this.nodeText(moduleNode, source) : '';

    for (const child of node.children) {
      if (child.type === 'dotted_name' && child !== moduleNode) {
        const name = this.nodeText(child, source);
        refs.push(this.makeReference(name, 'import', child.startPosition.row + 1, {
          sourceName: scopeName,
          importPath: modPath ? `${modPath}.${name}` : name,
        }));
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = this.nodeText(nameNode, source);
          refs.push(this.makeReference(name, 'import', child.startPosition.row + 1, {
            sourceName: scopeName,
            importPath: modPath ? `${modPath}.${name}` : name,
          }));
        }
      } else if (child.type === 'wildcard_import') {
        refs.push(this.makeReference('*', 'import', child.startPosition.row + 1, {
          sourceName: scopeName,
          importPath: modPath ? `${modPath}.*` : '*',
        }));
      }
    }
  }

  _extractCall(node, source, refs, scopeName) {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    const name = this.nodeText(funcNode, source);
    refs.push(this.makeReference(name, 'call', funcNode.startPosition.row + 1, { sourceName: scopeName }));

    // Recurse into arguments for nested calls
    const args = node.childForFieldName('arguments');
    if (args) {
      this._walkRefs(args, source, '', refs, scopeName);
    }
  }
}
