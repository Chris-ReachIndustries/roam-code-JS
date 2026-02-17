/**
 * C/C++ symbol and reference extractor.
 */

import { LanguageExtractor } from './base.js';

export class CExtractor extends LanguageExtractor {
  get languageName() { return 'c'; }
  get fileExtensions() { return ['.c', '.h']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    const isHeader = filePath.endsWith('.h') || filePath.endsWith('.hpp');
    this._walkSymbols(tree.rootNode, source, symbols, null, isHeader);
    return symbols;
  }

  extractReferences(tree, source, filePath) {
    const refs = [];
    this._walkRefs(tree.rootNode, source, refs, null);
    return refs;
  }

  getDocstring(node, source) {
    let prev = node.previousSibling;
    const comments = [];
    while (prev && prev.type === 'comment') {
      let text = this.nodeText(prev, source).trim();
      if (text.startsWith('/*')) {
        text = text.slice(2);
        if (text.endsWith('*/')) text = text.slice(0, -2);
        comments.unshift(text.trim());
      } else if (text.startsWith('//')) {
        comments.unshift(text.slice(2).trim());
      } else {
        break;
      }
      prev = prev.previousSibling;
    }
    return comments.length ? comments.join('\n') : null;
  }

  // ---- Symbol extraction ----

  _walkSymbols(node, source, symbols, parentName, isHeader) {
    for (const child of node.children) {
      if (child.type === 'function_definition') {
        this._extractFunction(child, source, symbols, parentName, isHeader);
      } else if (child.type === 'declaration') {
        this._extractDeclaration(child, source, symbols, parentName, isHeader);
      } else if (child.type === 'struct_specifier') {
        this._extractStruct(child, source, symbols, parentName, isHeader, 'struct');
      } else if (child.type === 'union_specifier') {
        this._extractStruct(child, source, symbols, parentName, isHeader, 'struct');
      } else if (child.type === 'enum_specifier') {
        this._extractEnum(child, source, symbols, parentName, isHeader);
      } else if (child.type === 'type_definition') {
        this._extractTypedef(child, source, symbols, parentName, isHeader);
      } else if (child.type === 'namespace_definition') {
        this._extractNamespace(child, source, symbols, isHeader);
      } else if (child.type === 'class_specifier') {
        this._extractCppClass(child, source, symbols, parentName, isHeader);
      } else if (child.type === 'template_declaration') {
        this._walkSymbols(child, source, symbols, parentName, isHeader);
      }
    }
  }

  _extractFunction(node, source, symbols, parentName, isHeader) {
    const declarator = node.childForFieldName('declarator');
    if (!declarator) return;
    const [name, paramsText] = this._parseFunctionDeclarator(declarator, source);
    if (!name) return;

    const retType = node.childForFieldName('type');
    const retText = retType ? this.nodeText(retType, source) : '';
    const sig = `${retText} ${name}(${paramsText})`.trim();

    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, 'function',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        isExported: isHeader,
        parentName,
      }));
  }

  _parseFunctionDeclarator(declarator, source) {
    if (declarator.type === 'function_declarator') {
      const nameNode = declarator.childForFieldName('declarator');
      const params = declarator.childForFieldName('parameters');
      let name = nameNode ? this.nodeText(nameNode, source) : null;
      let paramsText = params ? this.nodeText(params, source) : '';
      if (paramsText.startsWith('(') && paramsText.endsWith(')')) {
        paramsText = paramsText.slice(1, -1);
      }
      return [name, paramsText];
    } else if (declarator.type === 'pointer_declarator' || declarator.type === 'reference_declarator') {
      for (const child of declarator.children) {
        if (child.type === 'function_declarator') return this._parseFunctionDeclarator(child, source);
      }
    }
    return [null, ''];
  }

  _extractDeclaration(node, source, symbols, parentName, isHeader) {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) return;
    const typeText = this.nodeText(typeNode, source);

    for (const child of node.children) {
      if (child.type === 'function_declarator') {
        const [name, paramsText] = this._parseFunctionDeclarator(child, source);
        if (name) {
          const qualified = parentName ? `${parentName}::${name}` : name;
          symbols.push(this.makeSymbol(name, 'function',
            node.startPosition.row + 1, node.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: `${typeText} ${name}(${paramsText})`.trim(),
              docstring: this.getDocstring(node, source),
              isExported: isHeader,
              parentName,
            }));
        }
      } else if (child.type === 'init_declarator') {
        const decl = child.childForFieldName('declarator');
        if (decl && decl.type === 'identifier') {
          const name = this.nodeText(decl, source);
          const qualified = parentName ? `${parentName}::${name}` : name;
          symbols.push(this.makeSymbol(name, 'variable',
            node.startPosition.row + 1, node.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: `${typeText} ${name}`,
              isExported: isHeader,
              parentName,
            }));
        }
      } else if (child.type === 'identifier') {
        const name = this.nodeText(child, source);
        const qualified = parentName ? `${parentName}::${name}` : name;
        symbols.push(this.makeSymbol(name, 'variable',
          node.startPosition.row + 1, node.endPosition.row + 1, {
            qualifiedName: qualified,
            signature: `${typeText} ${name}`,
            isExported: isHeader,
            parentName,
          }));
      }
    }
  }

  _extractStruct(node, source, symbols, parentName, isHeader, kind = 'struct') {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const qualified = parentName ? `${parentName}::${name}` : name;

    symbols.push(this.makeSymbol(name, 'struct',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: `${kind} ${name}`,
        docstring: this.getDocstring(node, source),
        isExported: isHeader,
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        if (child.type === 'field_declaration') {
          this._extractStructField(child, source, symbols, qualified);
        }
      }
    }
  }

  _extractStructField(node, source, symbols, structName) {
    const typeNode = node.childForFieldName('type');
    const typeText = typeNode ? this.nodeText(typeNode, source) : '';
    for (const child of node.children) {
      if (child.type === 'field_identifier') {
        const fieldName = this.nodeText(child, source);
        symbols.push(this.makeSymbol(fieldName, 'field',
          node.startPosition.row + 1, node.endPosition.row + 1, {
            qualifiedName: `${structName}::${fieldName}`,
            signature: `${typeText} ${fieldName}`,
            parentName: structName,
          }));
      }
    }
  }

  _extractEnum(node, source, symbols, parentName, isHeader) {
    const nameNode = node.childForFieldName('name');
    const name = nameNode ? this.nodeText(nameNode, source) : null;
    if (!name) return;
    const qualified = parentName ? `${parentName}::${name}` : name;

    symbols.push(this.makeSymbol(name, 'enum',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: `enum ${name}`,
        docstring: this.getDocstring(node, source),
        isExported: isHeader,
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        if (child.type === 'enumerator') {
          const en = child.childForFieldName('name');
          if (en) {
            const enName = this.nodeText(en, source);
            symbols.push(this.makeSymbol(enName, 'constant',
              child.startPosition.row + 1, child.endPosition.row + 1, {
                qualifiedName: `${qualified}::${enName}`,
                parentName: qualified,
                isExported: isHeader,
              }));
          }
        }
      }
    }
  }

  _extractTypedef(node, source, symbols, parentName, isHeader) {
    const declarator = node.childForFieldName('declarator');
    if (declarator) {
      let name = this.nodeText(declarator, source).replace(/[*\[\]\s]/g, '');
      if (!name) return;
      const typeNode = node.childForFieldName('type');
      const typeText = typeNode ? this.nodeText(typeNode, source) : '';
      const qualified = parentName ? `${parentName}::${name}` : name;
      symbols.push(this.makeSymbol(name, 'type_alias',
        node.startPosition.row + 1, node.endPosition.row + 1, {
          qualifiedName: qualified,
          signature: `typedef ${typeText} ${name}`.trim(),
          docstring: this.getDocstring(node, source),
          isExported: isHeader,
          parentName,
        }));
    } else {
      let typeId = null;
      for (const child of node.children) {
        if (child.type === 'type_identifier') typeId = child;
      }
      if (typeId) {
        const name = this.nodeText(typeId, source);
        const qualified = parentName ? `${parentName}::${name}` : name;
        symbols.push(this.makeSymbol(name, 'type_alias',
          node.startPosition.row + 1, node.endPosition.row + 1, {
            qualifiedName: qualified,
            signature: `typedef ... ${name}`,
            isExported: isHeader,
            parentName,
          }));
      }
    }
  }

  _extractNamespace(node, source, symbols, isHeader) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    symbols.push(this.makeSymbol(name, 'module',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        signature: `namespace ${name}`,
        isExported: true,
      }));
    const body = node.childForFieldName('body');
    if (body) this._walkSymbols(body, source, symbols, name, isHeader);
  }

  _extractCppClass(node, source, symbols, parentName, isHeader) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, 'class',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: `class ${name}`,
        docstring: this.getDocstring(node, source),
        isExported: isHeader,
        parentName,
      }));
    const body = node.childForFieldName('body');
    if (body) this._walkSymbols(body, source, symbols, qualified, isHeader);
  }

  // ---- Reference extraction ----

  _walkRefs(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'preproc_include') {
        this._extractInclude(child, source, refs, scopeName);
      } else if (child.type === 'call_expression') {
        this._extractCall(child, source, refs, scopeName);
      } else {
        let newScope = scopeName;
        if (child.type === 'function_definition') {
          const decl = child.childForFieldName('declarator');
          if (decl) {
            const [name] = this._parseFunctionDeclarator(decl, source);
            if (name) newScope = name;
          }
        }
        this._walkRefs(child, source, refs, newScope);
      }
    }
  }

  _extractInclude(node, source, refs, scopeName) {
    const pathNode = node.childForFieldName('path');
    if (pathNode) {
      const path = this.nodeText(pathNode, source).replace(/^[<"]|[>"]$/g, '');
      refs.push(this.makeReference(path, 'import',
        node.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
    } else {
      for (const child of node.children) {
        if (child.type === 'string_literal' || child.type === 'system_lib_string') {
          const path = this.nodeText(child, source).replace(/^[<"]|[>"]$/g, '');
          refs.push(this.makeReference(path, 'import',
            node.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
          break;
        }
      }
    }
  }

  _extractCall(node, source, refs, scopeName) {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;
    refs.push(this.makeReference(this.nodeText(funcNode, source), 'call',
      funcNode.startPosition.row + 1, { sourceName: scopeName }));
    const args = node.childForFieldName('arguments');
    if (args) this._walkRefs(args, source, refs, scopeName);
  }
}

export class CppExtractor extends CExtractor {
  get languageName() { return 'cpp'; }
  get fileExtensions() { return ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.hh', '.h']; }
}
