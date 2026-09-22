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
  rainSamples,
  slotRain,
} from "../scripts/rain";

const at = (iso: string) => Date.parse(iso);

const a = loadArchive();
const rain = slotRain(a);

test("the model learns from gauge 1's counter rain, about 1,200 mm over the archive", () => {
  const total = rain.filter((v) => !Number.isNaN(v)).reduce((x, y) => x + y, 0);
  assert.ok(total > 1150 && total < 1250, `${total}`);
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
