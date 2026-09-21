// Fits the WBGT forecast and the environmental states on the committed
// Conduit archive, through the same cleaning and feature code the app runs,
// and writes them to src/lib/afya/model/. Run with:
//
//   npx tsx scripts/fit-models.ts
//
// The archive is split by time. The forecast is fitted on the training months,
// its uncertainty band is set from errors on the calibration months, and every
// score it reports comes from the test months, which it never saw.

import fs from "fs";
import path from "path";
import { getCsvCoverage, getCsvRange } from "../src/lib/afya/csv-source";
import {
  buildFeatureSeries,
  FEATURE_SOURCE_FIELDS,
  FORECAST_FEATURES,
  STATE_FEATURES,
  type FeatureVector,
} from "../src/lib/afya/feature-engine";
import type { DemoObservation } from "../src/lib/afya/demo-observations";
import { riskRank, wbgtToRisk } from "../src/lib/afya/constants";

const CALIBRATION_FROM = "2026-04-01T00:00:00Z";
const TEST_FROM = "2026-06-01T00:00:00Z";
const STEPS = 36; // 15-minute steps out to nine hours
const RIDGE_LAMBDA = 1.0;
const STATE_COUNT = 4;
const OUT_DIR = path.join(process.cwd(), "src", "lib", "afya", "model");

type Period = "train" | "calibration" | "test";

function periodOf(ts: string): Period {
  if (ts < CALIBRATION_FROM) return "train";
  if (ts < TEST_FROM) return "calibration";
  return "test";
}

function measured(o: DemoObservation, fields: readonly string[]): boolean {
  return !fields.some((f) => o.imputed?.includes(f));
}

function round(v: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
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

/** Deterministic pseudo-random numbers, so a refit gives the same clusters. */
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kMeans(points: number[][], k: number, seed: number, iterations = 100) {
  const random = mulberry32(seed);
  const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  // k-means++ initialisation
  const centroids = [points[Math.floor(random() * points.length)]];
  while (centroids.length < k) {
    const d = points.map((p) => Math.min(...centroids.map((c) => dist(p, c))));
    const total = d.reduce((a, b) => a + b, 0);
    let r = random() * total;
    let idx = 0;
    while (r > d[idx]) r -= d[idx++];
    centroids.push(points[idx]);
  }
  let centres = centroids.map((c) => [...c]);
  let labels = new Array(points.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    labels = points.map((p) => {
      let best = 0;
      for (let c = 1; c < k; c++) if (dist(p, centres[c]) < dist(p, centres[best])) best = c;
      return best;
    });
    const next = Array.from({ length: k }, () => new Array(points[0].length).fill(0));
    const counts = new Array(k).fill(0);
    points.forEach((p, i) => {
      counts[labels[i]]++;
      p.forEach((v, j) => (next[labels[i]][j] += v));
    });
    centres = next.map((c, i) => (counts[i] ? c.map((v) => v / counts[i]) : centres[i]));
  }
  const inertia = points.reduce((s, p, i) => s + dist(p, centres[labels[i]]), 0);
  return { centres, labels, inertia };
}

function main() {
  const coverage = getCsvCoverage();
  if (!coverage) throw new Error("no Conduit archive found under data/");
  const series = getCsvRange(coverage.minIso, coverage.maxIso);
  const features = buildFeatureSeries(series);
  console.log(`archive ${coverage.minIso} to ${coverage.maxIso}, ${series.length} slots`);

  // An origin is usable when its features come from an hour of measured data.
  const usable = series.map((_, i) =>
    !!features[i] && i >= 4 && series.slice(i - 4, i + 1).every((o) => measured(o, FEATURE_SOURCE_FIELDS)),
  );
  const row = (fv: FeatureVector, names: (keyof FeatureVector)[]) => names.map((n) => fv[n]);

  // Feature scaling from the training months only.
  const trainIdx = series.map((o, i) => i).filter((i) => usable[i] && periodOf(series[i].ts) === "train");
  const scale = (names: (keyof FeatureVector)[]) => {
    const cols = names.map((n) => trainIdx.map((i) => features[i]![n]));
    const mu = cols.map(mean);
    const sd = cols.map((c, j) => Math.sqrt(mean(c.map((v) => (v - mu[j]) ** 2))) || 1);
    return { mu, sd };
  };
  const fScale = scale(FORECAST_FEATURES);
  const z = (fv: FeatureVector) =>
    row(fv, FORECAST_FEATURES).map((v, j) => (v - fScale.mu[j]) / fScale.sd[j]);

  const steps = [];
  for (let step = 1; step <= STEPS; step++) {
    const samples: Record<Period, { x: number[]; y: number; now: number }[]> = {
      train: [], calibration: [], test: [],
    };
    for (let i = 0; i + step < series.length; i++) {
      if (!usable[i]) continue;
      const target = series[i + step];
      if (!measured(target, ["temp_sht", "wet_bulb_temp"])) continue;
      samples[periodOf(series[i].ts)].push({
        x: z(features[i]!),
        y: target.wet_bulb_globe_temp,
        now: series[i].wet_bulb_globe_temp,
      });
    }

    const p = FORECAST_FEATURES.length;
    const yMean = mean(samples.train.map((s) => s.y));
    const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
    const xty = new Array(p).fill(0);
    for (const s of samples.train) {
      const r = s.y - yMean;
      for (let a = 0; a < p; a++) {
        xty[a] += s.x[a] * r;
        for (let b = a; b < p; b++) xtx[a][b] += s.x[a] * s.x[b];
      }
    }
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];
      xtx[a][a] += RIDGE_LAMBDA;
    }
    const coef = solve(xtx, xty);
    const predict = (x: number[]) => yMean + x.reduce((sum, v, j) => sum + v * coef[j], 0);

    const calErrors = samples.calibration.map((s) => Math.abs(s.y - predict(s.x)));
    const band80 = quantile(calErrors, 0.8);
    const band95 = quantile(calErrors, 0.95);
    const testErrors = samples.test.map((s) => Math.abs(s.y - predict(s.x)));
    // The risk band is what people act on, so it is scored too: how often the
    // forecast band matches the one observed, and how often it is lower.
    const bandGap = samples.test.map((s) => riskRank(wbgtToRisk(predict(s.x))) - riskRank(wbgtToRisk(s.y)));
    const bandShare = (keep: (d: number) => boolean) =>
      round((bandGap.filter(keep).length / bandGap.length) * 100, 1);
    const persistenceErrors = samples.test.map((s) => Math.abs(s.y - s.now));

    steps.push({
      step,
      intercept: round(yMean),
      coef: coef.map((c) => round(c, 5)),
      band80: round(band80, 3),
      band95: round(band95, 3),
      test_mae: round(mean(testErrors), 3),
      persistence_mae: round(mean(persistenceErrors), 3),
      coverage80: round(testErrors.filter((e) => e <= band80).length / testErrors.length, 3),
      band_same_pct: bandShare((d) => d === 0),
      band_lower_pct: bandShare((d) => d < 0),
      band_higher_pct: bandShare((d) => d > 0),
      n_train: samples.train.length,
      n_calibration: samples.calibration.length,
      n_test: samples.test.length,
    });
  }

  const first = series[0].ts.slice(0, 10);
  const last = series[series.length - 1].ts.slice(0, 10);
  const forecast = {
    fitted_on: "data/conduit_master_2025_2026.csv",
    method: "Ridge regression, one model for each 15-minute step ahead",
    target: "WBGT in shade, 0.7 x wet bulb + 0.3 x air temperature",
    periods: {
      train: [first, "2026-03-31"],
      calibration: ["2026-04-01", "2026-05-31"],
      test: ["2026-06-01", last],
    },
    features: FORECAST_FEATURES,
    feature_mean: fScale.mu.map((v) => round(v, 5)),
    feature_std: fScale.sd.map((v) => round(v, 5)),
    steps,
  };

  // States: k-means on the training months, then named by what each cluster is.
  const sScale = scale(STATE_FEATURES);
  const zs = (fv: FeatureVector) =>
    row(fv, STATE_FEATURES).map((v, j) => (v - sScale.mu[j]) / sScale.sd[j]);
  const points = trainIdx.map((i) => zs(features[i]!));
  const fits = [11, 23, 37].map((seed) => kMeans(points, STATE_COUNT, seed));
  const best = fits.reduce((a, b) => (b.inertia < a.inertia ? b : a));

  const col = (name: keyof FeatureVector) => STATE_FEATURES.indexOf(name);
  const raw = (c: number[], name: keyof FeatureVector) =>
    c[col(name)] * sScale.sd[col(name)] + sScale.mu[col(name)];
  // Coolest centre: cool and humid; warmest: hot. Of the other two, the one
  // warming faster is the morning rise and the other is the evening cooling.
  const clusters = best.centres.map((c, k) => ({ k, c }));
  const byTemp = [...clusters].sort((a, b) => raw(a.c, "temp_sht") - raw(b.c, "temp_sht"));
  const cool = byTemp[0];
  const hot = byTemp[byTemp.length - 1];
  const [p1, p2] = byTemp.slice(1, -1);
  const warming = raw(p1.c, "temp_delta_1h") > raw(p2.c, "temp_delta_1h") ? p1 : p2;
  const cooling = warming === p1 ? p2 : p1;
  const stateOfCluster = new Map([[cool.k, 0], [warming.k, 1], [hot.k, 2], [cooling.k, 3]]);

  const nearest = (x: number[]) => {
    let bestK = 0;
    let bestD = Infinity;
    best.centres.forEach((c, k) => {
      const d = c.reduce((s, v, j) => s + (v - x[j]) ** 2, 0);
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    });
    return stateOfCluster.get(bestK)!;
  };

  // How often each state is followed by each other state, over the whole archive.
  const labels = series.map((_, i) => (usable[i] ? nearest(zs(features[i]!)) : null));
  const moves = Array.from({ length: STATE_COUNT }, () => new Array(STATE_COUNT).fill(0));
  let prev: number | null = null;
  for (const l of labels) {
    if (l === null) {
      prev = null;
      continue;
    }
    if (prev !== null && l !== prev) moves[prev][l]++;
    prev = l;
  }
  const transitions = moves.map((counts, from) => {
    const total = counts.reduce((a, b) => a + b, 0);
    const to = counts.indexOf(Math.max(...counts));
    return { from, to, probability: total ? round(counts[to] / total, 2) : 0, changes: total };
  });

  const summary = [0, 1, 2, 3].map((state) => {
    const cluster = [...stateOfCluster.entries()].find(([, s]) => s === state)![0];
    const members = trainIdx.filter((_, n) => best.labels[n] === cluster);
    const hours = members.map((i) => (new Date(series[i].ts).getUTCHours() + 3) % 24);
    return {
      state,
      share_of_training_slots: round(members.length / trainIdx.length, 3),
      mean_temp_c: round(raw(best.centres[cluster], "temp_sht"), 1),
      mean_humidity_pct: round(raw(best.centres[cluster], "humidity_sht"), 1),
      mean_ir_counts: Math.round(raw(best.centres[cluster], "si1145_ir")),
      mean_temp_change_c_per_h: round(raw(best.centres[cluster], "temp_delta_1h"), 2),
      median_local_hour: quantile(hours, 0.5),
    };
  });

  const states = {
    fitted_on: "data/conduit_master_2025_2026.csv",
    method: "k-means, 4 clusters, on the training months; named by their centres",
    periods: { train: [first, "2026-03-31"] },
    features: STATE_FEATURES,
    feature_mean: sScale.mu.map((v) => round(v, 5)),
    feature_std: sScale.sd.map((v) => round(v, 5)),
    centroids: [0, 1, 2, 3].map((state) => {
      const cluster = [...stateOfCluster.entries()].find(([, s]) => s === state)![0];
      return best.centres[cluster].map((v) => round(v, 4));
    }),
    summary,
    transitions,
    n_training_slots: trainIdx.length,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "wbgt-forecast.json"), JSON.stringify(forecast, null, 1) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "states.json"), JSON.stringify(states, null, 1) + "\n");

  for (const s of steps.filter((s) => [4, 12, 24, 36].includes(s.step))) {
    console.log(
      `+${s.step * 15} min  MAE ${s.test_mae} degC (no-change ${s.persistence_mae})  ` +
        `band80 ±${s.band80}  covered ${Math.round(s.coverage80 * 100)}%  same band ${s.band_same_pct}%  ` +
        `lower ${s.band_lower_pct}%  test n=${s.n_test}`,
    );
  }
  console.log("states", JSON.stringify(summary));
  console.log("transitions", JSON.stringify(transitions));
}

main();
