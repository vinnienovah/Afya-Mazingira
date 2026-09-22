import { test } from "node:test";
import assert from "node:assert/strict";
import { getCsvCoverage, getCsvRange, getCsvRows } from "../src/lib/afya/csv-source";
import { parseUtc } from "../src/lib/afya/sources";
import { audits } from "../src/lib/afya/sentinel";

// The committed archive: one sampled minute about every 15 minutes, with each
// rain gauge's running daily total (rg1tt) and its total for the day before (rg1tp).
const coverage = getCsvCoverage()!;
const series = getCsvRange(coverage.minIso, coverage.maxIso);
const rows = getCsvRows(Date.parse(coverage.minIso), Date.parse(coverage.maxIso));
const rowAt = (iso: string) => rows.find((r) => parseUtc(r.ts) === Date.parse(iso))!;

const RAIN_DAY_START_MS = 6 * 3600_000;
const rainDay = (t: number) => Math.floor((t - RAIN_DAY_START_MS) / 86400_000);

test("gauge 1's rain over the archive is within 2 % of the station's own daily totals", () => {
  // The station's total for each rain day is the prior-day total it reports
  // through the next one.
  const priors = new Map<number, number[]>();
  for (const r of rows) {
    const d = rainDay(parseUtc(r.ts)) - 1;
    if (!priors.has(d)) priors.set(d, []);
    priors.get(d)!.push(Number(r.rg1tp));
  }
  const station = [...priors.values()].reduce((sum, values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sum + sorted[Math.floor(sorted.length / 2)];
  }, 0);
  const app = series.reduce((s, o) => s + (o.imputed?.includes("rg1") ? 0 : o.rg1), 0);
  assert.ok(station > 1150 && station < 1250, `station total ${station}`);
  assert.ok(Math.abs(app - station) / station < 0.02, `app ${app.toFixed(1)} mm against ${station.toFixed(1)} mm`);
  // The sampled minutes alone hold only a small part of it.
  const sampled = rows.reduce((s, r) => s + Number(r.rg1), 0);
  assert.ok(sampled < 0.1 * station);
});

test("27 April 2026's rain day holds the 95 mm gauge 1 recorded", () => {
  const from = Date.parse("2026-04-27T06:00:00Z");
  const to = Date.parse("2026-04-28T06:00:00Z");
  const mm = series
    .filter((o) => Date.parse(o.ts) >= from && Date.parse(o.ts) < to)
    .reduce((s, o) => s + o.rg1, 0);
  assert.ok(Math.abs(mm - 95.2) < 0.5, `${mm.toFixed(1)} mm`);
});

test("from 1 July 2025 the UV index is read out of gauge 2's column, which has no running total", () => {
  // The first record in the new layout: UV 0.1 at dawn in rg2tt, 0 in si1145_uv.
  const first = rowAt("2025-07-01T04:17:38Z");
  assert.equal(Number(first.si1145_uv), 0.1);
  assert.equal(first.rg2tt, null);
  // Before it, and in the old-layout records of 3 to 5 July, nothing moves.
  assert.equal(Number(rowAt("2025-06-30T12:09:21Z").si1145_uv), 0.7);
  const oldLayout = rowAt("2025-07-04T19:02:11Z");
  assert.equal(Number(oldLayout.rg2tt), 0.2);
  // 6 July interleaves both layouts two minutes apart.
  assert.equal(Number(rowAt("2025-07-06T07:17:16Z").si1145_uv), 1.2);
  assert.equal(Number(rowAt("2025-07-06T07:19:35Z").si1145_uv), 3.2);
  assert.equal(rowAt("2025-07-06T07:19:35Z").rg2tt, null);
  assert.equal(Number(rowAt("2025-07-06T07:17:16Z").rg2tt), 0);

  // The UV index is zero in the dark, in every record of the archive.
  const dark = rows.filter((r) => Number(r.si1145_vis) <= 262);
  assert.ok(dark.length > 10_000);
  assert.ok(dark.every((r) => Number(r.si1145_uv) === 0));
  // Every later record lacks gauge 2's running total rather than reading 0.
  const later = rows.filter((r) => parseUtc(r.ts) >= Date.parse("2025-07-07T00:00:00Z"));
  assert.ok(later.every((r) => r.rg2tt === null));
});

test("A02: the firmware heat index over the archive, against the NWS formula", () => {
  const a02 = audits(series).A02_heat_index_vs_nws;
  assert.equal(a02.slots, 44214);
  assert.equal(a02.mae_c, 0.101);
  assert.equal(a02.max_c, 1.058);
  // The archive is cool: one slot in twelve reaches the heat the NWS formula
  // is written for, and there the firmware agrees three times as closely.
  assert.equal(a02.hot_from_c, 27);
  assert.equal(a02.hot_slots, 3684);
  assert.equal(a02.mae_hot_c, 0.034);
  assert.ok(!("verdict" in a02), "A02 is reported, not judged");
});

test("gauge 2's rain before July 2025 comes from its running total", () => {
  // The rain day from 06:00 UTC on 25 June 2025: gauge 2 recorded 0.4 mm and gauge 1 nothing.
  const from = Date.parse("2025-06-25T06:00:00Z");
  const to = Date.parse("2025-06-26T06:00:00Z");
  const day = series.filter((o) => Date.parse(o.ts) >= from && Date.parse(o.ts) < to);
  assert.equal(Math.round(day.reduce((s, o) => s + o.rg2, 0) * 10) / 10, 0.4);
  assert.equal(day.reduce((s, o) => s + o.rg1, 0), 0);
});
