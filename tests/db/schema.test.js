import { describe, it, expect } from 'vitest';
import { SCHEMA_SQL } from '../../src/db/schema.js';
import { createTestDb } from '../helpers/db-fixture.js';

describe('SCHEMA_SQL', () => {
  it('is a non-empty string', () => {
    expect(typeof SCHEMA_SQL).toBe('string');
    expect(SCHEMA_SQL.length).toBeGreaterThan(100);
  });

  it('creates all expected tables', () => {
    const db = createTestDb();
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all().map(r => r.name);

      expect(tables).toContain('files');
      expect(tables).toContain('symbols');
      expect(tables).toContain('edges');
      expect(tables).toContain('file_edges');
      expect(tables).toContain('git_commits');
      expect(tables).toContain('git_file_changes');
      expect(tables).toContain('git_cochange');
      expect(tables).toContain('file_stats');
      expect(tables).toContain('graph_metrics');
      expect(tables).toContain('clusters');
      expect(tables).toContain('symbol_metrics');
      expect(tables).toContain('snapshots');
      expect(tables).toContain('git_hyperedges');
      expect(tables).toContain('git_hyperedge_members');
    } finally {
      db.close();
    }
  });

  it('creates expected indices', () => {
    const db = createTestDb();
    try {
      const indices = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
      ).all().map(r => r.name);

      expect(indices).toContain('idx_symbols_file');
      expect(indices).toContain('idx_symbols_name');
      expect(indices).toContain('idx_edges_source');
      expect(indices).toContain('idx_edges_target');
      expect(indices).toContain('idx_files_path');
    } finally {
      db.close();
    }
  });

  it('is idempotent', () => {
    const db = createTestDb();
    try {
      // Run schema again — should not throw
      db.exec(SCHEMA_SQL);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all();
      expect(tables.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});

describe('files table', () => {
  it('has expected columns', () => {
    const db = createTestDb();
    try {
      const cols = db.pragma('table_info(files)').map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('path');
      expect(cols).toContain('language');
      expect(cols).toContain('file_role');
      expect(cols).toContain('hash');
      expect(cols).toContain('mtime');
      expect(cols).toContain('line_count');
    } finally {
      db.close();
    }
  });
});

describe('symbols table', () => {
  it('has expected columns', () => {
    const db = createTestDb();
    try {
      const cols = db.pragma('table_info(symbols)').map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('file_id');
      expect(cols).toContain('name');
      expect(cols).toContain('qualified_name');
      expect(cols).toContain('kind');
      expect(cols).toContain('signature');
      expect(cols).toContain('line_start');
      expect(cols).toContain('line_end');
      expect(cols).toContain('docstring');
      expect(cols).toContain('visibility');
      expect(cols).toContain('is_exported');
      expect(cols).toContain('parent_id');
      expect(cols).toContain('default_value');
    } finally {
      db.close();
    }
  });
});
