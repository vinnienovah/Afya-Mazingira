import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanAndGrid, cleanAndGridWithStats, counterRain, parseUtc } from "../src/lib/afya/sources";

const T0 = Date.UTC(2026, 8, 1, 9, 0);
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

function row(minutes: number, extra: Record<string, unknown> = {}) {
  return {
    ts: at(minutes),
    temp_sht: 20, temp_bmx: 20, temp_mcp: 20, heat_idx: 20, humidity_sht: 60, press_bmx: 851, wind_spd: 1, wind_dir: 90, wind_gust: 2,
    si1145_vis: 300, si1145_ir: 800, wet_bulb_temp: 15, wet_bulb_globe_temp: 12,
    rg1: 0, rg2: 0, rg1tt: 0, rg2tt: 0, rg1tp: 0, rg2tp: 0,
    ...extra,
  };
}

const reading = (iso: string, total: number | null, prior: number | null = null) => ({ t: Date.parse(iso), total, prior });

test("repeated timestamps are removed and counted", () => {
  const { series, duplicates } = cleanAndGridWithStats([row(0), row(0), row(15), row(30)]);
  assert.equal(duplicates, 1);
  assert.equal(series.length, 3);
});

test("WBGT is shade WBGT from the wet bulb and air temperature; the firmware value is kept apart", () => {
  const { series } = cleanAndGridWithStats([row(0), row(15)]);
  assert.equal(series[0].wet_bulb_globe_temp, 0.7 * 15 + 0.3 * 20);
  assert.equal(series[0].firmware_wbgt, 12);
});

test("the station's missing-value code is treated as missing", () => {
  const { series } = cleanAndGridWithStats([row(0), row(15, { temp_sht: -999.9 }), row(30)]);
  assert.ok(series[1].imputed?.includes("temp_sht"));
  assert.equal(series[1].temp_sht, 20);
});

test("a short gap is interpolated and marked", () => {
  const { series } = cleanAndGridWithStats([row(0, { temp_sht: 20 }), row(45, { temp_sht: 23 })]);
  assert.equal(series.length, 4);
  assert.equal(series[1].temp_sht, 21);
  assert.ok(series[1].imputed?.includes("temp_sht"));
  assert.deepEqual(series[3].imputed, []);
});

test("a long gap is carried forward, marked, and never passes as measured", () => {
  const { series } = cleanAndGridWithStats([row(0, { temp_sht: 20 }), row(120, { temp_sht: 25 })]);
  const inGap = series.slice(1, -1);
  assert.ok(inGap.length > 2);
  for (const o of inGap) {
    assert.equal(o.temp_sht, 20);
    assert.ok(o.imputed?.includes("temp_sht"));
  }
});

test("missing rain is marked rather than counted as no rain", () => {
  const { series } = cleanAndGridWithStats([row(0), row(15, { rg1tt: null, rg2tt: "" }), row(30)]);
  assert.equal(series[1].rg1, 0);
  assert.ok(series[1].imputed?.includes("rg1"));
  assert.ok(series[1].imputed?.includes("rg2"));
  assert.ok(!series[2].imputed?.includes("rg1"));
});

test("rain is the rise in the running total, given to the later reading's slot", () => {
  const totals = [0, 0, 0.4, 1.0, 1.0];
  const series = cleanAndGrid(totals.map((tt, i) => row(i * 15 + 3, { rg1tt: tt, rg1: 0 })));
  assert.ok(series[0].imputed?.includes("rg1"), "nothing before the first reading to compare with");
  assert.deepEqual(series.slice(1).map((o) => o.rg1), [0, 0.4, 0.6, 0]);
});

test("the one sampled minute is not taken as the slot's rain", () => {
  const series = cleanAndGrid([row(0, { rg1tt: 2.0 }), row(15, { rg1tt: 5.0, rg1: 0.2 })]);
  assert.equal(series[1].rg1, 3.0);
});

test("across the 06:00 UTC restart the rain after the last reading is added from the prior-day total", () => {
  const mm = counterRain([
    reading("2026-04-28T05:40:00Z", 95.0),
    reading("2026-04-28T05:55:00Z", 95.2),
    reading("2026-04-28T06:10:00Z", 0.4, 95.4),
  ]);
  assert.deepEqual(mm, [null, 0.2, 0.6]);
});

test("a restart applied late, or missed for a day, counts no rain twice", () => {
  const late = counterRain([
    reading("2026-04-28T05:55:00Z", 5.2, 1.0),
    reading("2026-04-28T06:04:00Z", 5.2, 1.0),
    reading("2026-04-28T06:19:00Z", 0.2, 5.4),
  ]);
  assert.deepEqual(late, [null, 0, 0.4]);
  // 22 December 2025: the total ran on past 06:00 without restarting.
  const missed = counterRain([
    reading("2025-12-22T05:48:38Z", 11.6, 0.8),
    reading("2025-12-22T06:03:43Z", 11.6, 0.8),
    reading("2025-12-22T06:18:49Z", 12.6, 0.8),
  ]);
  assert.deepEqual(missed, [null, 0, 1]);
});

test("a total that dips and recovers adds nothing, and rain is never negative", () => {
  assert.deepEqual(
    counterRain([reading("2026-01-05T09:00:00Z", 5.0), reading("2026-01-05T09:15:00Z", 0), reading("2026-01-05T09:30:00Z", 5.2)]),
    [null, 0, 0.2],
  );
  let total = 0;
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const readings = Array.from({ length: 2000 }, (_, i) => {
    total = random() < 0.1 ? 0 : total + (random() < 0.3 ? 0.2 : 0);
    return { t: Date.UTC(2026, 0, 1) + i * 906_000, total: random() < 0.05 ? null : total, prior: random() * 10 };
  });
  for (const mm of counterRain(readings)) assert.ok(mm === null || mm >= 0);
});

test("a gap keeps the rain that fell in it, on the reading after it", () => {
  const series = cleanAndGrid([row(0, { rg1tt: 1.0 }), row(15, { rg1tt: 1.0 }), row(195, { rg1tt: 4.0 })]);
  const inGap = series.slice(2, -1);
  assert.ok(inGap.every((o) => o.imputed?.includes("rg1")));
  assert.equal(series.at(-1)!.rg1, 3.0);
  // A whole rain day unread: only the rain since the latest restart is known.
  assert.deepEqual(
    counterRain([reading("2026-03-01T05:00:00Z", 3.0), reading("2026-03-03T07:00:00Z", 0.6, 9.0)]),
    [null, 0.6],
  );
});

test("a CHORDS point without rain is a dry slot, and a missing point is missing", () => {
  const chords = [
    { ts: at(0), temp_sht: 20, rg1: 1.5 },
    { ts: at(15), temp_sht: 20 },
    { ts: at(45), temp_sht: 21, rg2: 0.2 },
  ];
  const series = cleanAndGrid(chords, "sums");
  assert.deepEqual(series.map((o) => o.rg1), [1.5, 0, 0, 0]);
  assert.ok(!series[1].imputed?.includes("rg1"));
  assert.ok(series[2].imputed?.includes("rg1"));
  assert.equal(series[3].rg2, 0.2);
});

test("a slot's gust is its highest reading and its wind direction the mean on the circle", () => {
  const series = cleanAndGrid([
    row(1, { wind_gust: 3.0, wind_dir: 350 }),
    row(9, { wind_gust: 5.5, wind_dir: 10 }),
    row(16, { wind_gust: 2.0, wind_dir: 90 }),
  ]);
  assert.equal(series[0].wind_gust, 5.5);
  assert.equal(series[0].wind_dir, 0);
});

test("wind direction is filled across a short gap the short way round", () => {
  const series = cleanAndGrid([row(0, { wind_dir: 350 }), row(45, { wind_dir: 20 })]);
  assert.deepEqual(series.map((o) => Math.round(o.wind_dir)), [350, 0, 10, 20]);
});

test("a timestamp without an offset is read as UTC", () => {
  assert.equal(parseUtc("2026-09-08 23:52:06"), Date.UTC(2026, 8, 8, 23, 52, 6));
  assert.equal(parseUtc("2026-09-08T23:52:06"), Date.UTC(2026, 8, 8, 23, 52, 6));
  assert.equal(parseUtc("2026-09-08 23:52:06+00:00"), Date.UTC(2026, 8, 8, 23, 52, 6));
  assert.equal(parseUtc("2026-09-09T02:52:06+03:00"), Date.UTC(2026, 8, 8, 23, 52, 6));
  const series = cleanAndGrid([row(0, { ts: "2026-09-08 23:40:00" }), row(0, { ts: "2026-09-08 23:55:00" })]);
  assert.equal(series[0].ts, "2026-09-08T23:30:00.000Z");
});

test("readings about 906 s apart leave empty quarter hours but no missing time", () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ ...row(0), ts: new Date(T0 + i * 906_000).toISOString() }));
  const series = cleanAndGrid(rows);
  assert.ok(series.some((o) => o.imputed?.includes("temp_sht")), "the drift leaves some slots empty");
  assert.ok(series.every((o) => !o.gap_minutes));
});

test("readings more than 20 minutes apart leave missing time from 15 minutes after the first", () => {
  const series = cleanAndGrid([row(0), row(15), row(75), row(90)]);
  const missing = series.reduce((s, o) => s + (o.gap_minutes ?? 0), 0);
  assert.equal(missing, 45);
  assert.equal(series.find((o) => o.gap_minutes)!.ts, at(30));
});

test("an impossible reading is dropped, filled like a gap and listed, with what the firmware derived from it", () => {
  const series = cleanAndGrid([row(0, { temp_sht: 20 }), row(15, { temp_sht: 85, wet_bulb_temp: 40 }), row(30, { temp_sht: 22 })]);
  assert.equal(series[1].temp_sht, 21);
  assert.deepEqual(series[1].rejected, ["temp_sht"]);
  assert.ok(series[1].imputed?.includes("temp_sht"));
  assert.ok(series[1].imputed?.includes("wet_bulb_temp"));
  assert.equal(series[0].rejected, undefined);
});
