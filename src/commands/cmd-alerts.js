/**
 * roam alerts — Detect statistical anomalies in metrics vs history.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';
import { getHistory } from '../analysis/metrics-history.js';
import { modifiedZScore, westernElectric } from '../analysis/anomaly.js';

const METRICS_TO_CHECK = [
  { key: 'avg_complexity', label: 'Avg Complexity', upBad: true },
  { key: 'max_complexity', label: 'Max Complexity', upBad: true },
  { key: 'dead_count', label: 'Dead Code Count', upBad: true },
  { key: 'dead_pct', label: 'Dead Code %', upBad: true },
  { key: 'cycle_count', label: 'Cycle Count', upBad: true },
  { key: 'tangle_ratio', label: 'Tangle Ratio', upBad: true },
  { key: 'god_components', label: 'God Components', upBad: true },
  { key: 'coupling_density', label: 'Coupling Density', upBad: true },
  { key: 'health_score', label: 'Health Score', upBad: false },
  { key: 'test_ratio', label: 'Test Ratio', upBad: false },
];

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const threshold = opts.threshold != null ? Number(opts.threshold) : 2;

    const history = getHistory(db, { limit: 50 });

    if (history.length < 3) {
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('alerts', {
          summary: { alerts: 0, message: 'Need at least 3 snapshots for anomaly detection' },
          alerts: [],
        })));
      } else {
        console.log(`Only ${history.length} snapshot(s). Need at least 3 for anomaly detection.`);
        console.log('Use `roam fitness --snapshot` to record snapshots.');
      }
      return;
    }

    // Chronological order
    const chronological = [...history].reverse();
    const current = chronological[chronological.length - 1];

    const alerts = [];

    for (const metric of METRICS_TO_CHECK) {
      const values = chronological.map(h => h[metric.key]).filter(v => v != null);
      if (values.length < 3) continue;

      const currentVal = current[metric.key];
      if (currentVal == null) continue;

      // Modified Z-Score analysis
      const { scores, median: med, mad: madVal } = modifiedZScore(values);
      const currentZ = scores[scores.length - 1] || 0;
      const absZ = Math.abs(currentZ);

      // Western Electric rules
      const { violations } = westernElectric(values);
      const recentViolations = violations.filter(v => v.index >= values.length - 3);

      // Determine if this is an alert
      let severity = null;
      let reason = null;

      if (absZ > 3) {
        severity = 'CRITICAL';
        reason = `Z-score ${currentZ.toFixed(2)} (>3σ from median)`;
      } else if (absZ > threshold) {
        severity = 'WARNING';
        reason = `Z-score ${currentZ.toFixed(2)} (>${threshold}σ from median)`;
      } else if (recentViolations.length > 0) {
        severity = 'INFO';
        reason = `Western Electric rule ${recentViolations[0].rule}: ${recentViolations[0].description}`;
      }

      // Check direction (is the anomaly in the "bad" direction?)
      if (severity && metric.upBad && currentZ < 0) {
        // Decrease in a metric where up is bad = good, demote severity
        if (severity === 'CRITICAL') severity = 'INFO';
        else severity = null;
      }
      if (severity && !metric.upBad && currentZ > 0) {
        // Increase in a metric where up is good = good, demote
        if (severity === 'CRITICAL') severity = 'INFO';
        else severity = null;
      }

      if (severity) {
        alerts.push({
          metric: metric.label,
          key: metric.key,
          value: currentVal,
          median: Math.round(med * 100) / 100,
          zscore: Math.round(currentZ * 100) / 100,
          severity,
          reason,
        });
      }
    }

    // Sort by severity
    const sevOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3));

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('alerts', {
        summary: {
          alerts: alerts.length,
          critical: alerts.filter(a => a.severity === 'CRITICAL').length,
          warning: alerts.filter(a => a.severity === 'WARNING').length,
          info: alerts.filter(a => a.severity === 'INFO').length,
          snapshots: history.length,
        },
        alerts,
      })));
    } else {
      if (!alerts.length) {
        console.log('No anomalies detected. All metrics within normal range.');
        return;
      }
      console.log(`Alerts (${alerts.length} anomalies from ${history.length} snapshots):\n`);
      const headers = ['Sev', 'Metric', 'Value', 'Median', 'Z-Score', 'Reason'];
      const rows = alerts.map(a => [
        a.severity, a.metric,
        _fmt(a.value), _fmt(a.median),
        a.zscore.toFixed(2), a.reason,
      ]);
      console.log(formatTable(headers, rows));
    }
  } finally {
    db.close();
  }
}

function _fmt(v) {
  if (v == null) return '-';
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(2);
  return String(v);
}
