/**
 * Rust symbol and reference extractor.
 */

import { LanguageExtractor } from './base.js';

export class RustExtractor extends LanguageExtractor {
  get languageName() { return 'rust'; }
  get fileExtensions() { return ['.rs']; }

  extractSymbols(tree, source, filePath) {
    const symbols = [];
    this._walkSymbols(tree.rootNode, source, symbols, null);
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
    while (prev && (prev.type === 'line_comment' || prev.type === 'block_comment')) {
      let text = this.nodeText(prev, source).trim();
      if (text.startsWith('///') || text.startsWith('//!')) {
        comments.unshift(text.slice(3).trim());
      } else if (text.startsWith('/**')) {
        text = text.slice(3);
        if (text.endsWith('*/')) text = text.slice(0, -2);
        comments.unshift(text.trim());
      } else {
        break;
      }
      prev = prev.previousSibling;
    }
    return comments.length ? comments.join('\n') : null;
  }

  _visibility(node, source) {
    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        const text = this.nodeText(child, source);
        if (text.includes('crate')) return 'public';
        if (text.includes('super')) return 'private';
        return 'public';
      }
    }
    return 'private';
  }

  _isPub(node, source) {
    return this._visibility(node, source) === 'public';
  }

  // ---- Symbol extraction ----

  _walkSymbols(node, source, symbols, parentName) {
    for (const child of node.children) {
      if (child.type === 'function_item') this._extractFunction(child, source, symbols, parentName);
      else if (child.type === 'struct_item') this._extractStruct(child, source, symbols, parentName);
      else if (child.type === 'enum_item') this._extractEnum(child, source, symbols, parentName);
      else if (child.type === 'trait_item') this._extractTrait(child, source, symbols, parentName);
      else if (child.type === 'impl_item') this._extractImpl(child, source, symbols, parentName);
      else if (child.type === 'mod_item') this._extractMod(child, source, symbols, parentName);
      else if (child.type === 'type_item') this._extractTypeAlias(child, source, symbols, parentName);
      else if (child.type === 'const_item') this._extractConst(child, source, symbols, parentName);
      else if (child.type === 'static_item') this._extractStatic(child, source, symbols, parentName);
      else if (child.type === 'macro_definition') this._extractMacro(child, source, symbols, parentName);
    }
  }

  _extractFunction(node, source, symbols, parentName, kind = 'function') {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const params = node.childForFieldName('parameters');
    const typeParams = node.childForFieldName('type_parameters');
    const ret = node.childForFieldName('return_type');
    const vis = this._visibility(node, source);

    let sig;
    if (typeParams) {
      sig = `fn ${name}${this.nodeText(typeParams, source)}(${params ? this.nodeText(params, source) : ''})`;
    } else {
      sig = `fn ${name}(${params ? this.nodeText(params, source) : ''})`;
    }
    if (ret) sig += ` -> ${this.nodeText(ret, source)}`;
    if (vis === 'public') sig = `pub ${sig}`;

    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, kind,
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: this._isPub(node, source),
        parentName,
      }));
  }

  _extractStruct(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._visibility(node, source);
    let sig = `${vis === 'public' ? 'pub ' : ''}struct ${name}`;
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) sig += this.nodeText(typeParams, source);

    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, 'struct',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        if (child.type === 'field_declaration') {
          const fn = child.childForFieldName('name');
          if (fn) {
            const fieldName = this.nodeText(fn, source);
            const ftype = child.childForFieldName('type');
            let fsig = fieldName;
            if (ftype) fsig += `: ${this.nodeText(ftype, source)}`;
            const fvis = this._visibility(child, source);
            symbols.push(this.makeSymbol(fieldName, 'field',
              child.startPosition.row + 1, child.endPosition.row + 1, {
                qualifiedName: `${qualified}::${fieldName}`,
                signature: fsig,
                visibility: fvis,
                isExported: fvis === 'public',
                parentName: qualified,
              }));
          }
        }
      }
    }
  }

  _extractEnum(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._visibility(node, source);
    let sig = `${vis === 'public' ? 'pub ' : ''}enum ${name}`;
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) sig += this.nodeText(typeParams, source);

    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, 'enum',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        if (child.type === 'enum_variant') {
          const vn = child.childForFieldName('name');
          if (vn) {
            const variantName = this.nodeText(vn, source);
            symbols.push(this.makeSymbol(variantName, 'field',
              child.startPosition.row + 1, child.endPosition.row + 1, {
                qualifiedName: `${qualified}::${variantName}`,
                parentName: qualified,
                visibility: vis,
                isExported: vis === 'public',
              }));
          }
        }
      }
    }
  }

  _extractTrait(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._visibility(node, source);
    let sig = `${vis === 'public' ? 'pub ' : ''}trait ${name}`;
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) sig += this.nodeText(typeParams, source);

    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, 'trait',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        docstring: this.getDocstring(node, source),
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        if (child.type === 'function_item') {
          this._extractFunction(child, source, symbols, qualified, 'method');
        } else if (child.type === 'function_signature_item') {
          this._extractFnSignature(child, source, symbols, qualified);
        }
      }
    }
  }

  _extractFnSignature(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const params = node.childForFieldName('parameters');
    let sig = `fn ${name}(${params ? this.nodeText(params, source) : ''})`;
    const ret = node.childForFieldName('return_type');
    if (ret) sig += ` -> ${this.nodeText(ret, source)}`;

    symbols.push(this.makeSymbol(name, 'method',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: `${parentName}::${name}`,
        signature: sig,
        docstring: this.getDocstring(node, source),
        parentName,
      }));
  }

  _extractImpl(node, source, symbols, parentName) {
    const typeNode = node.childForFieldName('type');
    const traitNode = node.childForFieldName('trait');
    if (!typeNode) return;

    const typeName = this.nodeText(typeNode, source);
    const implName = traitNode ? `${typeName}::${this.nodeText(traitNode, source)}` : typeName;

    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        if (child.type === 'function_item') {
          this._extractFunction(child, source, symbols, implName, 'method');
        } else if (child.type === 'type_item') {
          this._extractTypeAlias(child, source, symbols, implName);
        } else if (child.type === 'const_item') {
          this._extractConst(child, source, symbols, implName);
        }
      }
    }
  }

  _extractMod(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._visibility(node, source);
    const qualified = parentName ? `${parentName}::${name}` : name;

    symbols.push(this.makeSymbol(name, 'module',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: `${vis === 'public' ? 'pub ' : ''}mod ${name}`,
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));

    const body = node.childForFieldName('body');
    if (body) this._walkSymbols(body, source, symbols, qualified);
  }

  _extractTypeAlias(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._visibility(node, source);
    let sig = `${vis === 'public' ? 'pub ' : ''}type ${name}`;
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) sig += this.nodeText(typeParams, source);
    const value = node.childForFieldName('type');
    if (value) {
      const valText = this.nodeText(value, source);
      if (valText.length <= 60) sig += ` = ${valText}`;
    }

    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, 'type_alias',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));
  }

  _extractConst(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._visibility(node, source);
    const typeN = node.childForFieldName('type');
    let sig = `${vis === 'public' ? 'pub ' : ''}const ${name}`;
    if (typeN) sig += `: ${this.nodeText(typeN, source)}`;

    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, 'constant',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));
  }

  _extractStatic(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const vis = this._visibility(node, source);
    const typeN = node.childForFieldName('type');
    let sig = `${vis === 'public' ? 'pub ' : ''}static ${name}`;
    if (typeN) sig += `: ${this.nodeText(typeN, source)}`;

    const qualified = parentName ? `${parentName}::${name}` : name;
    symbols.push(this.makeSymbol(name, 'variable',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: sig,
        visibility: vis,
        isExported: vis === 'public',
        parentName,
      }));
  }

  _extractMacro(node, source, symbols, parentName) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = this.nodeText(nameNode, source);
    const qualified = parentName ? `${parentName}::${name}` : name;

    symbols.push(this.makeSymbol(name, 'function',
      node.startPosition.row + 1, node.endPosition.row + 1, {
        qualifiedName: qualified,
        signature: `macro_rules! ${name}`,
        docstring: this.getDocstring(node, source),
        isExported: true,
        parentName,
      }));
  }

  // ---- Reference extraction ----

  _walkRefs(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (child.type === 'use_declaration') {
        this._extractUse(child, source, refs, scopeName);
      } else if (child.type === 'call_expression') {
        this._extractCall(child, source, refs, scopeName);
      } else if (child.type === 'macro_invocation') {
        this._extractMacroCall(child, source, refs, scopeName);
      } else {
        let newScope = scopeName;
        if (child.type === 'function_item') {
          const n = child.childForFieldName('name');
          if (n) {
            const fname = this.nodeText(n, source);
            newScope = scopeName ? `${scopeName}::${fname}` : fname;
          }
        } else if (child.type === 'impl_item') {
          const t = child.childForFieldName('type');
          if (t) newScope = this.nodeText(t, source);
        }
        this._walkRefs(child, source, refs, newScope);
      }
    }
  }

  _extractUse(node, source, refs, scopeName) {
    for (const child of node.children) {
      if (['use_as_clause', 'use_list', 'scoped_use_list',
        'scoped_identifier', 'identifier', 'use_wildcard'].includes(child.type)) {
        const path = this.nodeText(child, source);
        let target = path.includes('::') ? path.split('::').pop() : path;
        target = target.replace(/[{}*,\s]/g, '');
        if (target) {
          refs.push(this.makeReference(target, 'import',
            node.startPosition.row + 1, { sourceName: scopeName, importPath: path }));
        }
      }
    }
  }

  _extractCall(node, source, refs, scopeName) {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    let name;
    if (funcNode.type === 'field_expression') {
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

  _extractMacroCall(node, source, refs, scopeName) {
    let macroNode = node.childForFieldName('macro');
    if (!macroNode) {
      for (const child of node.children) {
        if (child.type === 'identifier' || child.type === 'scoped_identifier') {
          macroNode = child;
          break;
        }
      }
    }
    if (macroNode) {
      const name = this.nodeText(macroNode, source);
      refs.push(this.makeReference(`${name}!`, 'call',
        node.startPosition.row + 1, { sourceName: scopeName }));
    }
  }
}
