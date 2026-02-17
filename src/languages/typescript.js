/**
 * TypeScript extractor extending JavaScript with TS-specific constructs.
 */

import { JavaScriptExtractor } from './javascript.js';

export class TypeScriptExtractor extends JavaScriptExtractor {
  get languageName() { return 'typescript'; }
  get fileExtensions() { return ['.ts', '.tsx', '.mts', '.cts']; }

  _walkSymbols(node, source, filePath, symbols, parentName, isExported) {
    for (const child of node.children) {
      const exported = isExported || this._isExportNode(child);

      if (child.type === 'function_declaration') {
        this._extractFunction(child, source, symbols, parentName, exported);
      } else if (child.type === 'generator_function_declaration') {
        this._extractFunction(child, source, symbols, parentName, exported, true);
      } else if (child.type === 'class_declaration') {
        this._extractClass(child, source, filePath, symbols, parentName, exported);
      } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
        this._extractVariableDecl(child, source, filePath, symbols, parentName, exported);
      } else if (child.type === 'export_statement') {
        this._walkSymbols(child, source, filePath, symbols, parentName, true);
      } else if (child.type === 'interface_declaration') {
        this._extractInterface(child, source, symbols, parentName, exported);
      } else if (child.type === 'type_alias_declaration') {
        this._extractTypeAlias(child, source, symbols, parentName, exported);
      } else if (child.type === 'enum_declaration') {
        this._extractEnum(child, source, symbols, parentName, exported);
      } else if (child.type === 'abstract_class_declaration') {
        this._extractClass(child, source, filePath, symbols, parentName, exported);
      } else if (child.type === 'expression_statement') {
        this._extractModuleExports(child, source, symbols, parentName);
      } else {
        this._walkSymbols(child, source, filePath, symbols, parentName, isExported);
      }
    }
  }

  _extractInterface(node, source, symbols, parentName, isExported) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    let sig = `interface ${name}`;

    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) sig += this.nodeText(typeParams, source);

    for (const child of node.children) {
      if (child.type === 'extends_type_clause') {
        sig += ` ${this.nodeText(child, source)}`;
        break;
      }
    }

    const qualified = parentName ? `${parentName}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'interface',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        isExported,
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) this._extractInterfaceMembers(body, source, symbols, qualified);
  }

  _extractInterfaceMembers(bodyNode, source, symbols, interfaceName) {
    for (const child of bodyNode.children) {
      if (child.type === 'property_signature' || child.type === 'method_signature') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) continue;
        const name = this.nodeText(nameNode, source);
        const qualified = `${interfaceName}.${name}`;

        if (child.type === 'method_signature') {
          const params = child.childForFieldName('parameters');
          let sig = `${name}(${this.paramsText(params, source)})`;
          const ret = child.childForFieldName('return_type');
          if (ret) sig += `: ${this.nodeText(ret, source)}`;
          symbols.push(this.makeSymbol(name, 'method',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              parentName: interfaceName,
            }));
        } else {
          const typeAnn = child.childForFieldName('type');
          let sig = name;
          if (typeAnn) sig += `: ${this.nodeText(typeAnn, source)}`;
          symbols.push(this.makeSymbol(name, 'property',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              parentName: interfaceName,
            }));
        }
      }
    }
  }

  _extractTypeAlias(node, source, symbols, parentName, isExported) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    let sig = `type ${name}`;

    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) sig += this.nodeText(typeParams, source);

    const value = node.childForFieldName('value');
    if (value) {
      const valText = this.nodeText(value, source);
      if (valText.length <= 80) sig += ` = ${valText}`;
    }

    const qualified = parentName ? `${parentName}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'type_alias',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        isExported,
        parentName,
      }));
  }

  _extractEnum(node, source, symbols, parentName, isExported) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);

    const isConst = node.children.some(child =>
      child !== nameNode && child !== node.childForFieldName('body') &&
      (child.type === 'const' || this.nodeText(child, source) === 'const')
    );
    const sig = `${isConst ? 'const ' : ''}enum ${name}`;

    const qualified = parentName ? `${parentName}.${name}` : name;
    symbols.push(this.makeSymbol(name, 'enum',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        isExported,
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        let memName = null;
        if (child.type === 'property_identifier') {
          memName = this.nodeText(child, source);
        } else if (child.type === 'enum_assignment') {
          const n = child.childForFieldName('name');
          if (n) memName = this.nodeText(n, source);
        }
        if (memName) {
          symbols.push(this.makeSymbol(memName, 'field',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: `${qualified}.${memName}`,
              parentName: qualified,
            }));
        }
      }
    }
  }

  _extractFunction(node, source, symbols, parentName, isExported, generator = false) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const params = node.childForFieldName('parameters');
    const prefix = generator ? 'function*' : 'function';
    let sig = `${prefix} ${name}(${this.paramsText(params, source)})`;

    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      sig = `${prefix} ${name}${this.nodeText(typeParams, source)}(${this.paramsText(params, source)})`;
    }

    const ret = node.childForFieldName('return_type');
    if (ret) sig += `: ${this.nodeText(ret, source)}`;

    const decorators = this._getTsDecorators(node, source);
    if (decorators.length) sig = decorators.join('\n') + '\n' + sig;

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

  _getTsDecorators(node, source) {
    const decorators = [];
    for (const child of node.children) {
      if (child.type === 'decorator') decorators.push(this.nodeText(child, source));
    }
    return decorators;
  }

  _extractClassMembers(bodyNode, source, symbols, className) {
    for (const child of bodyNode.children) {
      if (['method_definition', 'public_field_definition', 'field_definition',
        'method_signature', 'property_signature'].includes(child.type)) {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) continue;
        const name = this.nodeText(nameNode, source);
        const qualified = `${className}.${name}`;

        let visibility = 'public';
        for (const sub of child.children) {
          const text = this.nodeText(sub, source);
          if (['private', 'protected', 'public'].includes(text)) {
            visibility = text;
            break;
          }
        }

        if (child.type === 'method_definition' || child.type === 'method_signature') {
          const params = child.childForFieldName('parameters');
          let sig = `${name}(${this.paramsText(params, source)})`;
          const ret = child.childForFieldName('return_type');
          if (ret) sig += `: ${this.nodeText(ret, source)}`;

          const decorators = this._getTsDecorators(child, source);
          if (decorators.length) sig = decorators.join('\n') + '\n' + sig;

          const kind = name === 'constructor' ? 'constructor' : 'method';
          symbols.push(this.makeSymbol(name, kind,
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              docstring: this.getDocstring(child, source),
              visibility,
              parentName: className,
            }));
        } else {
          const typeAnn = child.childForFieldName('type');
          let sig = name;
          if (typeAnn) sig += `: ${this.nodeText(typeAnn, source)}`;
          symbols.push(this.makeSymbol(name, 'property',
            child.startPosition.row + 1, child.endPosition.row + 1, {
              qualifiedName: qualified,
              signature: sig,
              visibility,
              parentName: className,
            }));
        }
      }
    }
  }
}
