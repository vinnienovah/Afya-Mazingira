import type { FeatureVector } from "./feature-engine";
import type { ForecastPoint, HorizonForecast } from "./types";
import { timeOfDayBlock, usualAt, type Climatology } from "./climatology";
import modelFile from "./model/wbgt-forecast.json";

// WBGT forecast out to nine hours, one fitted step for each 15 minutes ahead.
// scripts/evaluate-forecast.ts tests four candidates month by month and
// scripts/fit-models.ts fits the one it picked. The shipped model starts from
// the usual WBGT for the target's time of day and adds how far the latest
// reading sits from usual now, times a factor fitted for each step. The band
// around each step is the 80th percentile of the errors made on months held
// out of the fit, for the three-hour block of the day the target falls in.

export interface ForecastStep {
  step: number;
  a?: number;
  intercept?: number;
  coef?: number[];
  seasonal_mean?: number[];
  seasonal_std?: number[];
  band80: number;
  band80_by_block: number[];
  persistence_band80: number;
  test_mae: number;
  test_rmse: number;
  persistence_mae: number;
  coverage80: number;
  band_same_pct: number;
  band_lower_pct: number;
  n_test: number;
}

export interface ForecastModel {
  /** "no_change", "seasonal", "ridge" or "ridge_seasonal" (see scripts/forecast-models.ts). */
  kind: string;
  name: string;
  method: string;
  periods: { train: string[]; calibration: string[]; test: string[] };
  features?: string[];
  feature_mean?: number[];
  feature_std?: number[];
  steps: ForecastStep[];
}

const model = modelFile as ForecastModel;

export const HORIZON_STEPS = { "1h": 4, "3h": 12, "6h": 24, "9h": 36 } as const;
export type Horizon = keyof typeof HORIZON_STEPS;

/** Inputs the seasonal ridge adds after the station features, in coefficient order. */
export const SEASONAL_INPUTS = ["usual_now", "usual_at_target", "departure_now"];

export const FORECAST_MODEL_NAME = model.name;
export const FORECAST_MODEL_KIND = model.kind;
export const FORECAST_METHOD = model.method;
export const FORECAST_PERIODS = model.periods;

const SLOT_MS = 15 * 60 * 1000;
const NO_CHANGE_NAME = "No change";

/** What a forecast is made from: the latest features, their time, and the usual WBGT by time of day. */
export interface ForecastInputs {
  fv: FeatureVector;
  nowIso: string;
  climatology: Climatology | null;
}

function stepModel(step: number): ForecastStep {
  return model.steps[step - 1];
}

/** True when the model can run; without the usual values it falls back to no change. */
function canRun(inputs: ForecastInputs, m: ForecastModel): boolean {
  return (m.kind !== "seasonal" && m.kind !== "ridge_seasonal") || inputs.climatology !== null;
}

interface Term {
  feature: string;
  contribution_c: number;
}

/**
 * The forecast `step` ahead as a baseline plus one term per input. For the
 * seasonal model the baseline is the current reading and the terms are the
 * usual change over the next `step` slots and the part of today's departure
 * from usual expected to fade; for a ridge they are each standardised input
 * times its coefficient, around the mean forecast.
 */
function decompose(inputs: ForecastInputs, step: number, m: ForecastModel): { baseline: number; terms: Term[] } {
  const { fv, nowIso, climatology } = inputs;
  const s = m.steps[step - 1];
  const now = fv.wet_bulb_globe_temp;
  if (!canRun(inputs, m) || m.kind === "no_change") return { baseline: now, terms: [] };

  const nowMs = Date.parse(nowIso);
  const usualNow = climatology ? usualAt(climatology, nowMs) : NaN;
  const usualThen = climatology ? usualAt(climatology, nowMs + step * SLOT_MS) : NaN;
  if (m.kind === "seasonal") {
    return {
      baseline: now,
      terms: [
        { feature: "usual_daily_change", contribution_c: usualThen - usualNow },
        { feature: "departure_from_usual", contribution_c: (s.a! - 1) * (now - usualNow) },
      ],
    };
  }

  const names = m.features!;
  const terms: Term[] = names.map((name, j) => ({
    feature: name,
    contribution_c: s.coef![j] * ((fv[name as keyof FeatureVector] - m.feature_mean![j]) / m.feature_std![j]),
  }));
  if (m.kind === "ridge_seasonal") {
    const seasonal = [usualNow, usualThen, now - usualNow];
    SEASONAL_INPUTS.forEach((name, j) => {
      const z = (seasonal[j] - s.seasonal_mean![j]) / s.seasonal_std![j];
      terms.push({ feature: name, contribution_c: s.coef![names.length + j] * z });
    });
  }
  return { baseline: s.intercept!, terms };
}

function predictStep(inputs: ForecastInputs, step: number, m: ForecastModel): number {
  const { baseline, terms } = decompose(inputs, step, m);
  return terms.reduce((sum, t) => sum + t.contribution_c, baseline);
}

function bandAt(inputs: ForecastInputs, step: number, m: ForecastModel): number {
  const s = m.steps[step - 1];
  if (!canRun(inputs, m)) return s.persistence_band80;
  return s.band80_by_block[timeOfDayBlock(Date.parse(inputs.nowIso) + step * SLOT_MS)];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Test-month scores for a horizon, for the model table on the Why? page. */
export function horizonScores(horizon: Horizon) {
  const m = stepModel(HORIZON_STEPS[horizon]);
  return {
    mae: m.test_mae,
    rmse: m.test_rmse,
    persistence_mae: m.persistence_mae,
    band80: m.band80,
    band80_by_block: m.band80_by_block,
    coverage80: m.coverage80,
    band_same_pct: m.band_same_pct,
    band_lower_pct: m.band_lower_pct,
    n_test: m.n_test,
  };
}

/** Forecast WBGT at +1, +3, +6 or +9 hours, with its 80 % band. */
export function predictHorizon(inputs: ForecastInputs, horizon: Horizon, m: ForecastModel = model): HorizonForecast {
  const step = HORIZON_STEPS[horizon];
  const value = round1(predictStep(inputs, step, m));
  const band = bandAt(inputs, step, m);
  return {
    horizon,
    value,
    lower: round1(value - band),
    upper: round1(value + band),
    model: canRun(inputs, m) ? m.name : NO_CHANGE_NAME,
    model_version: m.periods.test[1],
  };
}

/**
 * What moves the forecast `horizon` ahead away from its baseline, in °C.
 * The terms and the baseline add up to the forecast before rounding.
 */
export function forecastContributions(inputs: ForecastInputs, horizon: Horizon, m: ForecastModel = model) {
  const step = HORIZON_STEPS[horizon];
  const { baseline, terms } = decompose(inputs, step, m);
  return { baseline, value: predictStep(inputs, step, m), terms };
}

/** The forecast every 15 minutes from now to +9 hours, for charting. */
export function buildForecastSeries(inputs: ForecastInputs, m: ForecastModel = model): ForecastPoint[] {
  const { fv, nowIso } = inputs;
  const base = new Date(nowIso).getTime();
  const points: ForecastPoint[] = [
    {
      time: nowIso,
      value: fv.wet_bulb_globe_temp,
      lower: fv.wet_bulb_globe_temp,
      upper: fv.wet_bulb_globe_temp,
      horizon_minutes: 0,
    },
  ];
  for (let step = 1; step <= m.steps.length; step++) {
    const value = round1(predictStep(inputs, step, m));
    const band = bandAt(inputs, step, m);
    points.push({
      time: new Date(base + step * SLOT_MS).toISOString(),
      value,
      lower: round1(value - band),
      upper: round1(value + band),
      horizon_minutes: step * 15,
    });
  }
  return points;
}

/** Find expected peak time from forecast series. */
export function findExpectedPeak(series: ForecastPoint[]): { time: string; wbgt_c: number } | null {
  if (!series.length) return null;
  let peak = series[0];
  for (const p of series) {
    if (p.value > peak.value) peak = p;
  }
  return { time: peak.time, wbgt_c: peak.value };
}
