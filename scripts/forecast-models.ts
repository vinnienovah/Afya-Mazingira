// The WBGT forecast candidates, fitted and scored the same way by the
// production fit (fit-models.ts) and the month-by-month test
// (evaluate-forecast.ts):
//
//   no_change       WBGT stays at its current value
//   seasonal        the usual WBGT at the target time of day, plus the current
//                   departure from usual times a factor fitted for each step
//   ridge           ridge regression on the station features
//   ridge_seasonal  the same ridge, given the usual WBGT now and at the target
//                   time and the current departure as three more inputs
//
// "Usual" is the mean for that 15-minute time of day over the 30 days before
// the forecast is made, so no candidate sees anything after its origin.

import { getCsvCoverage, getCsvRange } from "../src/lib/afya/csv-source";
import type { DemoObservation } from "../src/lib/afya/demo-observations";
import { buildFeatureSeries, FORECAST_FEATURES, type FeatureVector } from "../src/lib/afya/feature-engine";
import { BLOCK_HOURS, rollingClimatology, timeOfDayBlock } from "../src/lib/afya/climatology";
import { SEASONAL_INPUTS } from "../src/lib/afya/forecast-engine";
import { featureScale, fitRidge, forecastOrigins, mean, usableOrigins } from "./ridge";

/** Simplest first: a tie on error goes to the earlier one. */
export const MODEL_KINDS = ["no_change", "seasonal", "ridge", "ridge_seasonal"] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export const MODEL_NAMES: Record<ModelKind, string> = {
  no_change: "No change",
  seasonal: "Seasonal anomaly",
  ridge: "Ridge regression",
  ridge_seasonal: "Ridge regression with seasonal terms",
};

export const MAX_STEP = 36;
export const BLOCKS = 24 / BLOCK_HOURS;
const SLOT_MS = 15 * 60 * 1000;
const WIDTH = MAX_STEP + 1;

export interface Archive {
  series: DemoObservation[];
  features: (FeatureVector | null)[];
  usable: boolean[];
  /** Usual WBGT before each slot, MAX_STEP + 1 leads per slot (see rollingClimatology). */
  clim: Float64Array;
  /** Usable origins with a measured target, for each step ahead (index 0 unused). */
  origins: number[][];
  month: string[];
  ms: number[];
  coverage: { minIso: string; maxIso: string };
}

export function loadArchive(): Archive {
  const coverage = getCsvCoverage();
  if (!coverage) throw new Error("no Conduit archive found under data/");
  const series = getCsvRange(coverage.minIso, coverage.maxIso);
  const features = buildFeatureSeries(series);
  const usable = usableOrigins(series, features);
  const origins: number[][] = [[]];
  for (let step = 1; step <= MAX_STEP; step++) origins.push(forecastOrigins(series, usable, step));
  return {
    series,
    features,
    usable,
    clim: rollingClimatology(series, MAX_STEP),
    origins,
    month: series.map((o) => o.ts.slice(0, 7)),
    ms: series.map((o) => Date.parse(o.ts)),
    coverage,
  };
}

export const observed = (a: Archive, i: number) => a.series[i].wet_bulb_globe_temp;
export const usualNow = (a: Archive, i: number) => a.clim[i * WIDTH];
export const usualAt = (a: Archive, i: number, step: number) => a.clim[i * WIDTH + step];

export function hasUsual(a: Archive, i: number, step: number): boolean {
  return Number.isFinite(usualNow(a, i)) && Number.isFinite(usualAt(a, i, step));
}

/** Time-of-day block of the slot `step` ahead of origin i. */
export function targetBlock(a: Archive, i: number, step: number): number {
  return timeOfDayBlock(a.ms[i] + step * SLOT_MS);
}

export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Scale {
  mu: number[];
  sd: number[];
}

/** Feature scaling from the usable slots of the months before `month`. */
export function scaleBefore(a: Archive, month: string): Scale {
  const idx = a.series.map((_, i) => i).filter((i) => a.usable[i] && a.month[i] < month);
  return featureScale(a.features, idx, FORECAST_FEATURES);
}

export interface FittedStep {
  predict: (i: number) => number;
  /** What the production model file stores for this step. */
  params: Record<string, number | number[]>;
  nTrain: number;
}

function standardised(a: Archive, i: number, scale: Scale): number[] {
  return FORECAST_FEATURES.map((name, j) => (a.features[i]![name] - scale.mu[j]) / scale.sd[j]);
}

function seasonalInputs(a: Archive, i: number, step: number): number[] {
  return [usualNow(a, i), usualAt(a, i, step), observed(a, i) - usualNow(a, i)];
}

/** Fit one candidate for one step ahead on the given training origins. */
export function fitStep(
  a: Archive,
  kind: ModelKind,
  step: number,
  train: number[],
  scale: Scale | null,
): FittedStep {
  const seasonalTrain = train.filter((i) => hasUsual(a, i, step));
  switch (kind) {
    case "no_change":
      return { predict: (i) => observed(a, i), params: {}, nTrain: 0 };
    case "seasonal": {
      let sxy = 0;
      let sxx = 0;
      for (const i of seasonalTrain) {
        const now = observed(a, i) - usualNow(a, i);
        sxy += now * (observed(a, i + step) - usualAt(a, i, step));
        sxx += now * now;
      }
      const factor = sxy / sxx;
      return {
        predict: (i) => usualAt(a, i, step) + factor * (observed(a, i) - usualNow(a, i)),
        params: { a: factor },
        nTrain: seasonalTrain.length,
      };
    }
    case "ridge": {
      if (!scale) throw new Error("ridge needs a feature scale");
      const fit = fitRidge(train.map((i) => ({ x: standardised(a, i, scale), y: observed(a, i + step) })));
      return {
        predict: (i) => fit.predict(standardised(a, i, scale)),
        params: { intercept: fit.intercept, coef: fit.coef },
        nTrain: train.length,
      };
    }
    case "ridge_seasonal": {
      if (!scale) throw new Error("ridge needs a feature scale");
      const extra = seasonalTrain.map((i) => seasonalInputs(a, i, step));
      const mu = SEASONAL_INPUTS.map((_, j) => mean(extra.map((e) => e[j])));
      const sd = SEASONAL_INPUTS.map((_, j) => Math.sqrt(mean(extra.map((e) => (e[j] - mu[j]) ** 2))) || 1);
      const x = (i: number) => [
        ...standardised(a, i, scale),
        ...seasonalInputs(a, i, step).map((v, j) => (v - mu[j]) / sd[j]),
      ];
      const fit = fitRidge(seasonalTrain.map((i) => ({ x: x(i), y: observed(a, i + step) })));
      return {
        predict: (i) => fit.predict(x(i)),
        params: { intercept: fit.intercept, coef: fit.coef, seasonal_mean: mu, seasonal_std: sd },
        nTrain: seasonalTrain.length,
      };
    }
  }
}

export interface MonthForecasts {
  month: string;
  /** Origins in the month, in time order. */
  idx: number[];
  /** Forecast for each origin. */
  pred: number[];
  nTrain: number;
}

/**
 * Month-by-month forecasts `step` ahead: each month is forecast by the
 * candidate refitted on every origin whose target falls before the month.
 */
export function rollingForecasts(a: Archive, kind: ModelKind, step: number, months: string[]): MonthForecasts[] {
  const needsScale = kind === "ridge" || kind === "ridge_seasonal";
  const needsUsual = kind === "seasonal" || kind === "ridge_seasonal";
  return months.map((month) => {
    const all = a.origins[step];
    const train = all.filter((i) => a.month[i + step] < month);
    const test = all.filter((i) => a.month[i] === month);
    if (!test.length) throw new Error(`no measured origins in ${month} at step ${step}`);
    if (needsUsual && test.some((i) => !hasUsual(a, i, step))) {
      throw new Error(`${month} has origins without 30 days of usual values`);
    }
    const fitted = fitStep(a, kind, step, train, needsScale ? scaleBefore(a, month) : null);
    return { month, idx: test, pred: test.map(fitted.predict), nTrain: fitted.nTrain };
  });
}

/**
 * Half-width of the band holding the share `q` of absolute errors, for each
 * time-of-day block of the target. A block with no errors takes the band of
 * all blocks together.
 */
export function bandsByBlock(absErrors: number[], blocks: number[], q: number): number[] {
  const all = quantile(absErrors, q);
  return Array.from({ length: BLOCKS }, (_, b) => {
    const inBlock = absErrors.filter((_, k) => blocks[k] === b);
    return inBlock.length ? quantile(inBlock, q) : all;
  });
}
