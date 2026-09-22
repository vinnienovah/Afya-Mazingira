import { test } from "node:test";
import assert from "node:assert/strict";
import forecastModel from "../src/lib/afya/model/wbgt-forecast.json";
import evaluation from "../src/lib/afya/model/forecast-evaluation.json";
import { computeClimatology, type Climatology } from "../src/lib/afya/climatology";
import { getClimatology } from "../src/lib/afya/climatology-source";
import { getCsvRange } from "../src/lib/afya/csv-source";
import {
  buildForecastSeries,
  forecastContributions,
  HORIZON_STEPS,
  predictHorizon,
  type ForecastModel,
  type Horizon,
} from "../src/lib/afya/forecast-engine";
import {
  bandsByBlock,
  fitStep,
  loadArchive,
  MODEL_KINDS,
  observed,
  rollingForecasts,
  targetBlock,
  usualAt,
  usualNow,
  type ModelKind,
} from "../scripts/forecast-models";

const a = loadArchive();
const HORIZONS = Object.keys(HORIZON_STEPS) as Horizon[];
const DAY_MS = 86_400_000;
const chosen = evaluation.chosen as ModelKind;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const indexOf = (iso: string) => a.series.findIndex((o) => o.ts === iso);

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  const d = new Date(`${first}-01T00:00:00Z`);
  while (d.toISOString().slice(0, 7) <= last) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/** The runtime's usual values for an origin, read from the archive as the app reads them. */
function runtimeClimatology(originIso: string): Climatology {
  const origin = Date.parse(originIso);
  const series = getCsvRange(new Date(origin - 30 * DAY_MS).toISOString(), originIso);
  return computeClimatology(series, [[origin - 30 * DAY_MS, origin]], "archive");
}

test("the shipped forecast has the lowest month-by-month error of the four candidates, ties to the simpler", () => {
  const models = evaluation.models as Record<ModelKind, { overall: Record<Horizon, { mae: number }> }>;
  for (const h of HORIZONS) {
    const lowest = Math.min(...MODEL_KINDS.map((k) => models[k].overall[h].mae));
    const mine = models[chosen].overall[h].mae;
    assert.ok(mine <= models.seasonal.overall[h].mae, `${h}: ${mine} vs seasonal ${models.seasonal.overall[h].mae}`);
    assert.ok(mine <= lowest + 0.005, `${h}: ${mine} vs lowest ${lowest}`);
    assert.ok(mine < models.ridge.overall[h].mae, `${h}: ${mine} vs ridge ${models.ridge.overall[h].mae}`);
  }
});

test("the month-by-month scores come out the same when recomputed from the archive", () => {
  const step = HORIZON_STEPS["3h"];
  for (const kind of ["seasonal", "ridge"] as const) {
    const [feb] = rollingForecasts(a, kind, step, ["2026-02"]);
    const mae = feb.idx.reduce((s, i, k) => s + Math.abs(observed(a, i + step) - feb.pred[k]), 0) / feb.idx.length;
    const stored = evaluation.models[kind].by_month.find((m) => m.month === "2026-02")!.horizons["3h"];
    assert.equal(round3(mae), stored.mae, kind);
    assert.equal(feb.idx.length, stored.n, kind);
  }
});

test("in the hot season the 80 % band holds at least 78 % of errors it never saw, at every horizon", () => {
  const months = monthsBetween("2025-08", "2026-03");
  for (const h of HORIZONS) {
    const step = HORIZON_STEPS[h];
    const forecasts = rollingForecasts(a, chosen, step, months);
    let covered = 0;
    let n = 0;
    forecasts.forEach((f, j) => {
      if (f.month < "2026-01") return;
      const prior = forecasts.slice(0, j);
      const bands = bandsByBlock(
        prior.flatMap((p) => p.idx.map((i, k) => Math.abs(observed(a, i + step) - p.pred[k]))),
        prior.flatMap((p) => p.idx.map((i) => targetBlock(a, i, step))),
        0.8,
      );
      f.idx.forEach((i, k) => {
        if (Math.abs(observed(a, i + step) - f.pred[k]) <= bands[targetBlock(a, i, step)]) covered++;
        n++;
      });
    });
    assert.ok(covered / n >= 0.78, `${h}: ${covered / n}`);
    assert.equal(round3(covered / n), evaluation.seasons.hot.horizons[h].coverage80, h);
    assert.ok(evaluation.seasons.other.horizons[h].coverage80 >= 0.78, `${h} other months`);
  }
});

test("refitting the shipped forecast gives the stored factors", () => {
  const testFrom = Date.parse(`${forecastModel.periods.test[0]}T00:00:00Z`);
  for (const step of [1, 12, 36]) {
    const train = a.origins[step].filter((i) => a.ms[i + step] < testFrom);
    const fitted = fitStep(a, chosen, step, train, null);
    assert.equal(Math.round((fitted.params.a as number) * 1e5) / 1e5, forecastModel.steps[step - 1].a, `step ${step}`);
  }
});

test("the forecast the app makes at an archive time is the one that was scored", () => {
  const originIso = "2026-07-15T06:00:00.000Z"; // 09:00 in Juja
  const i = indexOf(originIso);
  const climatology = runtimeClimatology(originIso);
  for (const h of HORIZONS) {
    const step = HORIZON_STEPS[h];
    assert.ok(Math.abs(climatology.mean[(36 + step) % 96] - usualAt(a, i, step)) < 1e-9, h);
    const scored = usualAt(a, i, step) + forecastModel.steps[step - 1].a * (observed(a, i) - usualNow(a, i));
    const f = predictHorizon({ fv: a.features[i]!, nowIso: originIso, climatology }, h);
    assert.equal(f.value, Math.round(scored * 10) / 10, h);
    assert.equal(f.model, "Seasonal anomaly");
  }
});

test("a replay inside the archive takes its usual values from the archive and never the network", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network used in a test");
  }) as typeof fetch;
  try {
    const originIso = "2026-02-10T09:00:00.000Z";
    const c = await getClimatology(originIso);
    assert.ok(c);
    assert.equal(c.source, "archive");
    assert.ok(Date.parse(c.to) <= Date.parse(originIso));
    const i = indexOf(originIso);
    assert.ok(Math.abs(c.mean[48] - usualNow(a, i)) < 1e-9); // 12:00 in Juja
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("without enough days before it, the forecast falls back to no change and says so", async () => {
  const originIso = "2025-06-05T06:00:00.000Z";
  assert.equal(await getClimatology(originIso), null);
  const i = indexOf(originIso);
  const f = predictHorizon({ fv: a.features[i]!, nowIso: originIso, climatology: null }, "3h");
  assert.equal(f.value, Math.round(observed(a, i) * 10) / 10);
  assert.equal(f.model, "No change");
  assert.ok(f.upper - f.value > 1);
});

test("the band follows the time of day the forecast is for", () => {
  const originIso = "2026-07-15T06:00:00.000Z";
  const inputs = { fv: a.features[indexOf(originIso)]!, nowIso: originIso, climatology: runtimeClimatology(originIso) };
  const series = buildForecastSeries(inputs);
  const at = (hours: number) => series[hours * 4];
  // +3 h lands at 12:00 (block 4), +9 h at 18:00 (block 6)
  const bands = forecastModel.steps.map((s) => s.band80_by_block);
  assert.ok(Math.abs(at(3).upper - at(3).value - bands[11][4]) < 0.06);
  assert.ok(Math.abs(at(9).upper - at(9).value - bands[35][6]) < 0.06);
  // an hour ahead, midday is harder to forecast than the small hours
  assert.ok(bands[3][4] > bands[3][0] + 0.2);
});

test("the seasonal forecast is the current reading plus the usual change plus the fading departure", () => {
  const originIso = "2026-02-10T09:00:00.000Z";
  const i = indexOf(originIso);
  const inputs = { fv: a.features[i]!, nowIso: originIso, climatology: runtimeClimatology(originIso) };
  for (const h of HORIZONS) {
    const { baseline, value, terms } = forecastContributions(inputs, h);
    assert.equal(baseline, observed(a, i));
    assert.deepEqual(terms.map((t) => t.feature), ["usual_daily_change", "departure_from_usual"]);
    assert.ok(Math.abs(baseline + terms[0].contribution_c + terms[1].contribution_c - value) < 1e-9, h);
    assert.equal(Math.round(value * 10) / 10, predictHorizon(inputs, h).value, h);
  }
});

test("a ridge's terms add up to its forecast less its mean", () => {
  const i = indexOf("2026-02-10T09:00:00.000Z");
  const fv = a.features[i]!;
  const step = {
    ...forecastModel.steps[0],
    intercept: 20,
    coef: [0.8, -0.3, 0.1],
  };
  const ridge: ForecastModel = {
    kind: "ridge",
    name: "Ridge regression",
    method: "test",
    periods: forecastModel.periods,
    features: ["wet_bulb_globe_temp", "humidity_sht", "wind_spd"],
    feature_mean: [18, 65, 0.5],
    feature_std: [2.5, 17, 0.5],
    steps: Array.from({ length: 36 }, (_, k) => ({ ...step, step: k + 1 })),
  };
  const inputs = { fv, nowIso: a.series[i].ts, climatology: null };
  const { baseline, value, terms } = forecastContributions(inputs, "3h", ridge);
  assert.equal(baseline, 20);
  const expected = [
    0.8 * ((fv.wet_bulb_globe_temp - 18) / 2.5),
    -0.3 * ((fv.humidity_sht - 65) / 17),
    0.1 * ((fv.wind_spd - 0.5) / 0.5),
  ];
  terms.forEach((t, j) => assert.ok(Math.abs(t.contribution_c - expected[j]) < 1e-12, t.feature));
  assert.ok(Math.abs(value - baseline - expected.reduce((x, y) => x + y, 0)) < 1e-12);
  assert.equal(predictHorizon(inputs, "3h", ridge).value, Math.round(value * 10) / 10);
});
