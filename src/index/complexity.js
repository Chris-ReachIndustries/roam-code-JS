/**
 * Per-symbol cognitive complexity analysis using tree-sitter ASTs.
 *
 * Computes: cognitive_complexity, nesting_depth, param_count, line_count,
 * return_count, bool_op_count, callback_depth, cyclomatic_density,
 * halstead_volume/difficulty/effort/bugs.
 */

// Control flow nodes that increment complexity AND increase nesting
const _CONTROL_FLOW = new Set([
  'if_statement', 'for_statement', 'while_statement',
  'try_statement', 'except_clause', 'with_statement',
  'match_statement',
  'for_in_statement', 'do_statement', 'switch_statement',
  'catch_clause',
  'enhanced_for_statement', 'foreach_statement',
  'if_expression', 'match_expression',
  'conditional_expression', 'ternary_expression',
]);

// Continuation nodes: +1 flat, NO nesting increment
const _CONTINUATION_FLOW = new Set([
  'elif_clause', 'else_clause',
  'case_clause',
  'switch_case',
  'match_arm',
]);

const _FLOW_BREAK = new Set([
  'break_statement', 'continue_statement', 'goto_statement',
]);

const _BOOL_OPS = new Set(['boolean_operator', 'binary_expression']);
const _BOOL_OP_TOKENS = new Set(['&&', '||', 'and', 'or', '??']);

const _RETURN_NODES = new Set([
  'return_statement', 'throw_statement', 'raise_statement',
  'yield', 'yield_statement',
]);

const _FUNCTION_NODES = new Set([
  'function_definition', 'function_declaration',
  'method_definition', 'method_declaration',
  'arrow_function', 'lambda', 'lambda_expression',
  'anonymous_function', 'closure_expression',
  'function_expression', 'generator_function_declaration',
]);

const _PARAM_NODES = new Set([
  'parameters', 'formal_parameters', 'parameter_list',
  'function_parameters', 'type_parameters',
]);

function _countParams(node) {
  for (const child of node.children) {
    if (_PARAM_NODES.has(child.type)) {
      let count = 0;
      for (const p of child.children) {
        if (p.isNamed && !['(', ')', ',', 'comment', 'block_comment',
          'type_annotation', 'type'].includes(p.type)) {
          count++;
        }
      }
      return count;
    }
  }
  return 0;
}

function _walkComplexity(node, source, depth = 0) {
  const result = { cognitive: 0, nesting: 0, returns: 0, boolOps: 0, callbackDepth: 0 };
  const ntype = node.type;

  if (_CONTROL_FLOW.has(ntype)) {
    result.cognitive += 1 + Math.floor(depth * (depth + 1) / 2);
    result.nesting = Math.max(result.nesting, depth + 1);
    for (const child of node.children) {
      const cr = _walkComplexity(child, source, depth + 1);
      _merge(result, cr);
    }
    return result;
  }

  if (_CONTINUATION_FLOW.has(ntype)) {
    result.cognitive += 1;
    for (const child of node.children) {
      const cr = _walkComplexity(child, source, depth);
      _merge(result, cr);
    }
    return result;
  }

  if (_FLOW_BREAK.has(ntype)) {
    result.cognitive += 1;
    return result;
  }

  if (_RETURN_NODES.has(ntype)) result.returns += 1;

  // Boolean operators
  if (ntype === 'boolean_operator') {
    result.boolOps += 1;
    result.cognitive += 1;
  } else if (ntype === 'binary_expression') {
    for (const child of node.children) {
      if (!child.isNamed) {
        const opText = source.slice(child.startIndex, child.endIndex);
        if (_BOOL_OP_TOKENS.has(opText)) {
          result.boolOps += 1;
          result.cognitive += 1;
          break;
        }
      }
    }
  }

  // Nested function/lambda
  if (_FUNCTION_NODES.has(ntype) && depth > 0) {
    result.callbackDepth = Math.max(result.callbackDepth, 1);
    for (const child of node.children) {
      const cr = _walkComplexity(child, source, depth + 1);
      _merge(result, cr);
      result.callbackDepth = Math.max(result.callbackDepth, cr.callbackDepth + 1);
    }
    return result;
  }

  for (const child of node.children) {
    const cr = _walkComplexity(child, source, depth);
    _merge(result, cr);
  }
  return result;
}

function _merge(target, src) {
  target.cognitive += src.cognitive;
  target.nesting = Math.max(target.nesting, src.nesting);
  target.returns += src.returns;
  target.boolOps += src.boolOps;
  target.callbackDepth = Math.max(target.callbackDepth, src.callbackDepth);
}

// ---- Halstead metrics ----

const _OPERATOR_TYPES = new Set([
  'if_statement', 'for_statement', 'while_statement', 'do_statement',
  'switch_statement', 'try_statement', 'catch_clause', 'return_statement',
  'throw_statement', 'raise_statement', 'break_statement', 'continue_statement',
  'for_in_statement', 'match_statement', 'match_expression', 'with_statement',
  'conditional_expression', 'ternary_expression', 'assignment_expression',
  'augmented_assignment', 'call_expression', 'new_expression',
  'yield_statement', 'yield',
]);

const _OPERAND_TYPES = new Set([
  'identifier', 'property_identifier', 'shorthand_property_identifier',
  'number', 'integer', 'float', 'string', 'template_string',
  'true', 'false', 'none', 'null', 'undefined',
]);

const _BINOP_PARENT_TYPES = new Set([
  'binary_expression', 'unary_expression', 'assignment_expression',
  'augmented_assignment', 'comparison_operator', 'boolean_operator',
]);

function _computeHalstead(funcNode, source) {
  const operators = new Set();
  const operands = new Set();
  let totalOperators = 0;
  let totalOperands = 0;

  function walk(node) {
    const ntype = node.type;
    if (_OPERATOR_TYPES.has(ntype)) {
      operators.add(ntype);
      totalOperators++;
    } else if (_OPERAND_TYPES.has(ntype)) {
      const text = source.slice(node.startIndex, node.endIndex);
      operands.add(text);
      totalOperands++;
    }

    if (!node.isNamed && node.parent && _BINOP_PARENT_TYPES.has(node.parent.type)) {
      const opText = source.slice(node.startIndex, node.endIndex).trim();
      if (opText) {
        operators.add(opText);
        totalOperators++;
      }
    }

    for (const child of node.children) walk(child);
  }

  walk(funcNode);

  const n1 = operators.size;
  const n2 = operands.size;
  const N = totalOperators + totalOperands;
  const n = n1 + n2;

  if (n <= 0 || n2 <= 0) return { volume: 0, difficulty: 0, effort: 0, bugs: 0 };

  const volume = n > 1 ? Math.round(N * Math.log2(n) * 10) / 10 : 0;
  const difficulty = n2 > 0 ? Math.round((n1 / 2) * (totalOperands / n2) * 10) / 10 : 0;
  const effort = Math.round(difficulty * volume);
  const bugs = Math.round(volume / 3000 * 1000) / 1000;

  return { volume, difficulty, effort, bugs };
}

function _findFunctionNode(tree, lineStart, lineEnd) {
  if (!tree) return null;

  function search(node) {
    const nodeStart = node.startPosition.row + 1;
    const nodeEnd = node.endPosition.row + 1;

    if (_FUNCTION_NODES.has(node.type)) {
      if (Math.abs(nodeStart - lineStart) <= 3 && Math.abs(nodeEnd - lineEnd) <= 1) {
        return node;
      }
    }

    for (const child of node.children) {
      const childStart = child.startPosition.row + 1;
      const childEnd = child.endPosition.row + 1;
      if (childEnd < lineStart - 3 || childStart > lineEnd + 1) continue;
      const found = search(child);
      if (found) return found;
    }
    return null;
  }

  return search(tree.rootNode);
}

export function computeSymbolComplexity(tree, source, lineStart, lineEnd) {
  const funcNode = _findFunctionNode(tree, lineStart, lineEnd);
  if (!funcNode) return _complexityFromSource(source, lineStart, lineEnd);

  const paramCount = _countParams(funcNode);
  const bodyLines = (funcNode.endPosition.row - funcNode.startPosition.row) + 1;
  const metrics = _walkComplexity(funcNode, source, 0);
  const halstead = _computeHalstead(funcNode, source);
  const ccDensity = bodyLines > 0 ? Math.round(metrics.cognitive / bodyLines * 1000) / 1000 : 0;

  return {
    cognitive_complexity: Math.round(metrics.cognitive * 100) / 100,
    nesting_depth: metrics.nesting,
    param_count: paramCount,
    line_count: bodyLines,
    return_count: metrics.returns,
    bool_op_count: metrics.boolOps,
    callback_depth: metrics.callbackDepth,
    cyclomatic_density: ccDensity,
    halstead_volume: halstead.volume,
    halstead_difficulty: halstead.difficulty,
    halstead_effort: halstead.effort,
    halstead_bugs: halstead.bugs,
  };
}

function _complexityFromSource(source, lineStart, lineEnd) {
  const lines = source.split('\n');
  const startIdx = Math.max(0, lineStart - 1);
  const endIdx = Math.min(lines.length, lineEnd);
  const body = lines.slice(startIdx, endIdx);

  let maxIndent = 0;
  let returns = 0;
  let boolOps = 0;

  for (const line of body) {
    const expanded = line.replace(/\t/g, '    ');
    const stripped = expanded.trimStart();
    if (!stripped) continue;
    const indent = Math.floor((expanded.length - stripped.length) / 4);
    maxIndent = Math.max(maxIndent, indent);
    if (/^(return |return;|throw |raise )/.test(stripped)) returns++;
    for (const op of [' and ', ' or ', ' && ', ' || ']) {
      let idx = -1;
      while ((idx = stripped.indexOf(op, idx + 1)) !== -1) boolOps++;
    }
  }

  const lineCount = endIdx - startIdx;
  const cognitive = maxIndent * 2 + boolOps + Math.max(returns - 1, 0);
  const ccDensity = lineCount > 0 ? Math.round(cognitive / lineCount * 1000) / 1000 : 0;

  return {
    cognitive_complexity: Math.round(cognitive * 100) / 100,
    nesting_depth: maxIndent,
    param_count: 0,
    line_count: lineCount,
    return_count: returns,
    bool_op_count: boolOps,
    callback_depth: 0,
    cyclomatic_density: ccDensity,
    halstead_volume: 0, halstead_difficulty: 0, halstead_effort: 0, halstead_bugs: 0,
  };
}

const _CALLABLE_KINDS = new Set([
  'function', 'method', 'generator', 'constructor',
  'property', 'closure', 'lambda',
]);

/**
 * Compute complexity for all functions in a file and store in symbol_metrics.
 */
export function computeAndStore(db, fileId, tree, source) {
  const rows = db.prepare(
    'SELECT id, kind, line_start, line_end FROM symbols WHERE file_id = ?'
  ).all(fileId);

  const batch = [];
  for (const row of rows) {
    if (!_CALLABLE_KINDS.has(row.kind || '')) continue;
    if (row.line_start == null || row.line_end == null) continue;

    const metrics = computeSymbolComplexity(tree, source, row.line_start, row.line_end);
    if (!metrics) continue;

    batch.push([
      row.id,
      metrics.cognitive_complexity, metrics.nesting_depth, metrics.param_count,
      metrics.line_count, metrics.return_count, metrics.bool_op_count,
      metrics.callback_depth, metrics.cyclomatic_density,
      metrics.halstead_volume, metrics.halstead_difficulty,
      metrics.halstead_effort, metrics.halstead_bugs,
    ]);
  }

  if (batch.length) {
    const insert = db.prepare(
      `INSERT OR REPLACE INTO symbol_metrics
       (symbol_id, cognitive_complexity, nesting_depth, param_count,
        line_count, return_count, bool_op_count, callback_depth,
        cyclomatic_density, halstead_volume, halstead_difficulty,
        halstead_effort, halstead_bugs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAll = db.transaction((items) => {
      for (const item of items) insert.run(...item);
    });
    insertAll(batch);
  }
}
