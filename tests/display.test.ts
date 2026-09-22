import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandGeometry, bandScale, contributionBars, contributorLabel, currentBand, degreeTicks,
  exposureTrend, filledReadings, hourTicks, nextStateNote, rainWindows, stateAt, stateSpans,
  stationWbgtSeries, timeOfDayGapHours, SLOT_MS, type ClimateSeriesRow,
} from "../src/lib/afya/display";
import type { ChirpsContext, CurrentObservation, HorizonForecast, RiskAssessment, StateSegment } from "../src/lib/afya/types";

const current = (wbgt_c: number) => ({ wbgt_c }) as CurrentObservation;
const risk = (extra: Partial<RiskAssessment> = {}): RiskAssessment => ({
  thermal: "HIGH", rain_probability: 0.1, uncertainty: "MODERATE", data_quality: "GOOD", ...extra,
});
const horizons = (values: Record<string, number>): HorizonForecast[] =>
  Object.entries(values).map(([horizon, value]) => ({
    horizon: horizon as HorizonForecast["horizon"], value, lower: value - 1, upper: value + 1, model: "ridge", model_version: "x",
  }));

test("the band beside the current WBGT is the current band, not the +3 h one", () => {
  // 20.4 degC is ELEVATED; the +3 h forecast behind risk.thermal was HIGH.
  assert.equal(currentBand({ current: current(20.4), risk: risk() }), "ELEVATED");
  assert.equal(currentBand({ current: current(20.4), risk: risk({ thermal_now: "LOW" }) }), "LOW");
});

test("the trend follows the +3 h forecast, with changes under 0.3 degC read as stable", () => {
  assert.equal(exposureTrend(20.4, horizons({ "3h": 21.1, "6h": 18.5 })), "rising");
  assert.equal(exposureTrend(20.4, horizons({ "3h": 20.6 })), "stable");
  assert.equal(exposureTrend(20.4, horizons({ "3h": 19.9 })), "falling");
  assert.equal(exposureTrend(20.4, []), "stable");
});

test("contribution bars are scaled to the largest effect and keep their sign", () => {
  const bars = contributionBars([
    { feature: "temp_sht", direction: "high", contribution_c: 0.6 },
    { feature: "hour_cos", direction: "low", contribution_c: -0.3 },
    { feature: "wind_spd", direction: "low", contribution_c: 0.15 },
  ]);
  assert.deepEqual(bars?.map((b) => Math.round(b.width_pct)), [100, 50, 25]);
  assert.deepEqual(bars?.map((b) => b.value_c), [0.6, -0.3, 0.15]);
});

test("without an effect for every contributor there are no bars to draw", () => {
  assert.equal(contributionBars([{ feature: "temp_rising", direction: "increasing" }]), null);
  assert.equal(contributionBars([
    { feature: "temp_sht", direction: "high", contribution_c: 0.6 },
    { feature: "low_ventilation", direction: "low" },
  ]), null);
  assert.equal(contributionBars([]), null);
});

test("contributors are named in both languages, and unknown inputs by their key", () => {
  assert.equal(contributorLabel("temp_rising", "en"), "Air temperature rising");
  assert.equal(contributorLabel("temp_rising", "sw"), "Joto la hewa linaongezeka");
  assert.equal(contributorLabel("soil_temp_10cm", "en"), "soil temp 10cm");
});

test("each horizon's bar is drawn from its own band on a shared scale", () => {
  const bands = [
    { lower: 20.2, value: 20.9, upper: 21.6 },
    { lower: 19.9, value: 21.1, upper: 22.3 },
    { lower: 14.9, value: 16.4, upper: 17.9 },
  ];
  const scale = bandScale(bands);
  assert.deepEqual(scale, [14, 23]);
  const g = bandGeometry(bands[1], scale);
  assert.ok(Math.abs(g.left - (5.9 / 9) * 100) < 1e-9);
  assert.ok(Math.abs(g.width - (2.4 / 9) * 100) < 1e-9);
  assert.ok(Math.abs(g.marker - (7.1 / 9) * 100) < 1e-9);
  // A wider band draws a wider bar.
  assert.ok(bandGeometry(bands[2], scale).width > bandGeometry(bands[0], scale).width);
});

// The state history the live station gave on 22 September 2026.
const HISTORY: StateSegment[] = [
  { state_id: 3, start: "2026-09-21T11:30:00.000Z", end: "2026-09-21T19:30:00.000Z" },
  { state_id: 0, start: "2026-09-21T19:45:00.000Z", end: "2026-09-22T05:00:00.000Z" },
  { state_id: 1, start: "2026-09-22T05:15:00.000Z", end: "2026-09-22T07:45:00.000Z" },
  { state_id: 2, start: "2026-09-22T08:00:00.000Z", end: "2026-09-22T08:45:00.000Z" },
  { state_id: 1, start: "2026-09-22T09:00:00.000Z", end: "2026-09-22T09:00:00.000Z" },
];

test("state spans meet halfway between readings and stop at the window's edges", () => {
  const from = Date.parse("2026-09-21T21:00:00Z");
  const to = Date.parse("2026-09-22T09:00:00Z");
  const spans = stateSpans(HISTORY, from, to);
  // The evening segment ended before the window opened.
  assert.deepEqual(spans.map((s) => s.state_id), [0, 1, 2, 1]);
  assert.equal(spans[0].start, from);
  for (let i = 1; i < spans.length; i++) assert.equal(spans[i].start, spans[i - 1].end);
  // A single reading at the latest time still gets the half slot before it.
  assert.equal(spans.at(-1)!.end - spans.at(-1)!.start, SLOT_MS / 2);
  assert.equal(stateAt(spans, Date.parse("2026-09-22T08:20:00Z")), 2);
  assert.equal(stateAt(spans, Date.parse("2026-09-22T12:00:00Z")), null);
});

test("hour ticks fall on the Nairobi clock", () => {
  const ticks = hourTicks(Date.parse("2026-09-21T07:30:00Z"), Date.parse("2026-09-22T09:00:00Z"), 6);
  // 12:00, 18:00, 00:00, 06:00 and 12:00 EAT.
  assert.deepEqual(ticks.map((ms) => new Date(ms).toISOString().slice(11, 16)), ["09:00", "15:00", "21:00", "03:00", "09:00"]);
});

test("axis ticks are whole degrees that cover the data, at most seven of them", () => {
  assert.deepEqual(degreeTicks([19.9, 20.4, 22.3]), [19, 20, 21, 22, 23]);
  assert.deepEqual(degreeTicks([14.9, 25.3]), [14, 16, 18, 20, 22, 24, 26]);
  assert.deepEqual(degreeTicks([20, 20]), [20, 21]);
  assert.deepEqual(degreeTicks([]), []);
});

test("the gap in time of day ignores the date and wraps at midnight", () => {
  // Noon EAT against 02:00 EAT five days earlier.
  assert.equal(timeOfDayGapHours("2026-09-22T09:00:00Z", "2026-09-17T23:00:00Z"), 10);
  assert.equal(timeOfDayGapHours("2026-09-22T09:00:00Z", "2026-09-17T09:00:00Z"), 0);
  assert.equal(timeOfDayGapHours("2026-09-22T23:00:00Z", "2026-09-17T01:00:00Z"), 2);
});

const chirps = (extra: Partial<ChirpsContext> = {}): ChirpsContext => ({
  chirps_mm: 0.1, chirps_7d_mm: 14.9, chirps_30d_mm: 24.1, chirps_percentile: 47,
  chirps_dry_spell_days: 0, chirps_wet_spell_days: 10, valid_date: "2026-09-17", ...extra,
});

test("rainfall totals are dated by the days they cover, which end on the last ERA5 day", () => {
  const w = rainWindows(chirps());
  assert.equal(w.day, "2026-09-17");
  assert.deepEqual(w.week, { from: "2026-09-11", to: "2026-09-17" });
  assert.deepEqual(w.month, { from: "2026-08-19", to: "2026-09-17" });
});

test("explicit rainfall windows from the context win over the derived ones", () => {
  const w = rainWindows(chirps({ window_7d: { from: "2026-09-15", to: "2026-09-21" } }));
  assert.deepEqual(w.week, { from: "2026-09-15", to: "2026-09-21" });
  assert.deepEqual(w.month, { from: "2026-08-19", to: "2026-09-17" });
});

// Rows shaped like /api/climate-series, every 15 minutes from 18:00 UTC.
function climateRows(n: number, extra: (i: number) => Partial<ClimateSeriesRow> = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(Date.parse("2026-09-21T18:00:00Z") + i * SLOT_MS).toISOString(),
    temp_c: 20, wbgt_c: 17, firmware_wbgt: 11, ...extra(i),
  }));
}

test("measured WBGT covers the twelve hours up to the situation's latest reading", () => {
  const rows = climateRows(70); // to 11:15 UTC
  const series = stationWbgtSeries(
    { conduit_source: "live", conduit: rows },
    { data_source: "CONDUIT_LIVE", generated_at: "2026-09-22T09:00:00.000Z" },
  );
  assert.equal(series[0].time, "2026-09-21T21:00:00.000Z");
  assert.equal(series.at(-1)!.time, "2026-09-22T09:00:00.000Z");
  assert.equal(series.length, 49);
  assert.ok(series.every((p) => p.wbgt === 17));
});

test("measured WBGT is 0.7 wet bulb plus 0.3 air temperature, never the firmware value", () => {
  const rows = climateRows(4, () => ({ wet_bulb_c: 15, temp_c: 22 }));
  const series = stationWbgtSeries(
    { conduit_source: "csv", conduit: rows },
    { data_source: "CONDUIT_ARCHIVE", generated_at: "2026-09-21T18:45:00.000Z" },
  );
  assert.deepEqual(series.map((p) => p.wbgt), [17.1, 17.1, 17.1, 17.1]);
});

test("a filled-in or empty slot breaks the measured line instead of passing as measured", () => {
  const rows = climateRows(4, (i) => (i === 1 ? { imputed: ["temp_sht"] } : i === 2 ? { wbgt_c: null } : {}));
  const series = stationWbgtSeries(
    { conduit_source: "live", conduit: rows },
    { data_source: "CONDUIT_LIVE", generated_at: "2026-09-21T18:45:00.000Z" },
  );
  assert.deepEqual(series.map((p) => p.wbgt), [17, null, null, 17]);
});

test("no measured line is drawn from demo data or from another source", () => {
  const res = { conduit_source: "live", conduit: climateRows(8) };
  assert.deepEqual(stationWbgtSeries(res, { data_source: "DEMO", generated_at: "2026-09-21T19:00:00Z" }), []);
  assert.deepEqual(stationWbgtSeries(res, { data_source: "CONDUIT_ARCHIVE", generated_at: "2026-09-21T19:00:00Z" }), []);
});

test("filled-in readings are marked, and WBGT with them when an input was filled", () => {
  assert.deepEqual([...filledReadings(["temp_sht"], "jhub")].sort(), ["temperature", "wbgt"]);
  assert.deepEqual([...filledReadings(["wet_bulb_c"], null)].sort(), ["wbgt", "wet_bulb"]);
  assert.equal(filledReadings(undefined, "jhub").size, 0);
});

test("a rain gap on CHORDS is no rain, but on the Conduit API it is missing data", () => {
  assert.ok(filledReadings(["rg1"], "jhub").has("rain"));
  assert.ok(!filledReadings(["rg1"], "chords").has("rain"));
});

test("the next state is described as a share of past changes, with a wait when known", () => {
  assert.equal(
    nextStateNote({ state_id: 2, probability: 0.83 }, "en"),
    "83% of past changes from this state in the station record",
  );
  assert.equal(
    nextStateNote({ state_id: 2, probability: 0.61, typical_hours: 2.2 }, "en"),
    "61% of past changes from this state at this time of day in the station record. Typical wait: about 2 h",
  );
  assert.match(nextStateNote({ state_id: 0, probability: 0.89 }, "sw") ?? "", /^89% ya mabadiliko/);
  assert.equal(nextStateNote(null, "en"), null);
});
