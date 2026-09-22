import { test } from "node:test";
import assert from "node:assert/strict";
import rainModel from "../src/lib/afya/model/rain-model.json";
import { computeRainProbability } from "../src/lib/afya/risk-engine";
import { rainInputs } from "../src/lib/afya/feature-engine";
import { loadArchive } from "../scripts/forecast-models";
import {
  fitLogistic,
  predictLogistic,
  RAIN_CANDIDATES,
  rainBetween,
  rainBySlot,
  rainSamples,
  readGauge,
} from "../scripts/rain";

const at = (iso: string) => Date.parse(iso);

test("rain between two readings is the rise in the day's counter, across the 06:00 UTC reset too", () => {
  assert.equal(rainBetween({ ms: at("2025-11-02T14:00:00Z"), total: 1.0, prior: 0 }, { ms: at("2025-11-02T14:15:00Z"), total: 1.6, prior: 0 })!.toFixed(1), "0.6");
  // 0.4 mm more fell before the reset (the day ended on 18.6), then 0.4 mm after it.
  const across = rainBetween(
    { ms: at("2025-06-20T05:54:00Z"), total: 18.2, prior: 0 },
    { ms: at("2025-06-20T06:09:00Z"), total: 0.4, prior: 18.6 },
  );
  assert.equal(across!.toFixed(1), "0.8");
  assert.equal(rainBetween({ ms: at("2025-06-20T05:54:00Z"), total: 3, prior: 0 }, { ms: at("2025-06-22T07:00:00Z"), total: 0, prior: 1 }), null);
});

const a = loadArchive();
const gauge = readGauge();
const rain = rainBySlot(a, gauge);

test("the counters give about 1,200 mm over the archive, some 16 times what the sampled minutes add up to", () => {
  const counters = rain.filter((v) => !Number.isNaN(v)).reduce((x, y) => x + y, 0);
  const sampled = a.series.reduce((x, o) => x + o.rg1, 0);
  assert.ok(counters > 1150 && counters < 1250, `${counters}`);
  assert.ok(counters / sampled > 12, `${counters} vs ${sampled}`);
});

const samples = rainSamples(a, rain);
const rows = samples.idx.map((_, r) => r);
const features = RAIN_CANDIDATES[rainModel.evaluation.chosen];
const held = rainModel.evaluation.months.map((month) => {
  const start = Date.parse(`${month}-01T00:00:00Z`);
  const train = rows.filter((r) => a.ms[samples.idx[r] + 12] < start);
  const test = rows.filter((r) => a.month[samples.idx[r]] === month);
  const m = fitLogistic(samples, train, features);
  return { p: test.map((r) => predictLogistic(m, samples.x[r])), y: test.map((r) => samples.y[r]) };
});

test("on months it never saw, the rain probability beats each month's own rain frequency", () => {
  let model = 0;
  let climatology = 0;
  let n = 0;
  for (const { p, y } of held) {
    const rate = y.reduce((s, v) => s + v, 0) / y.length;
    p.forEach((v, k) => {
      model += (v - y[k]) ** 2;
      climatology += (rate - y[k]) ** 2;
    });
    n += y.length;
  }
  const skill = 1 - model / climatology;
  assert.ok(skill > 0.1, `skill ${skill}`);
  assert.equal(Math.round((model / n) * 1e5) / 1e5, rainModel.evaluation.brier);
});

test("when it says 50 % or more, it rains in the next three hours most of the time", () => {
  const p = held.flatMap((m) => m.p);
  const y = held.flatMap((m) => m.y);
  const high = p.map((_, k) => k).filter((k) => p[k] >= 0.5);
  const low = p.map((_, k) => k).filter((k) => p[k] < 0.05);
  assert.ok(high.filter((k) => y[k] === 1).length / high.length > 0.6);
  assert.ok(low.filter((k) => y[k] === 1).length / low.length < 0.05);
});

test("the app computes the shipped model: high during a downpour, low on a dry afternoon", () => {
  assert.equal(rainModel.kind, "logistic");
  const grid = a.series.map((o, i) => ({ ...o, rg1: Number.isNaN(rain[i]) ? 0 : rain[i] }));
  const wettest = samples.idx.reduce((best, i) => (rain[i] > rain[best] ? i : best), samples.idx[0]);
  assert.ok(computeRainProbability(rainInputs(grid, wettest), grid[wettest].ts) > 0.5);
  const dry = a.series.findIndex((o) => o.ts === "2026-07-15T11:00:00.000Z"); // 14:00 in Juja
  assert.ok(computeRainProbability(rainInputs(grid, dry), grid[dry].ts) < 0.05);
});

test("without inputs it gives how often it has rained at that month and hour", () => {
  // 17:00 in Juja on 20 April
  assert.equal(computeRainProbability(null, "2026-04-20T14:00:00Z"), rainModel.month_hour[3][17]);
});
