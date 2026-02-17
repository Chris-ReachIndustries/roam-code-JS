/**
 * roam trend — Show metrics trends over time.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';
import { getHistory, computeDelta, formatTrend } from '../analysis/metrics-history.js';
import { mannKendall } from '../analysis/anomaly.js';

const METRICS = [
  'file_count', 'symbol_count', 'edge_count',
  'avg_complexity', 'max_complexity',
  'dead_count', 'dead_pct',
  'test_ratio', 'cycle_count', 'tangle_ratio',
  'health_score', 'god_components', 'coupling_density',
];

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const metricFilter = opts.metric || null;
    const last = opts.last != null ? Number(opts.last) : 20;

    const history = getHistory(db, { limit: last });

    if (history.length < 2) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('trend', {
          summary: { snapshots: history.length, message: 'Need at least 2 snapshots for trend analysis' },
          history: history,
        })));
      } else {
        console.log(`Only ${history.length} snapshot(s) found. Need at least 2 for trend analysis.`);
        console.log('Use `roam fitness --snapshot` to record snapshots over time.');
      }
      return;
    }

    // Reverse to chronological order (oldest first)
    const chronological = [...history].reverse();
    const current = chronological[chronological.length - 1];
    const previous = chronological[chronological.length - 2];
    const delta = computeDelta(current, previous);

    // Compute trends for each metric
    const trendData = [];
    const metricsToShow = metricFilter ? [metricFilter] : METRICS;

    for (const metric of metricsToShow) {
      const values = chronological.map(h => h[metric]).filter(v => v != null);
      if (values.length < 2) continue;

      const mk = mannKendall(values);
      const sparkline = formatTrend(values);
      const d = delta[metric];

      trendData.push({
        metric,
        current: d ? d.value : values[values.length - 1],
        delta: d ? d.delta : 0,
        pct_change: d ? d.pct_change : 0,
        trend: mk.trend,
        tau: Math.round(mk.tau * 1000) / 1000,
        p_value: Math.round(mk.p * 1000) / 1000,
        sparkline,
        samples: values.length,
      });
    }

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('trend', {
        summary: {
          snapshots: history.length,
          metrics: trendData.length,
          increasing: trendData.filter(t => t.trend === 'increasing').length,
          decreasing: trendData.filter(t => t.trend === 'decreasing').length,
        },
        trends: trendData,
      })));
    } else {
      console.log(`Trends (${history.length} snapshots):\n`);
      const headers = ['Metric', 'Current', 'Delta', 'Change%', 'Trend', 'Sparkline'];
      const rows = trendData.map(t => [
        t.metric,
        _formatNum(t.current),
        _formatDelta(t.delta),
        t.pct_change !== Infinity ? `${t.pct_change > 0 ? '+' : ''}${t.pct_change}%` : 'N/A',
        t.trend,
        t.sparkline,
      ]);
      console.log(formatTable(headers, rows));
    }
  } finally {
    db.close();
  }
}

function _formatNum(v) {
  if (v == null) return '-';
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(2);
  return String(v);
}

function _formatDelta(d) {
  if (d == null || d === 0) return '0';
  const sign = d > 0 ? '+' : '';
  if (typeof d === 'number' && !Number.isInteger(d)) return `${sign}${d.toFixed(2)}`;
  return `${sign}${d}`;
}
