/**
 * Symbol and reference extraction from tree-sitter ASTs.
 */

/**
 * Extract symbol definitions from a parsed AST.
 * @param {object|null} tree - Tree-sitter parse tree
 * @param {string|null} source - Source code string
 * @param {string} filePath - Relative file path
 * @param {object|null} extractor - Language-specific extractor
 * @returns {object[]}
 */
export function extractSymbols(tree, source, filePath, extractor) {
  if (!extractor || (tree == null && source == null)) return [];
  let symbols;
  try {
    symbols = extractor.extractSymbols(tree, source, filePath);
  } catch {
    return [];
  }

  return symbols.map(sym => ({
    name: sym.name || '',
    qualified_name: sym.qualified_name || sym.name || '',
    kind: sym.kind || 'unknown',
    signature: sym.signature ?? null,
    line_start: sym.line_start ?? null,
    line_end: sym.line_end ?? null,
    docstring: sym.docstring ?? null,
    visibility: sym.visibility || 'public',
    is_exported: sym.is_exported ?? true,
    parent_name: sym.parent_name ?? null,
    default_value: sym.default_value ?? null,
  }));
}

/**
 * Extract references (calls, imports) from a parsed AST.
 * @param {object|null} tree
 * @param {string|null} source
 * @param {string} filePath
 * @param {object|null} extractor
 * @returns {object[]}
 */
export function extractReferences(tree, source, filePath, extractor) {
  if (!extractor || (tree == null && source == null)) return [];
  let refs;
  try {
    refs = extractor.extractReferences(tree, source, filePath);
  } catch {
    return [];
  }

  return refs.map(ref => ({
    source_name: ref.source_name || '',
    target_name: ref.target_name || '',
    kind: ref.kind || 'call',
    line: ref.line ?? null,
    import_path: ref.import_path ?? null,
  }));
}
