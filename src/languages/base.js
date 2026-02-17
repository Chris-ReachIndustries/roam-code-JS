/**
 * Base class for language-specific symbol extraction.
 */

export class LanguageExtractor {
  /** @returns {string} Language identifier */
  get languageName() { throw new Error('Not implemented'); }

  /** @returns {string[]} File extensions handled */
  get fileExtensions() { throw new Error('Not implemented'); }

  /**
   * Extract symbols from a parsed tree.
   * @param {object} tree - Tree-sitter parse tree
   * @param {string} source - Source code string
   * @param {string} filePath - Relative file path
   * @returns {object[]}
   */
  extractSymbols(tree, source, filePath) { throw new Error('Not implemented'); }

  /**
   * Extract references (imports, calls) from a parsed tree.
   * @param {object} tree
   * @param {string} source
   * @param {string} filePath
   * @returns {object[]}
   */
  extractReferences(tree, source, filePath) { throw new Error('Not implemented'); }

  /**
   * Get a function/class signature (first line, no body).
   */
  getSignature(node, source) {
    const text = this.nodeText(node, source);
    let firstLine = text.split('\n')[0].trimEnd();
    if (firstLine.endsWith('{') || firstLine.endsWith(':')) {
      firstLine = firstLine.slice(0, -1).trimEnd();
    }
    return firstLine || null;
  }

  /**
   * Get docstring if present. Override per language.
   */
  getDocstring(node, source) {
    return null;
  }

  /**
   * Extract text from a tree-sitter node.
   * In Node.js tree-sitter, source is a string and we use startIndex/endIndex.
   */
  nodeText(node, source) {
    if (!node) return '';
    return source.slice(node.startIndex, node.endIndex);
  }

  /**
   * Get parameter list text, stripping outer parens.
   */
  paramsText(node, source) {
    if (!node) return '';
    const text = this.nodeText(node, source);
    if (text.startsWith('(') && text.endsWith(')')) {
      return text.slice(1, -1);
    }
    return text;
  }

  /**
   * Factory method for creating a symbol dict.
   */
  makeSymbol(name, kind, lineStart, lineEnd, {
    qualifiedName = null,
    signature = null,
    docstring = null,
    visibility = 'public',
    isExported = false,
    parentName = null,
    defaultValue = null,
  } = {}) {
    return {
      name,
      qualified_name: qualifiedName || name,
      kind,
      signature,
      line_start: lineStart,
      line_end: lineEnd,
      docstring,
      visibility,
      is_exported: isExported,
      parent_name: parentName,
      default_value: defaultValue,
    };
  }

  /**
   * Factory method for creating a reference dict.
   */
  makeReference(targetName, kind, line, { sourceName = null, importPath = null } = {}) {
    return {
      source_name: sourceName,
      target_name: targetName,
      kind,
      line,
      import_path: importPath,
    };
  }
}
