/**
 * Statistical anomaly detection — Modified Z-Score, Theil-Sen, Mann-Kendall,
 * Western Electric rules, CUSUM change-point detection.
 * Pure math, no DB dependency.
 */

/**
 * Median of a sorted-in-place copy.
 */
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Median Absolute Deviation — robust spread estimate.
 */
function mad(values) {
  const med = median(values);
  const deviations = values.map(v => Math.abs(v - med));
  return median(deviations);
}

/**
 * Modified Z-Score using MAD (Median Absolute Deviation).
 * More robust than standard Z-Score against outliers.
 * @param {number[]} values
 * @returns {{scores: number[], median: number, mad: number}}
 */
export function modifiedZScore(values) {
  if (values.length < 3) return { scores: values.map(() => 0), median: median(values), mad: 0 };
  const med = median(values);
  const madVal = mad(values);
  // 0.6745 is the 0.75th quantile of the standard normal distribution
  const constant = 0.6745;
  const scores = madVal > 0
    ? values.map(v => (v - med) / (madVal / constant))
    : values.map(() => 0);
  return { scores, median: med, mad: madVal };
}

/**
 * Theil-Sen slope estimator — robust linear regression.
 * Median of all pairwise slopes.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {{slope: number, intercept: number}}
 */
export function theilSenSlope(x, y) {
  if (x.length < 2) return { slope: 0, intercept: y[0] || 0 };
  const slopes = [];
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      if (x[j] !== x[i]) {
        slopes.push((y[j] - y[i]) / (x[j] - x[i]));
      }
    }
  }
  if (!slopes.length) return { slope: 0, intercept: median(y) };
  const slope = median(slopes);
  const intercepts = x.map((xi, i) => y[i] - slope * xi);
  const intercept = median(intercepts);
  return { slope, intercept };
}

/**
 * Mann-Kendall trend test — non-parametric trend significance.
 * @param {number[]} values — time-ordered observations
 * @returns {{S: number, tau: number, p: number, trend: string}}
 */
export function mannKendall(values) {
  const n = values.length;
  if (n < 4) return { S: 0, tau: 0, p: 1, trend: 'no_trend' };

  // Compute S statistic
  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = values[j] - values[i];
      if (diff > 0) S++;
      else if (diff < 0) S--;
    }
  }

  // Kendall's tau
  const tau = (2 * S) / (n * (n - 1));

  // Variance of S (with tie correction)
  const ties = Object.create(null);
  for (const v of values) {
    const key = String(v);
    ties[key] = (ties[key] || 0) + 1;
  }
  let tieCorrection = 0;
  for (const key in ties) {
    const t = ties[key];
    if (t > 1) tieCorrection += t * (t - 1) * (2 * t + 5);
  }
  const varS = (n * (n - 1) * (2 * n + 5) - tieCorrection) / 18;
  const stdS = Math.sqrt(Math.max(varS, 1));

  // Z statistic (continuity correction)
  let Z;
  if (S > 0) Z = (S - 1) / stdS;
  else if (S < 0) Z = (S + 1) / stdS;
  else Z = 0;

  // Two-tailed p-value approximation via standard normal CDF
  const p = 2 * (1 - _normalCDF(Math.abs(Z)));

  let trend = 'no_trend';
  if (p < 0.05) trend = S > 0 ? 'increasing' : 'decreasing';

  return { S, tau, p, trend };
}

/**
 * Western Electric rules — pattern detection in control charts.
 * @param {number[]} values
 * @param {number} [mean] — process mean (auto-calculated if omitted)
 * @param {number} [std] — process std dev (auto-calculated if omitted)
 * @returns {{violations: Array<{index: number, rule: number, description: string}>}}
 */
export function westernElectric(values, mean, std) {
  if (values.length < 8) return { violations: [] };
  if (mean === undefined) mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (std === undefined) {
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    std = Math.sqrt(variance);
  }
  if (std < 1e-12) return { violations: [] };

  const violations = [];

  for (let i = 0; i < values.length; i++) {
    const z = (values[i] - mean) / std;

    // Rule 1: One point > 3σ from mean
    if (Math.abs(z) > 3) {
      violations.push({ index: i, rule: 1, description: 'Point beyond 3σ' });
    }

    // Rule 2: 2 out of 3 consecutive points > 2σ on same side
    if (i >= 2) {
      const window = [values[i - 2], values[i - 1], values[i]];
      const above2 = window.filter(v => (v - mean) / std > 2).length;
      const below2 = window.filter(v => (v - mean) / std < -2).length;
      if (above2 >= 2 || below2 >= 2) {
        violations.push({ index: i, rule: 2, description: '2 of 3 points beyond 2σ' });
      }
    }

    // Rule 3: 4 out of 5 consecutive points > 1σ on same side
    if (i >= 4) {
      const window = values.slice(i - 4, i + 1);
      const above1 = window.filter(v => (v - mean) / std > 1).length;
      const below1 = window.filter(v => (v - mean) / std < -1).length;
      if (above1 >= 4 || below1 >= 4) {
        violations.push({ index: i, rule: 3, description: '4 of 5 points beyond 1σ' });
      }
    }

    // Rule 4: 8 consecutive points on same side of mean
    if (i >= 7) {
      const window = values.slice(i - 7, i + 1);
      const allAbove = window.every(v => v > mean);
      const allBelow = window.every(v => v < mean);
      if (allAbove || allBelow) {
        violations.push({ index: i, rule: 4, description: '8 consecutive points on same side' });
      }
    }
  }

  return { violations };
}

/**
 * CUSUM (Cumulative Sum) change-point detection.
 * Detects shifts in process mean.
 * @param {number[]} values
 * @param {number} [threshold=5] — decision interval (h)
 * @param {number} [drift=0.5] — allowance / slack (k), in σ units
 * @returns {{change_points: Array<{index: number, direction: string, magnitude: number}>}}
 */
export function cusumDetect(values, threshold = 5, drift = 0.5) {
  if (values.length < 5) return { change_points: [] };

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  if (std < 1e-12) return { change_points: [] };

  const k = drift * std;
  const h = threshold * std;

  let sPlus = 0;
  let sMinus = 0;
  const change_points = [];

  for (let i = 0; i < values.length; i++) {
    sPlus = Math.max(0, sPlus + (values[i] - mean) - k);
    sMinus = Math.max(0, sMinus - (values[i] - mean) - k);

    if (sPlus > h) {
      change_points.push({ index: i, direction: 'increase', magnitude: Math.round(sPlus / std * 10) / 10 });
      sPlus = 0;
    }
    if (sMinus > h) {
      change_points.push({ index: i, direction: 'decrease', magnitude: Math.round(sMinus / std * 10) / 10 });
      sMinus = 0;
    }
  }

  return { change_points };
}

/**
 * Unified anomaly detection interface.
 * @param {number[]} series — time-ordered values
 * @param {object} [opts]
 * @param {string} [opts.method='auto'] — 'zscore' | 'western' | 'cusum' | 'auto'
 * @param {number} [opts.threshold=3] — z-score threshold for anomaly
 * @returns {{anomalies: Array<{index: number, value: number, zscore: number}>, trend: object, change_points: Array}}
 */
export function detectAnomalies(series, { method = 'auto', threshold = 3 } = {}) {
  if (!series.length) return { anomalies: [], trend: { trend: 'no_data' }, change_points: [] };

  const result = { anomalies: [], trend: null, change_points: [] };

  // Z-score anomalies
  if (method === 'auto' || method === 'zscore') {
    const { scores } = modifiedZScore(series);
    for (let i = 0; i < series.length; i++) {
      if (Math.abs(scores[i]) > threshold) {
        result.anomalies.push({ index: i, value: series[i], zscore: Math.round(scores[i] * 100) / 100 });
      }
    }
  }

  // Trend detection
  result.trend = mannKendall(series);

  // Change-point detection
  if (method === 'auto' || method === 'cusum') {
    const { change_points } = cusumDetect(series);
    result.change_points = change_points;
  }

  // Western Electric rules
  if (method === 'auto' || method === 'western') {
    const { violations } = westernElectric(series);
    // Add WE violations as anomalies if not already detected
    const anomalyIndices = new Set(result.anomalies.map(a => a.index));
    for (const v of violations) {
      if (!anomalyIndices.has(v.index)) {
        result.anomalies.push({
          index: v.index, value: series[v.index],
          zscore: 0, we_rule: v.rule, description: v.description,
        });
      }
    }
  }

  return result;
}

// --- Internal helpers ---

/** Standard normal CDF approximation (Abramowitz & Stegun). */
function _normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}
