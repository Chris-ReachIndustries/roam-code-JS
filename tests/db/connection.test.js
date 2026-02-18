import { describe, it, expect } from 'vitest';
import { batchedIn, batchedCount } from '../../src/db/connection.js';
import { createSeededDb } from '../helpers/db-fixture.js';

describe('batchedIn', () => {
  it('returns rows for matching IDs', () => {
    const db = createSeededDb();
    try {
      const rows = batchedIn(
        db,
        'SELECT id, name FROM symbols WHERE id IN ({ph})',
        [1, 2, 3]
      );
      expect(rows.length).toBe(3);
      expect(rows.some(r => r.name === 'App')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('returns empty for empty IDs', () => {
    const db = createSeededDb();
    try {
      const rows = batchedIn(
        db,
        'SELECT id, name FROM symbols WHERE id IN ({ph})',
        []
      );
      expect(rows).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('handles multiple {ph} placeholders', () => {
    const db = createSeededDb();
    try {
      const rows = batchedIn(
        db,
        'SELECT source_id, target_id FROM edges WHERE source_id IN ({ph}) OR target_id IN ({ph})',
        [1, 2]
      );
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('handles large ID lists via batching', () => {
    const db = createSeededDb();
    try {
      // Create many IDs (more than batch size)
      const ids = Array.from({ length: 500 }, (_, i) => i + 1);
      const rows = batchedIn(
        db,
        'SELECT id FROM symbols WHERE id IN ({ph})',
        ids
      );
      // Should return whatever matches in the DB
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('batchedCount', () => {
  it('counts matching rows', () => {
    const db = createSeededDb();
    try {
      const count = batchedCount(
        db,
        'SELECT COUNT(*) FROM symbols WHERE id IN ({ph})',
        [1, 2, 3]
      );
      expect(count).toBe(3);
    } finally {
      db.close();
    }
  });

  it('returns 0 for empty IDs', () => {
    const db = createSeededDb();
    try {
      const count = batchedCount(
        db,
        'SELECT COUNT(*) FROM symbols WHERE id IN ({ph})',
        []
      );
      expect(count).toBe(0);
    } finally {
      db.close();
    }
  });
});
