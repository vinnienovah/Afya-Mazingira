import { test } from "node:test";
import assert from "node:assert/strict";
import forecastModel from "../src/lib/afya/model/wbgt-forecast.json";
import stateModel from "../src/lib/afya/model/states.json";
import evaluation from "../src/lib/afya/model/forecast-evaluation.json";
import { STATE_FEATURES, type FeatureVector } from "../src/lib/afya/feature-engine";
import { HORIZON_STEPS, horizonScores, type Horizon } from "../src/lib/afya/forecast-engine";
import { classifyState } from "../src/lib/afya/state-engine";
import { STATES } from "../src/lib/afya/constants";
import { STRINGS } from "../src/lib/afya/i18n";

const HORIZONS = Object.keys(HORIZON_STEPS) as Horizon[];

test("the app ships the forecast the month-by-month test chose, for every step to nine hours", () => {
  assert.equal(forecastModel.kind, evaluation.chosen);
  assert.equal(forecastModel.steps.length, 36);
  forecastModel.steps.forEach((s, k) => {
    assert.equal(s.step, k + 1);
    assert.equal(s.band80_by_block.length, 8);
  });
});

test("the forecast beats assuming no change at every horizon, on months it never saw", () => {
  for (const h of HORIZONS) {
    const s = horizonScores(h);
    assert.ok(s.mae < s.persistence_mae, `${h}: ${s.mae} vs ${s.persistence_mae}`);
  }
});

test("on the test months the 80 % band holds close to 80 % of the errors", () => {
  for (const h of HORIZONS) {
    const s = horizonScores(h);
    assert.ok(s.coverage80 >= 0.76 && s.coverage80 <= 0.86, `${h}: ${s.coverage80}`);
  }
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

test("the hot state is named for its heat: its light readings are below the warming state's", () => {
  const [, warming, hot] = stateModel.summary;
  assert.ok(hot.mean_temp_c > warming.mean_temp_c);
  assert.ok(hot.mean_ir_counts < warming.mean_ir_counts);
  assert.doesNotMatch(STATES[2].name, /radiation/i);
  assert.equal(STATES[2].name, STRINGS.en.state_2);
  assert.equal(STATES[2].name_sw, STRINGS.sw.state_2);
});
