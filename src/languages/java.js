/**
 * Java symbol and reference extractor.
 */

import { LanguageExtractor } from './base.js';

export class JavaExtractor extends LanguageExtractor {
  get languageName() { return 'java'; }
  get fileExtensions() { return ['.java']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    this._pendingInherits = [];
    this._walkSymbols(tree.rootNode, source, symbols, null);
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
    if (prev && (prev.type === 'block_comment' || prev.type === 'comment')) {
      let text = this.nodeText(prev, source).trim();
      if (text.startsWith('/**')) {
        text = text.slice(3);
        if (text.endsWith('*/')) text = text.slice(0, -2);
        return text.trim() || null;
      }
    }
    return null;
  }

  _getVisibility(node, source) {
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        const text = this.nodeText(child, source);
        if (text.includes('private')) return 'private';
        if (text.includes('protected')) return 'protected';
        if (text.includes('public')) return 'public';
      }
    }
    return 'package';
  }

  _getAnnotations(node, source) {
    const annotations = [];
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const sub of child.children) {
          if (sub.type === 'annotation' || sub.type === 'marker_annotation') {
            annotations.push(this.nodeText(sub, source));
          }
        }
      }
    }
    return annotations;
  }

  _hasModifier(node, source, modifier) {
    for (const child of node.children) {
      if (child.type === 'modifiers') return this.nodeText(child, source).includes(modifier);
    }
    return false;
  }

  // ---- Symbol extraction ----

  _walkSymbols(node, source, symbols, parentName) {
    for (const child of node.children) {
      if (child.type === 'class_declaration') {
        this._extractClass(child, source, symbols, parentName, 'class');
      } else if (child.type === 'interface_declaration') {
        this._extractClass(child, source, symbols, parentName, 'interface');
      } else if (child.type === 'enum_declaration') {
        this._extractEnum(child, source, symbols, parentName);
      } else if (child.type === 'record_declaration') {
        this._extractClass(child, source, symbols, parentName, 'class');
      } else if (child.type === 'annotation_type_declaration') {
        this._extractClass(child, source, symbols, parentName, 'interface');
      } else if (child.type === 'method_declaration') {
        this._extractMethod(child, source, symbols, parentName);
      } else if (child.type === 'constructor_declaration') {
        this._extractConstructor(child, source, symbols, parentName);
      } else if (child.type === 'field_declaration') {
        this._extractField(child, source, symbols, parentName);
      } else if (child.type === 'package_declaration') {
        this._extractPackage(child, source, symbols);
      }
    }
  }

  _extractClass(node, source, symbols, parentName, kind = 'class') {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._getVisibility(node, source);
    const annotations = this._getAnnotations(node, source);
    const qualified = parentName ? `${parentName}.${name}` : name;

    let sig = `${kind} ${name}`;
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

    symbols.push(this.makeSymbol(name, kind,
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) this._walkSymbols(body, source, symbols, qualified);
  }

  _extractEnum(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._getVisibility(node, source);
    const qualified = parentName ? `${parentName}.${name}` : name;

    symbols.push(this.makeSymbol(name, 'enum',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: `enum ${name}`,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        if (child.type === 'enum_constant') {
          const cn = child.childForFieldName('name');
          if (cn) {
            const constName = this.nodeText(cn, source);
            symbols.push(this.makeSymbol(constName, 'constant',
              child.startPosition.row + 1, child.endPosition.row + 1, {
                qualifiedName: `${qualified}.${constName}`,
                parentName: qualified,
                visibility: vis,
                isExported: vis === 'public',
              }));
          }
        } else if (child.type === 'enum_body_declarations') {
          this._walkSymbols(child, source, symbols, qualified);
        }
      }
    }
  }

  _extractMethod(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._getVisibility(node, source);
    const annotations = this._getAnnotations(node, source);
    const retType = node.childForFieldName('type');
    const params = node.childForFieldName('parameters');
    const typeParams = node.childForFieldName('type_parameters');

    let sig = '';
    if (typeParams) sig += this.nodeText(typeParams, source) + ' ';
    if (retType) sig += this.nodeText(retType, source) + ' ';
    sig += `${name}(${this.paramsText(params, source)})`;

    for (const child of node.children) {
      if (child.type === 'throws') sig += ` ${this.nodeText(child, source)}`;
    }
    if (this._hasModifier(node, source, 'static')) sig = 'static ' + sig;
    if (annotations.length) sig = annotations.join('\n') + '\n' + sig;

    const qualified = parentName ? `${parentName}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'method',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));
  }

  _extractConstructor(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._getVisibility(node, source);
    const params = node.childForFieldName('parameters');

    const qualified = parentName ? `${parentName}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'constructor',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: `${name}(${this.paramsText(params, source)})`,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));
  }

  _extractField(node, source, symbols, parentName) {
    const vis = this._getVisibility(node, source);
    const typeNode = node.childForFieldName('type');
    const typeText = typeNode ? this.nodeText(typeNode, source) : '';
    const isStatic = this._hasModifier(node, source, 'static');
    const isFinal = this._hasModifier(node, source, 'final');

    for (const child of node.children) {
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = this.nodeText(nameNode, source);
          const kind = (isStatic && isFinal) ? 'constant' : 'field';
          let sig = `${typeText} ${name}`;
          if (isStatic) sig = 'static ' + sig;
          if (isFinal) sig = 'final ' + sig;

          const qualified = parentName ? `${parentName}.${name}` : name;
          symbols.push(this.makeSymbol(name, kind,
            node.startPosition.row + 1, node.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              visibility: vis,
              isExported: vis === 'public',
              parentName,
            }));
        }
      }
    }
  }

  _collectTypeRefs(node, source, kind, line, sourceName) {
    for (const child of node.children) {
      if (child.type === 'type_identifier') {
        this._pendingInherits.push(this.makeReference(
          this.nodeText(child, source), kind, line, { sourceName }));
      } else {
        this._collectTypeRefs(child, source, kind, line, sourceName);
      }
    }
  }

  _extractPackage(node, source, symbols) {
    for (const child of node.children) {
      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        const name = this.nodeText(child, source);
        symbols.push(this.makeSymbol(name, 'module',
          node.startPosition.row + 1, node.endPosition.row + 1, {
            signature: `package ${name}`,
            isExported: true,
          }));
        break;
      }
    }
  }

  // ---- Reference extraction ----

  _walkRefs(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'import_declaration') {
        this._extractImport(child, source, refs, scopeName);
      } else if (child.type === 'method_invocation') {
        this._extractMethodCall(child, source, refs, scopeName);
      } else if (child.type === 'object_creation_expression') {
        this._extractNew(child, source, refs, scopeName);
      } else {
        let newScope = scopeName;
        if (['class_declaration', 'interface_declaration', 'enum_declaration'].includes(child.type)) {
          const n = child.childForFieldName('name');
          if (n) {
            const cname = this.nodeText(n, source);
            newScope = scopeName ? `${scopeName}.${cname}` : cname;
          }
        } else if (child.type === 'method_declaration' || child.type === 'constructor_declaration') {
          const n = child.childForFieldName('name');
          if (n) {
            const mname = this.nodeText(n, source);
            newScope = scopeName ? `${scopeName}.${mname}` : mname;
          }
        }
        this._walkRefs(child, source, refs, newScope);
      }
    }
  }

  _extractImport(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        const path = this.nodeText(child, source);
        const target = path.includes('.') ? path.split('.').pop() : path;
        refs.push(this.makeReference(target, 'import',
          node.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
        break;
      }
    }
  }

  _extractMethodCall(node, source, refs, scopeName) {
    const nameNode = node.childForFieldName('name');
    const objNode = node.childForFieldName('object');
    if (!nameNode) return;
    let name = this.nodeText(nameNode, source);
    if (objNode) name = `${this.nodeText(objNode, source)}.${name}`;

    refs.push(this.makeReference(name, 'call',
      node.startPosition.row + 1, { sourceName: scopeName }));
    const args = node.childForFieldName('arguments');
    if (args) this._walkRefs(args, source, refs, scopeName);
  }

  _extractNew(node, source, refs, scopeName) {
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      refs.push(this.makeReference(this.nodeText(typeNode, source), 'call',
        node.startPosition.row + 1, { sourceName: scopeName }));
    }
    const args = node.childForFieldName('arguments');
    if (args) this._walkRefs(args, source, refs, scopeName);
  }
}
