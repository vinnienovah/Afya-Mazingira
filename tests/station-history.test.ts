import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStationHistory, dailyRainFrom, getStationDailyRain, getStationHistory, slotRain, type HistoryFeeds,
} from "../src/lib/afya/station-history";
import type { DemoObservation } from "../src/lib/afya/demo-observations";

// Nothing here may reach the network.
globalThis.fetch = () => Promise.reject(new Error("network disabled in tests"));

const ARCHIVE_END = Date.parse("2026-09-08T23:52:06Z");
const iso = (ms: number) => new Date(ms).toISOString();

function apiRow(ms: number, rg1tt: number) {
  return {
    ts: iso(ms).replace("T", " ").slice(0, 19), // the API's timestamps carry no offset
    temp_sht: 16, temp_bmx: 16, temp_mcp: 16, humidity_sht: 80, press_bmx: 851, wind_spd: 1, wind_dir: 90,
    wind_gust: 2, si1145_vis: 260, si1145_ir: 253, wet_bulb_temp: 14, heat_idx: 16, wet_bulb_globe_temp: 12,
    rg1: 0, rg2: 0, rg1tt, rg2tt: null, rg1tp: 0, rg2tp: 0,
  };
}

const chordsPoint = (ms: number, extra: Record<string, unknown> = {}) => ({ ts: iso(ms), temp_sht: 16, humidity_sht: 80, ...extra });

function feeds(overrides: Partial<HistoryFeeds>): HistoryFeeds & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hasConduit: () => false,
    conduit: async (from, to) => {
      calls.push(`conduit ${iso(from)} ${iso(to)}`);
      return [];
    },
    chords: async (from, to) => {
      calls.push(`chords ${iso(from)} ${iso(to)}`);
      return [];
    },
    ...overrides,
  };
}

test("a range the archive covers comes from the archive alone", async () => {
  const history = await getStationHistory(2, "2026-04-28T06:00:00Z");
  assert.ok(history);
  assert.equal(history.source, "csv");
  assert.equal(history.from, "2026-04-26T06:00:00.000Z");
  assert.equal(history.to, "2026-04-28T05:45:00.000Z");
  const rain = history.series.filter((o) => o.ts >= "2026-04-27T06:00").reduce((s, o) => s + o.rg1, 0);
  assert.ok(Math.abs(rain - 95.2) < 0.5);
  assert.equal(await getStationHistory(2, "2026-04-28T06:00:00Z"), history, "served from the cache");
});

test("after the archive, Conduit API rows carry on from the archive's running totals", async () => {
  const start = ARCHIVE_END - 3600_000;
  const t = (minutes: number) => Date.parse("2026-09-09T00:00:00Z") + minutes * 60_000;
  const f = feeds({
    hasConduit: () => true,
    conduit: async () => [apiRow(t(7), 0), apiRow(t(22), 0.4), apiRow(t(37), 1.0), apiRow(t(52), 1.0)],
  });
  const history = await buildStationHistory(start, t(55), f);
  assert.ok(history);
  assert.equal(history.source, "mixed");
  assert.equal(history.feed, "jhub");
  const after = history.series.filter((o) => o.ts >= "2026-09-09");
  assert.deepEqual(after.map(slotRain), [0, 0.4, 0.6, 0]);
  assert.deepEqual(f.calls, [], "the API reached the end, so CHORDS was not asked");
});

test("without a key CHORDS points fill the range, and a point without rain is a dry slot", async () => {
  const start = Date.parse("2026-09-15T00:00:00Z");
  const t = (minutes: number) => start + minutes * 60_000;
  const f = feeds({
    chords: async () => [chordsPoint(t(0), { rg1: 1.2 }), chordsPoint(t(15)), chordsPoint(t(45), { rg1: 0.2 })],
  });
  const history = await buildStationHistory(start, t(50), f);
  assert.ok(history);
  assert.equal(history.source, "live");
  assert.equal(history.feed, "chords");
  assert.deepEqual(history.series.map(slotRain), [1.2, 0, null, 0.2]);
});

test("where the Conduit API runs behind, CHORDS fills in after its last row", async () => {
  const start = Date.parse("2026-09-15T00:00:00Z");
  const t = (minutes: number) => start + minutes * 60_000;
  let chordsFrom = NaN;
  const f = feeds({
    hasConduit: () => true,
    conduit: async () => [apiRow(t(3), 0), apiRow(t(18), 0.2), apiRow(t(33), 0.2)],
    chords: async (from) => {
      chordsFrom = from;
      return [chordsPoint(Math.ceil(from / 900_000) * 900_000, { rg1: 0.4 }), chordsPoint(t(120))];
    },
  });
  const history = await buildStationHistory(start, t(125), f);
  assert.ok(history);
  assert.equal(history.feed, "chords");
  assert.equal(chordsFrom, t(45), "from the first whole quarter hour after the API's last reading");
  assert.equal(history.to, iso(t(120)));
  assert.equal(Math.round(history.series.reduce((s, o) => s + (slotRain(o) ?? 0), 0) * 10) / 10, 0.6);
});

test("nothing covering the range gives null, and a failing feed is not an error", async () => {
  const failing = feeds({
    hasConduit: () => true,
    conduit: () => Promise.reject(new Error("down")),
    chords: () => Promise.reject(new Error("down")),
  });
  assert.equal(await buildStationHistory(Date.parse("2026-09-15T00:00:00Z"), Date.parse("2026-09-15T06:00:00Z"), failing), null);
  assert.equal(await getStationHistory(0), null);
  assert.equal(await getStationHistory(1, "not a date"), null);
  assert.equal(await getStationHistory(3, "2024-01-01T00:00:00Z"), null);
});

function slots(fromIso: string, count: number, rain: (i: number) => number | null): DemoObservation[] {
  return Array.from({ length: count }, (_, i) => {
    const mm = rain(i);
    return {
      ts: iso(Date.parse(fromIso) + i * 900_000),
      rg1: mm ?? 0, rg2: 0, rg1tt: 0, rg2tt: 0, temp_bmx: 20, press_bmx: 850, temp_mcp: 20, temp_sht: 20,
      humidity_sht: 60, si1145_vis: 300, si1145_ir: 300, si1145_uv: 0, wind_spd: 1, wind_dir: 90, wind_gust: 2,
      heat_idx: 20, wet_bulb_temp: 15, wet_bulb_globe_temp: 16,
      imputed: mm === null ? ["rg1", "rg2"] : [],
    };
  });
}

test("daily rain is summed over Nairobi days, and a day read in fewer than 20 hours is null", () => {
  // Two days from 21:00 UTC, midnight in Nairobi: 0.2 mm in every slot of the first; the second read only 12 hours.
  const series = slots("2026-03-09T21:00:00Z", 192, (i) => (i < 96 ? 0.2 : i < 144 ? 0.5 : null));
  const days = dailyRainFrom(series, "2026-03-10", Date.parse("2026-03-11T20:59:00Z"));
  assert.deepEqual(days, [
    { date: "2026-03-10", mm: 19.2 },
    { date: "2026-03-11", mm: null },
  ]);
});

test("today counts once it has readings in 80 % of the hours so far", () => {
  const series = slots("2026-03-09T21:00:00Z", 30, (i) => (i === 29 ? 1.0 : 0));
  const now = Date.parse("2026-03-10T04:30:00Z"); // 07:30 in Nairobi
  assert.deepEqual(dailyRainFrom(series, "2026-03-10", now), [{ date: "2026-03-10", mm: 1 }]);
  const sparse = series.map((o, i) => (i >= 8 && i < 24 ? { ...o, imputed: ["rg1", "rg2"] } : o));
  assert.deepEqual(dailyRainFrom(sparse, "2026-03-10", now), [{ date: "2026-03-10", mm: null }]);
});

test("the station's daily rain from the archive, ending with the day asked about so far", async () => {
  const days = await getStationDailyRain(3, "2026-04-28T09:00:00Z");
  assert.ok(days);
  assert.deepEqual(days.map((d) => d.date), ["2026-04-25", "2026-04-26", "2026-04-27", "2026-04-28"]);
  assert.ok(days.every((d) => d.mm !== null));
  // The storm began at 21:30 in Nairobi on the 27th and ran past midnight.
  assert.ok(days[2].mm! > 60 && days[3].mm! > 20, JSON.stringify(days));
  const history = await getStationHistory((Date.parse("2026-04-28T09:00:00Z") - Date.parse("2026-04-24T21:00:00Z")) / 86400_000, "2026-04-28T09:00:00Z");
  const total = history!.series.reduce((s, o) => s + (slotRain(o) ?? 0), 0);
  assert.ok(Math.abs(days.reduce((s, d) => s + d.mm!, 0) - total) < 0.2);
});
