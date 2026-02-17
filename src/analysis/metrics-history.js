/**
 * Metrics history — snapshot tracking for trend analysis.
 * Stores timestamped metric snapshots in the index DB.
 */

export const HISTORY_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS metrics_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    file_count INTEGER,
    symbol_count INTEGER,
    edge_count INTEGER,
    avg_complexity REAL,
    max_complexity INTEGER,
    dead_count INTEGER,
    dead_pct REAL,
    test_ratio REAL,
    cycle_count INTEGER,
    tangle_ratio REAL,
    health_score INTEGER,
    god_components INTEGER,
    coupling_density REAL,
    extra_json TEXT
  )
`;

/**
 * Ensure the metrics_history table exists.
 * @param {import('better-sqlite3').Database} db
 */
export function ensureHistoryTable(db) {
  db.exec(HISTORY_TABLE_DDL);
}

/**
 * Record a metrics snapshot.
 * @param {import('better-sqlite3').Database} db
 * @param {object} metrics — flat object with metric keys
 */
export function recordSnapshot(db, metrics) {
  ensureHistoryTable(db);

  const extra = {};
  const knownKeys = new Set([
    'file_count', 'symbol_count', 'edge_count',
    'avg_complexity', 'max_complexity', 'dead_count', 'dead_pct',
    'test_ratio', 'cycle_count', 'tangle_ratio', 'health_score',
    'god_components', 'coupling_density',
  ]);

  for (const [k, v] of Object.entries(metrics)) {
    if (!knownKeys.has(k)) extra[k] = v;
  }

  db.prepare(`
    INSERT INTO metrics_history (
      file_count, symbol_count, edge_count,
      avg_complexity, max_complexity, dead_count, dead_pct,
      test_ratio, cycle_count, tangle_ratio, health_score,
      god_components, coupling_density, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    metrics.file_count ?? null,
    metrics.symbol_count ?? null,
    metrics.edge_count ?? null,
    metrics.avg_complexity ?? null,
    metrics.max_complexity ?? null,
    metrics.dead_count ?? null,
    metrics.dead_pct ?? null,
    metrics.test_ratio ?? null,
    metrics.cycle_count ?? null,
    metrics.tangle_ratio ?? null,
    metrics.health_score ?? null,
    metrics.god_components ?? null,
    metrics.coupling_density ?? null,
    Object.keys(extra).length ? JSON.stringify(extra) : null,
  );
}

/**
 * Get metrics history.
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.since] — unix timestamp
 * @returns {Array<{timestamp: number, ...metrics}>}
 */
export function getHistory(db, { limit = 50, since } = {}) {
  ensureHistoryTable(db);

  let sql = 'SELECT * FROM metrics_history';
  const params = [];
  if (since) {
    sql += ' WHERE timestamp >= ?';
    params.push(since);
  }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);

  return rows.map(row => {
    const result = { ...row };
    if (row.extra_json) {
      try {
        Object.assign(result, JSON.parse(row.extra_json));
      } catch { /* ignore bad JSON */ }
    }
    delete result.extra_json;
    delete result.id;
    return result;
  });
}

/**
 * Compute delta between current and previous metrics.
 * @param {object} current
 * @param {object} previous
 * @returns {Object<string, {value: number, prev: number, delta: number, pct_change: number}>}
 */
export function computeDelta(current, previous) {
  if (!previous) return {};
  const result = Object.create(null);
  const numericKeys = [
    'file_count', 'symbol_count', 'edge_count',
    'avg_complexity', 'max_complexity', 'dead_count', 'dead_pct',
    'test_ratio', 'cycle_count', 'tangle_ratio', 'health_score',
    'god_components', 'coupling_density',
  ];

  for (const key of numericKeys) {
    const cur = current[key];
    const prev = previous[key];
    if (cur != null && prev != null) {
      const delta = cur - prev;
      const pct = prev !== 0 ? Math.round((delta / Math.abs(prev)) * 10000) / 100 : (delta !== 0 ? Infinity : 0);
      result[key] = { value: cur, prev, delta, pct_change: pct };
    }
  }

  return result;
}

/**
 * Format trend as a sparkline or ASCII direction.
 * @param {number[]} values — time-ordered values (oldest first)
 * @returns {string}
 */
export function formatTrend(values) {
  if (!values.length) return '-';
  if (values.length === 1) return '→';

  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range < 1e-9) return '→'.repeat(Math.min(values.length, 8));

  const sparkline = values.slice(-8).map(v => {
    const idx = Math.min(Math.floor(((v - min) / range) * (blocks.length - 1)), blocks.length - 1);
    return blocks[idx];
  }).join('');

  // Direction arrow
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const direction = last > prev * 1.02 ? '↑' : last < prev * 0.98 ? '↓' : '→';

  return `${sparkline} ${direction}`;
}
