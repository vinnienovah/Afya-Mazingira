import type { FeatureVector } from "./feature-engine";
import type { ForecastPoint, HorizonForecast } from "./types";
import model from "./model/wbgt-forecast.json";

// WBGT forecast out to nine hours: one ridge regression for each 15-minute
// step ahead, fitted on the Conduit archive by scripts/fit-models.ts. The
// band around each step is the 80th percentile of that step's absolute error
// on the calibration months; scores come from test months the fit never saw.

type Step = (typeof model.steps)[number];

export const HORIZON_STEPS = { "1h": 4, "3h": 12, "6h": 24, "9h": 36 } as const;
export type Horizon = keyof typeof HORIZON_STEPS;

export const FORECAST_METHOD = model.method;
export const FORECAST_PERIODS = model.periods;

function stepModel(step: number): Step {
  return model.steps[step - 1];
}

function predictStep(fv: FeatureVector, step: number): number {
  const m = stepModel(step);
  let value = m.intercept;
  model.features.forEach((name, j) => {
    const x = (fv[name as keyof FeatureVector] - model.feature_mean[j]) / model.feature_std[j];
    value += m.coef[j] * x;
  });
  return value;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Test-month scores for a horizon, for the model table on the Why? page. */
export function horizonScores(horizon: Horizon) {
  const m = stepModel(HORIZON_STEPS[horizon]);
  return {
    mae: m.test_mae,
    persistence_mae: m.persistence_mae,
    band80: m.band80,
    coverage80: m.coverage80,
    band_same_pct: m.band_same_pct,
    band_lower_pct: m.band_lower_pct,
    n_test: m.n_test,
  };
}

/** Forecast WBGT at +1, +3, +6 or +9 hours, with its 80 % band. */
export function predictHorizon(fv: FeatureVector, horizon: Horizon): HorizonForecast {
  const step = HORIZON_STEPS[horizon];
  const value = round1(predictStep(fv, step));
  const band = stepModel(step).band80;
  return {
    horizon,
    value,
    lower: round1(value - band),
    upper: round1(value + band),
    model: "Ridge regression",
    model_version: model.periods.test[1],
  };
}

/** The forecast every 15 minutes from now to +9 hours, for charting. */
export function buildForecastSeries(fv: FeatureVector, nowIso: string): ForecastPoint[] {
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
  for (let step = 1; step <= model.steps.length; step++) {
    const value = round1(predictStep(fv, step));
    const band = stepModel(step).band80;
    points.push({
      time: new Date(base + step * 15 * 60 * 1000).toISOString(),
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
