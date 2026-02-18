import { describe, it, expect } from 'vitest';
import { createSeededDb } from '../helpers/db-fixture.js';

describe('DB fixture integration', () => {
  it('seeded db has correct file count', () => {
    const db = createSeededDb();
    try {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM files').get().cnt;
      expect(count).toBe(5);
    } finally {
      db.close();
    }
  });

  it('seeded db has correct symbol count', () => {
    const db = createSeededDb();
    try {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get().cnt;
      expect(count).toBe(13);
    } finally {
      db.close();
    }
  });

  it('seeded db has correct edge count', () => {
    const db = createSeededDb();
    try {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM edges').get().cnt;
      expect(count).toBe(5);
    } finally {
      db.close();
    }
  });

  it('seeded db has graph metrics', () => {
    const db = createSeededDb();
    try {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM graph_metrics').get().cnt;
      expect(count).toBe(6);
    } finally {
      db.close();
    }
  });

  it('seeded db has file stats', () => {
    const db = createSeededDb();
    try {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM file_stats').get().cnt;
      expect(count).toBe(5);
    } finally {
      db.close();
    }
  });

  it('can query symbols with metrics', () => {
    const db = createSeededDb();
    try {
      const rows = db.prepare(`
        SELECT s.name, s.kind, gm.pagerank
        FROM symbols s
        LEFT JOIN graph_metrics gm ON gm.symbol_id = s.id
        WHERE gm.pagerank IS NOT NULL
        ORDER BY gm.pagerank DESC
      `).all();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].pagerank).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('can find callers and callees', () => {
    const db = createSeededDb();
    try {
      // Find callees of App (id=1)
      const callees = db.prepare(`
        SELECT s.name FROM edges e
        JOIN symbols s ON s.id = e.target_id
        WHERE e.source_id = 1
      `).all();
      expect(callees.length).toBe(2); // Logger and Calculator
      expect(callees.some(r => r.name === 'Logger')).toBe(true);
      expect(callees.some(r => r.name === 'Calculator')).toBe(true);
    } finally {
      db.close();
    }
  });
});
