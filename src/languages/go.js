/**
 * Go symbol and reference extractor.
 */

import { LanguageExtractor } from './base.js';

export class GoExtractor extends LanguageExtractor {
  get languageName() { return 'go'; }
  get fileExtensions() { return ['.go']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    this._pendingInherits = [];
    this._walkSymbols(tree.rootNode, source, filePath, symbols);
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
    let prev = node.previousSibling;
    const comments = [];
    while (prev && prev.type === 'comment') {
      let text = this.nodeText(prev, source).trim();
      if (text.startsWith('//')) text = text.slice(2).trim();
      comments.unshift(text);
      prev = prev.previousSibling;
    }
    return comments.length ? comments.join('\n') : null;
  }

  _isExported(name) {
    return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
  }

  // ---- Symbol extraction ----

  _walkSymbols(node, source, filePath, symbols) {
    for (const child of node.children) {
      if (child.type === 'function_declaration') {
        this._extractFunction(child, source, symbols);
      } else if (child.type === 'method_declaration') {
        this._extractMethod(child, source, symbols);
      } else if (child.type === 'type_declaration') {
        this._extractTypeDecl(child, source, symbols);
      } else if (child.type === 'package_clause') {
        this._extractPackage(child, source, symbols);
      } else if (child.type === 'var_declaration') {
        this._extractVarDecl(child, source, symbols);
      } else if (child.type === 'const_declaration') {
        this._extractConstDecl(child, source, symbols);
      }
    }
  }

  _extractFunction(node, source, symbols) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const params = node.childForFieldName('parameters');
    const result = node.childForFieldName('result');
    const typeParams = node.childForFieldName('type_parameters');

    let sig;
    if (typeParams) {
      sig = `func ${name}${this.nodeText(typeParams, source)}(${this.paramsText(params, source)})`;
    } else {
      sig = `func ${name}(${this.paramsText(params, source)})`;
    }
    if (result) sig += ` ${this.nodeText(result, source)}`;

    symbols.push(this.makeSymbol(name, 'function',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: this._isExported(name) ? 'public' : 'private',
        isExported: this._isExported(name),
      }));
  }

  _extractMethod(node, source, symbols) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const receiver = node.childForFieldName('receiver');
    const recvText = receiver ? this.nodeText(receiver, source) : '';
    const recvType = this._extractReceiverType(receiver, source);
    const params = node.childForFieldName('parameters');
    const result = node.childForFieldName('result');

    let sig = `func ${recvText} ${name}(${this.paramsText(params, source)})`;
    if (result) sig += ` ${this.nodeText(result, source)}`;

    const qualified = recvType ? `${recvType}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'method',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: this._isExported(name) ? 'public' : 'private',
        isExported: this._isExported(name),
        parentName: recvType || null,
      }));
  }

  _extractReceiverType(receiver, source) {
    if (!receiver) return '';
    for (const child of receiver.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        if (typeNode) return this.nodeText(typeNode, source).replace(/^\*/, '');
      }
    }
    return '';
  }

  _extractTypeDecl(node, source, symbols) {
    for (const child of node.children) {
      if (child.type === 'type_spec') {
        this._extractTypeSpec(child, source, symbols, node);
      }
    }
  }

  _extractTypeSpec(node, source, symbols, parentNode) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const typeNode = node.childForFieldName('type');
    if (!typeNode) return;

    let kind = 'type_alias';
    let sig = `type ${name}`;

    if (typeNode.type === 'struct_type') {
      kind = 'struct';
      sig = `type ${name} struct`;
      this._extractStructFields(typeNode, source, symbols, name);
    } else if (typeNode.type === 'interface_type') {
      kind = 'interface';
      sig = `type ${name} interface`;
      this._extractInterfaceMethods(typeNode, source, symbols, name);
    } else {
      sig += ` ${this.nodeText(typeNode, source).slice(0, 60)}`;
    }

    symbols.push(this.makeSymbol(name, kind,
      parentNode.startPosition.row + 1, parentNode.endPosition.row + 1, {
        signature: sig,
        docstring: this.getDocstring(parentNode, source),
        visibility: this._isExported(name) ? 'public' : 'private',
        isExported: this._isExported(name),
      }));
  }

  _extractStructFields(structNode, source, symbols, structName) {
    for (const child of structNode.children) {
      if (child.type === 'field_declaration_list') {
        for (const field of child.children) {
          if (field.type === 'field_declaration') {
            const nameNode = field.childForFieldName('name');
            const typeNode = field.childForFieldName('type');
            if (nameNode) {
              const fieldName = this.nodeText(nameNode, source);
              let sig = fieldName;
              if (typeNode) sig += ` ${this.nodeText(typeNode, source)}`;
              symbols.push(this.makeSymbol(fieldName, 'field',
                field.startPosition.row + 1, field.endPosition.row + 1, {
                  qualifiedName: `${structName}.${fieldName}`,
                  signature: sig,
                  visibility: this._isExported(fieldName) ? 'public' : 'private',
                  isExported: this._isExported(fieldName),
                  parentName: structName,
                }));
            } else if (typeNode) {
              // Embedded/anonymous field (struct embedding)
              const typeName = this.nodeText(typeNode, source).replace(/^\*/, '');
              this._pendingInherits.push(this.makeReference(typeName, 'inherits',
                field.startPosition.row + 1, { sourceName: structName }));
            }
          }
        }
      }
    }
  }

  _extractInterfaceMethods(ifaceNode, source, symbols, ifaceName) {
    for (const child of ifaceNode.children) {
      if (child.type === 'method_spec' || child.type === 'method_elem') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const methodName = this.nodeText(nameNode, source);
          const params = child.childForFieldName('parameters');
          const result = child.childForFieldName('result');
          let sig = `${methodName}(${this.paramsText(params, source)})`;
          if (result) sig += ` ${this.nodeText(result, source)}`;
          symbols.push(this.makeSymbol(methodName, 'method',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: `${ifaceName}.${methodName}`,
              signature: sig,
              visibility: this._isExported(methodName) ? 'public' : 'private',
              isExported: this._isExported(methodName),
              parentName: ifaceName,
            }));
        }
      }
    }
  }

  _extractPackage(node, source, symbols) {
    for (const child of node.children) {
      if (child.type === 'package_identifier') {
        const name = this.nodeText(child, source);
        symbols.push(this.makeSymbol(name, 'module',
          node.startPosition.row + 1, node.endPosition.row + 1, {
            signature: `package ${name}`,
            isExported: true,
          }));
      }
    }
  }

  _extractVarDecl(node, source, symbols) {
    for (const child of node.children) {
      if (child.type === 'var_spec') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = this.nodeText(nameNode, source);
          const typeN = child.childForFieldName('type');
          let sig = `var ${name}`;
          if (typeN) sig += ` ${this.nodeText(typeN, source)}`;
          symbols.push(this.makeSymbol(name, 'variable',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              signature: sig,
              visibility: this._isExported(name) ? 'public' : 'private',
              isExported: this._isExported(name),
            }));
        }
      }
    }
  }

  _extractConstDecl(node, source, symbols) {
    for (const child of node.children) {
      if (child.type === 'const_spec') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = this.nodeText(nameNode, source);
          const typeN = child.childForFieldName('type');
          let sig = `const ${name}`;
          if (typeN) sig += ` ${this.nodeText(typeN, source)}`;
          symbols.push(this.makeSymbol(name, 'constant',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              signature: sig,
              visibility: this._isExported(name) ? 'public' : 'private',
              isExported: this._isExported(name),
            }));
        }
      }
    }
  }

  // ---- Reference extraction ----

  _walkRefs(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'import_declaration') {
        this._extractImports(child, source, refs, scopeName);
      } else if (child.type === 'call_expression') {
        this._extractCall(child, source, refs, scopeName);
      } else {
        let newScope = scopeName;
        if (child.type === 'function_declaration') {
          const n = child.childForFieldName('name');
          if (n) newScope = this.nodeText(n, source);
        } else if (child.type === 'method_declaration') {
          const n = child.childForFieldName('name');
          if (n) {
            const recv = this._extractReceiverType(child.childForFieldName('receiver'), source);
            const fname = this.nodeText(n, source);
            newScope = recv ? `${recv}.${fname}` : fname;
          }
        }
        this._walkRefs(child, source, refs, newScope);
      }
    }
  }

  _extractImports(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'import_spec') {
        const pathNode = child.childForFieldName('path');
        if (pathNode) {
          const path = this.nodeText(pathNode, source).replace(/^"|"$/g, '');
          let target = path.includes('/') ? path.split('/').pop() : path;
          const nameNode = child.childForFieldName('name');
          if (nameNode) target = this.nodeText(nameNode, source);
          refs.push(this.makeReference(target, 'import',
            child.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
        }
      } else if (child.type === 'import_spec_list') {
        this._extractImports(child, source, refs, scopeName);
      } else if (child.type === 'interpreted_string_literal') {
        const path = this.nodeText(child, source).replace(/^"|"$/g, '');
        const target = path.includes('/') ? path.split('/').pop() : path;
        refs.push(this.makeReference(target, 'import',
          child.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
      }
    }
  }

  _extractCall(node, source, refs, scopeName) {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    let name;
    if (funcNode.type === 'selector_expression') {
      const field = funcNode.childForFieldName('field');
      name = field ? this.nodeText(field, source) : this.nodeText(funcNode, source);
    } else {
      name = this.nodeText(funcNode, source);
    }

    refs.push(this.makeReference(name, 'call',
      funcNode.startPosition.row + 1, { sourceName: scopeName }));
    const args = node.childForFieldName('arguments');
    if (args) this._walkRefs(args, source, refs, scopeName);
  }
}
