import { describe, it, expect, vi } from 'vitest';
import {
  abbrevKind, loc, symbolLine, section, indent, truncateLines,
  formatSignature, formatEdgeKind, formatTable, toJson,
  jsonEnvelope, tableToDicts, compactJsonEnvelope,
} from '../../src/output/formatter.js';

describe('abbrevKind', () => {
  it('abbreviates known kinds', () => {
    expect(abbrevKind('function')).toBe('fn');
    expect(abbrevKind('class')).toBe('cls');
    expect(abbrevKind('method')).toBe('meth');
    expect(abbrevKind('variable')).toBe('var');
    expect(abbrevKind('constant')).toBe('const');
    expect(abbrevKind('interface')).toBe('iface');
    expect(abbrevKind('constructor')).toBe('ctor');
  });

  it('returns original for unknown kinds', () => {
    expect(abbrevKind('unknown_kind')).toBe('unknown_kind');
  });
});

describe('loc', () => {
  it('formats path with line', () => {
    expect(loc('src/app.js', 42)).toBe('src/app.js:42');
  });

  it('formats path without line', () => {
    expect(loc('src/app.js')).toBe('src/app.js');
  });
});

describe('symbolLine', () => {
  it('formats symbol with all parts', () => {
    const result = symbolLine('App', 'class', 'class App', 'src/app.js', 10, 'exported');
    expect(result).toContain('cls');
    expect(result).toContain('App');
    expect(result).toContain('class App');
    expect(result).toContain('src/app.js:10');
    expect(result).toContain('exported');
  });
});

describe('section', () => {
  it('creates section with title and lines', () => {
    const result = section('## Test', ['  line1', '  line2']);
    expect(result).toContain('## Test');
    expect(result).toContain('line1');
    expect(result).toContain('line2');
  });

  it('truncates with budget', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const result = section('Title', lines, 2);
    expect(result).toContain('(+3 more)');
  });
});

describe('indent', () => {
  it('indents text by default level', () => {
    expect(indent('hello')).toBe('  hello');
  });

  it('indents text by specified level', () => {
    expect(indent('hello', 3)).toBe('      hello');
  });
});

describe('truncateLines', () => {
  it('returns all lines within budget', () => {
    expect(truncateLines(['a', 'b', 'c'], 5)).toEqual(['a', 'b', 'c']);
  });

  it('truncates with message', () => {
    const result = truncateLines(['a', 'b', 'c', 'd', 'e'], 2);
    expect(result).toHaveLength(3);
    expect(result[2]).toContain('+3 more');
  });
});

describe('formatSignature', () => {
  it('returns trimmed signature', () => {
    expect(formatSignature('  def foo()  ')).toBe('def foo()');
  });

  it('truncates long signatures', () => {
    const sig = 'a'.repeat(100);
    expect(formatSignature(sig, 80).endsWith('...')).toBe(true);
    expect(formatSignature(sig, 80).length).toBe(80);
  });

  it('returns empty for null', () => {
    expect(formatSignature(null)).toBe('');
  });
});

describe('formatEdgeKind', () => {
  it('replaces underscores with spaces', () => {
    expect(formatEdgeKind('calls_method')).toBe('calls method');
  });
});

describe('formatTable', () => {
  it('formats a table with headers and rows', () => {
    const result = formatTable(['Name', 'Age'], [['Alice', '30'], ['Bob', '25']]);
    expect(result).toContain('Name');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    expect(result).toContain('---');
  });

  it('returns (none) for empty rows', () => {
    expect(formatTable(['A'], [])).toBe('(none)');
  });

  it('truncates with budget', () => {
    const rows = [['a'], ['b'], ['c'], ['d']];
    const result = formatTable(['X'], rows, 2);
    expect(result).toContain('+2 more');
  });
});

describe('toJson', () => {
  it('serializes object to pretty JSON', () => {
    const result = toJson({ a: 1, b: 'hello' });
    expect(JSON.parse(result)).toEqual({ a: 1, b: 'hello' });
    expect(result).toContain('\n'); // pretty printed
  });
});

describe('jsonEnvelope', () => {
  it('creates envelope with required fields', () => {
    const env = jsonEnvelope('test_cmd', { results: [1, 2], summary: { count: 2 } });
    expect(env.command).toBe('test_cmd');
    expect(env.version).toBeDefined();
    expect(env.timestamp).toBeDefined();
    expect(env.summary).toEqual({ count: 2 });
    expect(env.results).toEqual([1, 2]);
  });
});

describe('tableToDicts', () => {
  it('converts table rows to dictionaries', () => {
    const result = tableToDicts(['name', 'age'], [['Alice', 30], ['Bob', 25]]);
    expect(result).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
  });

  it('returns empty array for no rows', () => {
    expect(tableToDicts(['a'], [])).toEqual([]);
  });
});

describe('compactJsonEnvelope', () => {
  it('creates minimal envelope', () => {
    const env = compactJsonEnvelope('cmd', { data: 42 });
    expect(env.command).toBe('cmd');
    expect(env.data).toBe(42);
    expect(env.version).toBeUndefined();
  });
});
