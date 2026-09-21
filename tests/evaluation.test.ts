import { test } from "node:test";
import assert from "node:assert/strict";
import evaluation from "../src/lib/afya/model/forecast-evaluation.json";
import { HORIZON_STEPS, type Horizon } from "../src/lib/afya/forecast-engine";

const HORIZONS = Object.keys(HORIZON_STEPS) as Horizon[];
const ENTRIES = [...evaluation.by_month, ...Object.values(evaluation.seasons)];

test("the evaluation scores the same horizons the app forecasts", () => {
  assert.deepEqual(evaluation.horizon_steps, HORIZON_STEPS);
});

test("each month is listed once, in order, with its own scores", () => {
  const months = evaluation.months;
  months.forEach((m, i) => {
    assert.match(m, /^\d{4}-\d{2}$/);
    if (i > 0) assert.ok(m > months[i - 1], `${months[i - 1]} before ${m}`);
  });
  assert.deepEqual(evaluation.by_month.map((m) => m.month), months);
});

test("the hot season is scored on its own, on forecasts it actually has", () => {
  const hot = evaluation.seasons.hot;
  assert.deepEqual(hot.months, ["2026-01", "2026-02", "2026-03"]);
  for (const h of HORIZONS) assert.ok(hot.horizons[h].n > 0, h);
});

test("every error is above zero and has a no-change baseline beside it", () => {
  for (const e of ENTRIES) {
    for (const h of HORIZONS) {
      const s = e.horizons[h];
      assert.ok(Number.isFinite(s.mae) && s.mae > 0, `${h}: mae ${s.mae}`);
      assert.ok(Number.isFinite(s.persistence_mae) && s.persistence_mae > 0, `${h}: persistence ${s.persistence_mae}`);
    }
  }
});

test("the two seasons split the months and pool exactly their forecasts", () => {
  const { hot, other } = evaluation.seasons;
  assert.deepEqual([...hot.months, ...other.months].sort(), evaluation.months);
  for (const season of [hot, other]) {
    for (const h of HORIZONS) {
      const n = evaluation.by_month
        .filter((m) => season.months.includes(m.month))
        .reduce((sum, m) => sum + m.horizons[h].n, 0);
      assert.equal(season.horizons[h].n, n, h);
    }
  }
});

test("risk band shares are percentages", () => {
  for (const e of ENTRIES) {
    assert.ok(e.band_same_pct >= 0 && e.band_lower_pct >= 0);
    assert.ok(e.band_same_pct + e.band_lower_pct <= 100.1);
  }
});
