import { test } from "node:test";
import assert from "node:assert/strict";
import forecastModel from "../src/lib/afya/model/wbgt-forecast.json";
import stateModel from "../src/lib/afya/model/states.json";
import { FORECAST_FEATURES, STATE_FEATURES, type FeatureVector } from "../src/lib/afya/feature-engine";
import { buildForecastSeries, horizonScores, predictHorizon } from "../src/lib/afya/forecast-engine";
import { classifyState } from "../src/lib/afya/state-engine";

function meanVector(): FeatureVector {
  const fv = {} as FeatureVector;
  forecastModel.features.forEach((name, j) => {
    (fv as unknown as Record<string, number>)[name] = forecastModel.feature_mean[j];
  });
  return fv;
}

test("the fitted forecast matches the features the app computes", () => {
  assert.deepEqual(forecastModel.features, FORECAST_FEATURES);
  assert.equal(forecastModel.steps.length, 36);
  for (const s of forecastModel.steps) assert.equal(s.coef.length, FORECAST_FEATURES.length);
});

test("beyond the first hour the forecast beats assuming no change, on months it never saw", () => {
  for (const h of ["3h", "6h", "9h"] as const) {
    const s = horizonScores(h);
    assert.ok(s.mae < s.persistence_mae, `${h}: ${s.mae} vs ${s.persistence_mae}`);
  }
});

test("each horizon's band is the fitted 80 % band", () => {
  const f = predictHorizon(meanVector(), "3h");
  assert.ok(Math.abs(f.upper - f.value - horizonScores("3h").band80) < 0.06);
});

test("the series runs every 15 minutes out to nine hours", () => {
  const points = buildForecastSeries(meanVector(), "2026-09-01T09:00:00.000Z");
  assert.equal(points.length, 37);
  assert.equal(points.at(-1)!.horizon_minutes, 540);
});

test("each state's own centre is classified as that state", () => {
  assert.deepEqual(stateModel.features, STATE_FEATURES);
  stateModel.centroids.forEach((centre, state) => {
    const fv = {} as FeatureVector;
    stateModel.features.forEach((name, j) => {
      (fv as unknown as Record<string, number>)[name] =
        centre[j] * stateModel.feature_std[j] + stateModel.feature_mean[j];
    });
    assert.equal(classifyState(fv), state);
  });
});
