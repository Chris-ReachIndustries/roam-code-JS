import { describe, it, expect } from 'vitest';
import { resolveReferences, buildFileEdges } from '../../src/index/relations.js';

describe('resolveReferences', () => {
  const symbols = new Map();
  symbols.set('Calculator', [{
    id: 1, file_id: 1, file_path: 'src/calc.py', name: 'Calculator',
    qualified_name: 'Calculator', kind: 'class', is_exported: true, line_start: 1,
  }]);
  symbols.set('add', [{
    id: 2, file_id: 1, file_path: 'src/calc.py', name: 'add',
    qualified_name: 'Calculator.add', kind: 'method', is_exported: true, line_start: 2,
  }]);
  symbols.set('main', [{
    id: 3, file_id: 2, file_path: 'src/app.js', name: 'main',
    qualified_name: 'main', kind: 'function', is_exported: true, line_start: 1,
  }]);

  const filesByPath = new Map();

  it('resolves exact name match', () => {
    const refs = [{
      source_name: 'main', target_name: 'Calculator', kind: 'call',
      line: 5, source_file: 'src/app.js',
    }];
    const edges = resolveReferences(refs, symbols, filesByPath);
    expect(edges.length).toBe(1);
    expect(edges[0].source_id).toBe(3);
    expect(edges[0].target_id).toBe(1);
    expect(edges[0].kind).toBe('call');
  });

  it('skips references with no matching target', () => {
    const refs = [{
      source_name: 'main', target_name: 'NonExistent', kind: 'call',
      line: 5, source_file: 'src/app.js',
    }];
    const edges = resolveReferences(refs, symbols, filesByPath);
    expect(edges.length).toBe(0);
  });

  it('skips self-references', () => {
    const refs = [{
      source_name: 'Calculator', target_name: 'Calculator', kind: 'call',
      line: 5, source_file: 'src/calc.py',
    }];
    const edges = resolveReferences(refs, symbols, filesByPath);
    expect(edges.length).toBe(0);
  });

  it('deduplicates edges', () => {
    const refs = [
      { source_name: 'main', target_name: 'Calculator', kind: 'call', line: 5, source_file: 'src/app.js' },
      { source_name: 'main', target_name: 'Calculator', kind: 'call', line: 8, source_file: 'src/app.js' },
    ];
    const edges = resolveReferences(refs, symbols, filesByPath);
    expect(edges.length).toBe(1); // Deduped by source_id:target_id:kind
  });
});

describe('buildFileEdges', () => {
  it('aggregates symbol edges into file edges', () => {
    const symbolEdges = [
      { source_id: 1, target_id: 3, kind: 'call', line: 5 },
      { source_id: 2, target_id: 3, kind: 'call', line: 8 },
    ];
    const symbols = new Map([
      [1, { id: 1, file_id: 1, file_path: 'src/a.js' }],
      [2, { id: 2, file_id: 1, file_path: 'src/a.js' }],
      [3, { id: 3, file_id: 2, file_path: 'src/b.js' }],
    ]);
    const fileEdges = buildFileEdges(symbolEdges, symbols);
    expect(fileEdges.length).toBe(1);
    expect(fileEdges[0].source_file_id).toBe(1);
    expect(fileEdges[0].target_file_id).toBe(2);
    expect(fileEdges[0].symbol_count).toBe(2);
  });

  it('ignores intra-file edges', () => {
    const symbolEdges = [
      { source_id: 1, target_id: 2, kind: 'call', line: 5 },
    ];
    const symbols = new Map([
      [1, { id: 1, file_id: 1, file_path: 'src/a.js' }],
      [2, { id: 2, file_id: 1, file_path: 'src/a.js' }], // Same file
    ]);
    const fileEdges = buildFileEdges(symbolEdges, symbols);
    expect(fileEdges.length).toBe(0);
  });
});
