/**
 * Import and call resolution into graph edges.
 */

import { dirname } from 'node:path';

/**
 * Resolve references to concrete symbol edges.
 * @param {object[]} references
 * @param {Map<string, object[]>} symbolsByName - name -> list of symbol dicts
 * @param {Map<string, number>} filesByPath - file path -> file_id
 * @returns {object[]} edge dicts with source_id, target_id, kind, line
 */
export function resolveReferences(references, symbolsByName, filesByPath) {
  // qualified_name -> list of symbols
  const symbolsByQualified = new Map();
  for (const [, symList] of symbolsByName) {
    for (const sym of symList) {
      const qn = sym.qualified_name;
      if (qn) {
        if (!symbolsByQualified.has(qn)) symbolsByQualified.set(qn, []);
        symbolsByQualified.get(qn).push(sym);
      }
    }
  }

  // Case-insensitive fallback index
  const symbolsByNameLower = new Map();
  for (const [name, symList] of symbolsByName) {
    const lower = name.toLowerCase();
    if (!symbolsByNameLower.has(lower)) symbolsByNameLower.set(lower, []);
    symbolsByNameLower.get(lower).push(...symList);
  }

  // Build import map: (source_file + imported_name) -> import_path
  const importMap = new Map();
  for (const ref of references) {
    if (ref.kind === 'import' && ref.import_path) {
      const key = `${ref.source_file || ''}\0${ref.target_name || ''}`;
      if (ref.source_file && ref.target_name) {
        importMap.set(key, ref.import_path);
      }
    }
  }

  // Build file -> sorted symbols map for closest-symbol fallback
  const fileSymbols = new Map();
  for (const [, symList] of symbolsByName) {
    for (const sym of symList) {
      const fp = sym.file_path || '';
      if (fp) {
        if (!fileSymbols.has(fp)) fileSymbols.set(fp, []);
        fileSymbols.get(fp).push(sym);
      }
    }
  }
  for (const [fp, syms] of fileSymbols) {
    syms.sort((a, b) => (a.line_start || 0) - (b.line_start || 0));
  }

  const edges = [];
  const seen = new Set();

  for (const ref of references) {
    const sourceName = ref.source_name || '';
    const targetName = ref.target_name || '';
    const kind = ref.kind || 'call';
    const line = ref.line;
    const sourceFile = ref.source_file || '';

    if (!targetName) continue;

    // Find source symbol (the caller)
    let sourceSym = bestMatch(sourceName, sourceFile, symbolsByName);
    if (!sourceSym) {
      sourceSym = closestSymbol(sourceFile, line, fileSymbols);
    }
    if (!sourceSym) continue;

    // Extract parent context for disambiguation
    let sourceParent = '';
    const srcQn = sourceSym.qualified_name || '';
    if (srcQn.includes('::')) {
      sourceParent = srcQn.slice(0, srcQn.lastIndexOf('::'));
    } else if (srcQn.includes('.')) {
      sourceParent = srcQn.slice(0, srcQn.lastIndexOf('.'));
    }

    let targetSym = null;

    // Standard resolution
    // 1. Try qualified name exact match
    const qnMatches = symbolsByQualified.get(targetName) || [];
    if (qnMatches.length === 1) {
      targetSym = qnMatches[0];
    } else if (qnMatches.length > 1) {
      targetSym = bestMatch(targetName, sourceFile, symbolsByName, kind, sourceParent, importMap);
    }

    // Prefer local symbol if qualified match is in different file
    if (targetSym && targetSym.file_path !== sourceFile) {
      const candidates = symbolsByName.get(targetName) || [];
      const sameFile = candidates.find(c => c.file_path === sourceFile);
      if (sameFile) {
        targetSym = sameFile;
      } else {
        const sourceDir = sourceFile ? dirname(sourceFile) : '';
        if (sourceDir && dirname(targetSym.file_path || '') !== sourceDir) {
          const sameDir = candidates.find(c => dirname(c.file_path || '') === sourceDir);
          if (sameDir) targetSym = sameDir;
        }
      }
    }

    // 2. Try by simple name
    if (!targetSym) {
      targetSym = bestMatch(targetName, sourceFile, symbolsByName, kind, sourceParent, importMap);
    }

    // 3. Case-insensitive fallback
    if (!targetSym) {
      targetSym = bestMatch(targetName.toLowerCase(), sourceFile, symbolsByNameLower, kind, sourceParent, importMap);
    }

    if (!targetSym) continue;

    const sourceId = sourceSym.id;
    const targetId = targetSym.id;
    if (sourceId === targetId) continue;

    const edgeKey = `${sourceId}:${targetId}:${kind}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);

    edges.push({ source_id: sourceId, target_id: targetId, kind, line });
  }

  return edges;
}

function matchImportPath(importPath, candidates) {
  if (!importPath) return [];

  let normalized = importPath.replace(/\\/g, '/');
  if (normalized.startsWith('@/')) normalized = 'src/' + normalized.slice(2);
  else if (normalized.startsWith('./')) normalized = normalized.slice(2);

  for (const ext of ['.ts', '.js', '.vue', '.tsx', '.jsx', '.py', '.prg', '.scx']) {
    if (normalized.endsWith(ext)) {
      normalized = normalized.slice(0, -ext.length);
      break;
    }
  }

  const matched = [];
  for (const cand of candidates) {
    let fp = (cand.file_path || '').replace(/\\/g, '/');
    let fpNoExt = fp;
    for (const ext of ['.ts', '.js', '.vue', '.tsx', '.jsx', '.py', '.prg', '.scx']) {
      if (fpNoExt.endsWith(ext)) {
        fpNoExt = fpNoExt.slice(0, -ext.length);
        break;
      }
    }

    if (fpNoExt.endsWith('/' + normalized) || fpNoExt === normalized) {
      matched.push(cand);
    } else if (fp.startsWith(normalized + '/') || fp.includes('/' + normalized + '/')) {
      matched.push(cand);
    }
  }
  return matched;
}

function bestMatch(name, sourceFile, symbolsByName, refKind = '', sourceParent = '', importMap = null) {
  const candidates = symbolsByName.get(name) || [];
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  // For call references with uppercase name, prefer class (constructor call)
  if (refKind === 'call' && name && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
    const classCands = candidates.filter(c => c.kind === 'class');
    if (classCands.length) {
      const sf = classCands.find(c => c.file_path === sourceFile);
      if (sf) return sf;
      const sourceDir = sourceFile ? dirname(sourceFile) : '';
      const sd = classCands.find(c => dirname(c.file_path || '') === sourceDir);
      if (sd) return sd;
      return classCands[0];
    }
  }

  // Prefer same file
  const sameFile = candidates.filter(s => s.file_path === sourceFile);
  if (sameFile.length === 1) return sameFile[0];
  if (sameFile.length > 1) {
    if (sourceParent) {
      for (const s of sameFile) {
        const qn = s.qualified_name || '';
        if (qn.startsWith(sourceParent + '::') || qn.startsWith(sourceParent + '.')) {
          return s;
        }
      }
    }
    return sameFile[0];
  }

  // Prefer same directory
  const sourceDir = sourceFile ? dirname(sourceFile) : '';
  const sameDir = candidates.filter(s => dirname(s.file_path || '') === sourceDir);
  if (sameDir.length) {
    const exported = sameDir.filter(s => s.is_exported);
    return exported.length ? exported[0] : sameDir[0];
  }

  // Import-aware resolution
  if (importMap) {
    const key = `${sourceFile}\0${name}`;
    const impPath = importMap.get(key);
    if (impPath) {
      const importMatched = matchImportPath(impPath, candidates);
      if (importMatched.length) {
        const exported = importMatched.filter(s => s.is_exported);
        return exported.length ? exported[0] : importMatched[0];
      }
    }
  }

  // Fall back: prefer exported
  const exported = candidates.filter(s => s.is_exported);
  return exported.length ? exported[0] : candidates[0];
}

function closestSymbol(sourceFile, refLine, fileSymbols) {
  const syms = fileSymbols.get(sourceFile);
  if (!syms || !syms.length) return null;
  if (refLine == null) return syms[0];

  // Prefer symbol that contains the reference line
  let containing = null;
  for (const sym of syms) {
    const ls = sym.line_start || 0;
    const le = sym.line_end || 0;
    if (ls <= refLine && le >= refLine && le > 0) {
      containing = sym;
    }
  }
  if (containing) return containing;

  return syms[0];
}

/**
 * Aggregate symbol-level edges into file-level edges.
 * @param {object[]} symbolEdges
 * @param {Map<number, object>} symbols - symbol_id -> symbol dict
 * @returns {object[]}
 */
export function buildFileEdges(symbolEdges, symbols) {
  const counts = new Map();

  for (const edge of symbolEdges) {
    const srcSym = symbols.get(edge.source_id);
    const tgtSym = symbols.get(edge.target_id);
    if (!srcSym || !tgtSym) continue;

    const srcFid = srcSym.file_id;
    const tgtFid = tgtSym.file_id;
    if (srcFid === tgtFid) continue;

    const key = `${srcFid}:${tgtFid}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const result = [];
  for (const [key, count] of counts) {
    const [src, tgt] = key.split(':').map(Number);
    result.push({ source_file_id: src, target_file_id: tgt, kind: 'imports', symbol_count: count });
  }
  return result;
}
