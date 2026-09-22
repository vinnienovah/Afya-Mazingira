// The rain probability: whether gauge 1 records rain in the next three hours,
// fitted by logistic regression on the committed archive and tested month by
// month the same way as the WBGT forecast.
//
// Rain comes from the gauge's own counters, not the sampled one-minute rg1
// values, which miss most of it. rg1tt is the running total for the gauge
// day, which starts at 06:00 UTC, and rg1tp is the previous day's final total.
// The rain between two readings is the rise in rg1tt; across the reset it is
// what the old day added after the earlier reading (rg1tp minus that reading's
// rg1tt) plus the new day's rg1tt so far.

import fs from "fs";
import path from "path";
import { isMeasured, rainInputs, RAIN_FEATURES } from "../src/lib/afya/feature-engine";
import { round, solve } from "./ridge";
import type { Archive } from "./forecast-models";

const SLOT_MS = 15 * 60 * 1000;
const DAY_MS = 86_400_000;
const GAUGE_DAY_START_MS = 6 * 3600 * 1000;
// The gauge tips every 0.2 mm, so this means at least one tip.
const WET_MM = 0.1;
const AHEAD_SLOTS = 12;
const LAMBDA = 1;
const TIE_BRIER = 0.0001;
const HALF = 0.5;

export const TARGET = "Gauge 1 records rain (at least one 0.2 mm tip) in the next 3 hours";

type RainFeature = (typeof RAIN_FEATURES)[number];

/** Candidate input sets, simplest first. */
export const RAIN_CANDIDATES: Record<string, readonly RainFeature[]> = {
  weather: RAIN_FEATURES.filter((f) => f !== "doy_sin" && f !== "doy_cos"),
  weather_and_season: RAIN_FEATURES,
};

interface GaugeReading {
  ms: number;
  total: number;
  prior: number;
}

function csvPath(): string {
  return process.env.CONDUIT_CSV_PATH
    ? path.resolve(process.env.CONDUIT_CSV_PATH)
    : path.join(process.cwd(), "data", "conduit_master_2025_2026.csv");
}

function reading(v: string | undefined): number {
  if (v === undefined || v.trim() === "") return NaN;
  const x = Number(v);
  return x === -999.9 ? NaN : x;
}

/** Gauge 1's counters from every archive row, in time order. */
export function readGauge(): GaugeReading[] {
  const lines = fs.readFileSync(csvPath(), "utf8").split("\n");
  const header = lines[0].split(",").map((h) => h.trim());
  const [ts, total, prior] = ["ts", "rg1tt", "rg1tp"].map((c) => header.indexOf(c));
  const rows: GaugeReading[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    const ms = Date.parse(cols[ts]);
    if (Number.isFinite(ms)) rows.push({ ms, total: reading(cols[total]), prior: reading(cols[prior]) });
  }
  return rows.sort((x, y) => x.ms - y.ms);
}

const gaugeDay = (ms: number) => Math.floor((ms - GAUGE_DAY_START_MS) / DAY_MS);

/** Rain (mm) between two readings of the counters, or null when it cannot be known. */
export function rainBetween(earlier: GaugeReading, later: GaugeReading): number | null {
  if (!Number.isFinite(earlier.total) || !Number.isFinite(later.total)) return null;
  const days = gaugeDay(later.ms) - gaugeDay(earlier.ms);
  if (days === 0) return Math.max(0, later.total - earlier.total);
  if (days === 1 && Number.isFinite(later.prior)) return Math.max(0, later.prior - earlier.total) + later.total;
  return null;
}

/**
 * Rain in each 15-minute slot of the grid: what fell since the previous
 * reading, put in the slot of the reading that recorded it. NaN where the
 * counters cannot say.
 */
export function rainBySlot(a: Archive, gauge: GaugeReading[]): number[] {
  const slot0 = Math.floor(a.ms[0] / SLOT_MS);
  const rain = new Array<number>(a.series.length).fill(0);
  for (let k = 1; k < gauge.length; k++) {
    const i = Math.floor(gauge[k].ms / SLOT_MS) - slot0;
    if (i < 0 || i >= rain.length) continue;
    const mm = rainBetween(gauge[k - 1], gauge[k]);
    rain[i] = mm === null ? NaN : rain[i] + mm;
  }
  return rain;
}

export interface RainSamples {
  /** Grid index of each origin. */
  idx: number[];
  /** Inputs at each origin, in RAIN_FEATURES order. */
  x: number[][];
  /** 1 when rain fell in the three hours after the origin. */
  y: number[];
  /** Local (UTC+3) month 0-11 and hour 0-23 of each origin. */
  month: number[];
  hour: number[];
}

/**
 * Every origin whose inputs were measured and whose next three hours of rain
 * are known, with the inputs the app computes from a grid whose rg1 is the
 * rain in each slot.
 */
export function rainSamples(a: Archive, rain: number[]): RainSamples {
  const grid = a.series.map((o, i) => ({ ...o, rg1: Number.isNaN(rain[i]) ? 0 : rain[i] }));
  const out: RainSamples = { idx: [], x: [], y: [], month: [], hour: [] };
  for (let i = AHEAD_SLOTS; i + AHEAD_SLOTS < grid.length; i++) {
    if (!a.usable[i] || !isMeasured(a.series[i - AHEAD_SLOTS], ["temp_sht", "humidity_sht", "press_bmx"])) continue;
    let ahead = 0;
    let known = true;
    for (let k = -AHEAD_SLOTS + 1; k <= AHEAD_SLOTS; k++) {
      if (Number.isNaN(rain[i + k])) known = false;
      else if (k > 0) ahead += rain[i + k];
    }
    if (!known) continue;
    const inputs = rainInputs(grid, i)!;
    const local = new Date(a.ms[i] + 3 * 3600 * 1000);
    out.idx.push(i);
    out.x.push(RAIN_FEATURES.map((f) => inputs[f]));
    out.y.push(ahead >= WET_MM ? 1 : 0);
    out.month.push(local.getUTCMonth());
    out.hour.push(local.getUTCHours());
  }
  return out;
}

export interface Logistic {
  features: RainFeature[];
  mean: number[];
  std: number[];
  intercept: number;
  coef: number[];
}

/**
 * Logistic regression by iteratively reweighted least squares on inputs
 * standardised over the training rows, with an L2 penalty on the slopes.
 */
export function fitLogistic(s: RainSamples, rows: number[], features: readonly RainFeature[]): Logistic {
  const cols = features.map((f) => RAIN_FEATURES.indexOf(f));
  const n = rows.length;
  const mean = cols.map((c) => rows.reduce((sum, r) => sum + s.x[r][c], 0) / n);
  const std = cols.map((c, j) => Math.sqrt(rows.reduce((sum, r) => sum + (s.x[r][c] - mean[j]) ** 2, 0) / n) || 1);
  const design = rows.map((r) => [1, ...cols.map((c, j) => (s.x[r][c] - mean[j]) / std[j])]);
  const p = cols.length + 1;
  const w = new Array<number>(p).fill(0);
  for (let it = 0; it < 100; it++) {
    const hessian = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const gradient = new Array<number>(p).fill(0);
    design.forEach((x, k) => {
      const prob = 1 / (1 + Math.exp(-x.reduce((sum, v, j) => sum + v * w[j], 0)));
      const weight = prob * (1 - prob);
      const residual = s.y[rows[k]] - prob;
      for (let i = 0; i < p; i++) {
        gradient[i] += residual * x[i];
        for (let j = i; j < p; j++) hessian[i][j] += weight * x[i] * x[j];
      }
    });
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < i; j++) hessian[i][j] = hessian[j][i];
      if (i > 0) {
        hessian[i][i] += LAMBDA;
        gradient[i] -= LAMBDA * w[i];
      }
    }
    const step = solve(hessian, gradient);
    step.forEach((d, j) => (w[j] += d));
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  return { features: [...features], mean, std, intercept: w[0], coef: w.slice(1) };
}

export function predictLogistic(m: Logistic, x: number[]): number {
  let z = m.intercept;
  m.features.forEach((f, j) => {
    z += m.coef[j] * ((x[RAIN_FEATURES.indexOf(f)] - m.mean[j]) / m.std[j]);
  });
  return 1 / (1 + Math.exp(-z));
}

/** The hand-set rule the app used before, from rain now, the pressure fall and humidity. */
function previousRule(s: RainSamples, r: number, rain: number[]): number {
  const x = (f: RainFeature) => s.x[r][RAIN_FEATURES.indexOf(f)];
  if (rain[s.idx[r]] > 0) return 0.85;
  let score = 0.05;
  if (x("pressure_change_1h") < -0.5) score += 0.2;
  if (x("pressure_change_1h") < -1.2) score += 0.15;
  if (x("humidity") > 80) score += 0.15;
  if (x("humidity") > 90) score += 0.1;
  return Math.min(0.92, score);
}

const brier = (p: number[], y: number[]) => p.reduce((sum, v, k) => sum + (v - y[k]) ** 2, 0);

const monthOf = (a: Archive, i: number) => a.month[i];

/**
 * Fits the candidates month by month, picks the one with the lowest Brier
 * score (a tie to the one with fewer inputs), and fits it on the whole
 * archive. Falls back to the month-by-hour frequency of rain if no candidate
 * beats each month's own frequency.
 */
export function fitRain(a: Archive, months: string[]) {
  const rain = rainBySlot(a, readGauge());
  const s = rainSamples(a, rain);
  const all = s.idx.map((_, r) => r);
  const baseRate = s.y.reduce((x, y) => x + y, 0) / s.y.length;

  const byMonth = months.map((month) => {
    const start = Date.parse(`${month}-01T00:00:00Z`);
    const train = all.filter((r) => a.ms[s.idx[r] + AHEAD_SLOTS] < start);
    const test = all.filter((r) => monthOf(a, s.idx[r]) === month);
    const y = test.map((r) => s.y[r]);
    const trainRate = train.reduce((x, r) => x + s.y[r], 0) / train.length;
    const ownRate = y.reduce((x, v) => x + v, 0) / y.length;
    const forecasts = Object.fromEntries(
      Object.entries(RAIN_CANDIDATES).map(([name, features]) => {
        const m = fitLogistic(s, train, features);
        return [name, test.map((r) => predictLogistic(m, s.x[r]))];
      }),
    );
    return {
      month,
      test,
      y,
      forecasts,
      previous: test.map((r) => previousRule(s, r, rain)),
      ownRate: test.map(() => ownRate),
      trainRate: test.map(() => trainRate),
    };
  });

  const pooled = (pick: (m: (typeof byMonth)[number]) => number[]) =>
    byMonth.reduce((sum, m) => sum + brier(pick(m), m.y), 0) / byMonth.reduce((sum, m) => sum + m.y.length, 0);
  const monthlyClimatology = pooled((m) => m.ownRate);
  const priorBaseRate = pooled((m) => m.trainRate);
  const skill = (b: number, ref: number) => round(1 - b / ref, 3);
  const candidates = Object.fromEntries(
    Object.keys(RAIN_CANDIDATES).map((name) => {
      const b = pooled((m) => m.forecasts[name]);
      return [name, { brier: round(b, 5), skill_vs_monthly_climatology: skill(b, monthlyClimatology) }];
    }),
  );
  const names = Object.keys(RAIN_CANDIDATES);
  const best = Math.min(...names.map((n) => candidates[n].brier));
  const chosen = names.find((n) => candidates[n].brier <= best + TIE_BRIER)!;
  const chosenBrier = pooled((m) => m.forecasts[chosen]);
  const useModel = chosenBrier < monthlyClimatology;

  const p = byMonth.flatMap((m) => m.forecasts[chosen]);
  const y = byMonth.flatMap((m) => m.y);
  const bins = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0001];
  const calibration = bins.slice(0, -1).map((from, k) => {
    const inBin = p.map((v, j) => j).filter((j) => p[j] >= from && p[j] < bins[k + 1]);
    return {
      from,
      to: Math.min(1, bins[k + 1]),
      n: inBin.length,
      mean_probability: inBin.length ? round(inBin.reduce((x, j) => x + p[j], 0) / inBin.length, 3) : null,
      observed: inBin.length ? round(inBin.reduce((x, j) => x + y[j], 0) / inBin.length, 3) : null,
    };
  });
  const flagged = p.map((v, j) => j).filter((j) => p[j] >= HALF);
  const wet = y.reduce((x, v) => x + v, 0);
  const previous = byMonth.flatMap((m) => m.previous);
  const previousFlagged = previous.map((v, j) => j).filter((j) => previous[j] >= HALF);
  const atHalf = (hits: number[]) => ({
    share_pct: round((hits.length / y.length) * 100, 1),
    rained_pct: round((hits.filter((j) => y[j] === 1).length / hits.length) * 100, 1),
    wet_windows_caught_pct: round((hits.filter((j) => y[j] === 1).length / wet) * 100, 1),
  });

  // Rain frequency by local month and hour, from every labelled origin.
  const monthHour = Array.from({ length: 12 }, (_, mo) =>
    Array.from({ length: 24 }, (_, h) => {
      const cell = all.filter((r) => s.month[r] === mo && s.hour[r] === h);
      return round(cell.length ? cell.reduce((x, r) => x + s.y[r], 0) / cell.length : baseRate, 3);
    }),
  );

  const production = fitLogistic(s, all, RAIN_CANDIDATES[chosen]);
  return {
    fitted_on: "data/conduit_master_2025_2026.csv",
    target: TARGET,
    kind: useModel ? "logistic" : "climatology",
    method: useModel
      ? "Logistic regression (iteratively reweighted least squares, L2 penalty 1 on standardised inputs), " +
        "fitted on every 15-minute slot of the archive whose inputs were measured and whose next 3 hours of " +
        "rain are known from gauge 1's counters"
      : "The share of 3-hour windows with rain at that local month and hour, because no fitted model beat " +
        "each month's own rain frequency on months it had not seen",
    features: production.features,
    feature_mean: production.mean.map((v) => round(v, 5)),
    feature_std: production.std.map((v) => round(v, 5)),
    intercept: round(production.intercept, 5),
    coef: production.coef.map((v) => round(v, 5)),
    base_rate: round(baseRate, 4),
    n_samples: s.y.length,
    month_hour: monthHour,
    evaluation: {
      method:
        "Rolling origin by calendar month (UTC): each month is forecast by the candidates refitted on every " +
        "origin whose 3-hour window ends before the month starts. Brier scores pool all forecasts. The monthly " +
        "climatology forecasts each month's own rain frequency, known only afterwards; the base rate forecasts " +
        "the frequency in the months before.",
      months,
      candidates,
      chosen,
      brier: round(chosenBrier, 5),
      brier_monthly_climatology: round(monthlyClimatology, 5),
      skill_vs_monthly_climatology: skill(chosenBrier, monthlyClimatology),
      brier_base_rate: round(priorBaseRate, 5),
      skill_vs_base_rate: skill(chosenBrier, priorBaseRate),
      previous_rule: {
        brier: round(pooled((m) => m.previous), 5),
        skill_vs_monthly_climatology: skill(pooled((m) => m.previous), monthlyClimatology),
        skill_vs_base_rate: skill(pooled((m) => m.previous), priorBaseRate),
        at_half: atHalf(previousFlagged),
      },
      by_month: byMonth.map((m) => ({
        month: m.month,
        n: m.y.length,
        rain_pct: round((m.y.reduce((x, v) => x + v, 0) / m.y.length) * 100, 1),
        brier: round(brier(m.forecasts[chosen], m.y) / m.y.length, 5),
        brier_monthly_climatology: round(brier(m.ownRate, m.y) / m.y.length, 5),
      })),
      calibration,
      at_half: atHalf(flagged),
      n: y.length,
    },
  };
}
