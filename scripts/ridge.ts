// Ridge regression and the sample rules shared by the forecast fit
// (fit-models.ts) and its month-by-month test (evaluate-forecast.ts), so both
// score the same origins with the same model.

import type { DemoObservation } from "../src/lib/afya/demo-observations";
import { FEATURE_SOURCE_FIELDS, type FeatureVector } from "../src/lib/afya/feature-engine";

export const RIDGE_LAMBDA = 1.0;

/** Station fields WBGT is computed from; a target filled in for either is left out. */
export const TARGET_SOURCE_FIELDS = ["temp_sht", "wet_bulb_temp"];

export function measured(o: DemoObservation, fields: readonly string[]): boolean {
  return !fields.some((f) => o.imputed?.includes(f));
}

export function round(v: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
export function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

/** An origin is usable when its features come from an hour of measured data. */
export function usableOrigins(series: DemoObservation[], features: (FeatureVector | null)[]): boolean[] {
  return series.map((_, i) =>
    !!features[i] && i >= 4 && series.slice(i - 4, i + 1).every((o) => measured(o, FEATURE_SOURCE_FIELDS)),
  );
}

/** Usable origins whose target `step` slots ahead was measured, in time order. */
export function forecastOrigins(series: DemoObservation[], usable: boolean[], step: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + step < series.length; i++) {
    if (usable[i] && measured(series[i + step], TARGET_SOURCE_FIELDS)) out.push(i);
  }
  return out;
}

/** Mean and spread of each feature over the given slots, to standardise with. */
export function featureScale(
  features: (FeatureVector | null)[],
  idx: number[],
  names: (keyof FeatureVector)[],
) {
  const cols = names.map((n) => idx.map((i) => features[i]![n]));
  const mu = cols.map(mean);
  const sd = cols.map((c, j) => Math.sqrt(mean(c.map((v) => (v - mu[j]) ** 2))) || 1);
  return { mu, sd };
}

/**
 * Ridge fit on standardised features. The intercept is the mean target and is
 * not penalised, so only the slopes shrink towards zero.
 */
export function fitRidge(samples: { x: number[]; y: number }[], lambda = RIDGE_LAMBDA) {
  if (!samples.length) throw new Error("no training samples");
  const p = samples[0].x.length;
  const yMean = mean(samples.map((s) => s.y));
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  for (const s of samples) {
    const r = s.y - yMean;
    for (let a = 0; a < p; a++) {
      xty[a] += s.x[a] * r;
      for (let b = a; b < p; b++) xtx[a][b] += s.x[a] * s.x[b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];
    xtx[a][a] += lambda;
  }
  const coef = solve(xtx, xty);
  const predict = (x: number[]) => yMean + x.reduce((sum, v, j) => sum + v * coef[j], 0);
  return { intercept: yMean, coef, predict };
}
