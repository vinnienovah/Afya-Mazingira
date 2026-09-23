import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateStation, clipToAvailable, fetchEra5History, type HistoryPoint } from "../src/lib/afya/climate-history";
import { addDays, nairobiDate, nairobiDayStart } from "../src/lib/afya/nairobi-day";
import type { DemoObservation } from "../src/lib/afya/demo-observations";
import { STRINGS } from "../src/lib/afya/i18n";

function slot(iso: string, patch: Partial<DemoObservation> = {}): DemoObservation {
  return {
    ts: iso, rg1: 0, rg2: 0, rg1tt: 0, rg2tt: 0, temp_bmx: 20, press_bmx: 850, temp_mcp: 20, temp_sht: 20,
    humidity_sht: 60, si1145_vis: 300, si1145_ir: 300, si1145_uv: 0, wind_spd: 1, wind_dir: 90, wind_gust: 2,
    heat_idx: 20, wet_bulb_temp: 15, wet_bulb_globe_temp: 16.5, imputed: [], ...patch,
  };
}
const slotsFrom = (iso: string, count: number, patch: (i: number) => Partial<DemoObservation> = () => ({})) =>
  Array.from({ length: count }, (_, i) => slot(new Date(Date.parse(iso) + i * 900_000).toISOString(), patch(i)));

test("Nairobi dates turn over at 21:00 UTC", () => {
  assert.equal(nairobiDate("2026-09-21T20:59:59Z"), "2026-09-21");
  assert.equal(nairobiDate("2026-09-21T21:00:00Z"), "2026-09-22");
  assert.equal(nairobiDayStart("2026-09-22"), Date.parse("2026-09-21T21:00:00Z"));
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2025-12-31", 1), "2026-01-01");
});

test("daily station points are Nairobi days, with gauge 1's rain and only measured values", () => {
  // From 18:00 UTC on the 9th to 23:45 UTC on the 10th: the evening belongs to the 9th, from 21:00 to the 10th.
  const series = slotsFrom("2026-03-09T18:00:00Z", 24 + 96 - 12, (i) => ({
    rg1: i === 13 ? 1.4 : 0,
    temp_sht: i < 12 ? 24 : 18,
    imputed: i === 14 ? ["temp_sht", "rg1", "rg2"] : [],
  }));
  const end = Date.parse("2026-03-10T21:00:00Z");
  const points = aggregateStation(series, "daily", end);
  assert.deepEqual(points.map((p) => p.time), ["2026-03-09", "2026-03-10"]);
  assert.equal(points[0].temp_c, 24);
  assert.equal(points[0].rain_mm, null, "three hours of readings is too few for a day's rain");
  assert.equal(points[1].temp_c, 18);
  assert.equal(points[1].rain_mm, 1.4);
});

test("hourly station points keep an hour's measured values and its rain", () => {
  const series = slotsFrom("2026-03-10T06:00:00Z", 8, (i) => ({
    rg1: 0.2,
    temp_sht: 20 + i,
    imputed: i === 1 ? ["temp_sht"] : i >= 4 ? ["rg1", "rg2"] : [],
  }));
  const points = aggregateStation(series, "hourly", Date.parse("2026-03-10T08:00:00Z"));
  assert.deepEqual(points.map((p) => p.time), ["2026-03-10T06:00:00Z", "2026-03-10T07:00:00Z"]);
  assert.equal(points[0].temp_c, 21.7);
  assert.equal(points[0].rain_mm, 0.8);
  assert.equal(points[1].rain_mm, null);
});

const point = (time: string, temp: number | null): HistoryPoint => ({ time, temp_c: temp, humidity_pct: temp, wind_ms: temp, rain_mm: temp });

test("ERA5 stops at its last published value and never runs past now", () => {
  const now = Date.parse("2026-09-22T12:40:00Z");
  const daily = [point("2026-09-15", 18), point("2026-09-16", 18.2), point("2026-09-17", null), point("2026-09-22", null), point("2026-09-23", 20)];
  assert.deepEqual(clipToAvailable(daily, "daily", now).map((p) => p.time), ["2026-09-15", "2026-09-16"]);
  const hourly = [point("2026-09-22T11:00Z", 20), point("2026-09-22T12:00Z", 21), point("2026-09-22T13:00Z", 22)];
  assert.deepEqual(clipToAvailable(hourly, "hourly", now).map((p) => p.time), ["2026-09-22T11:00Z", "2026-09-22T12:00Z"]);
});

test("the ERA5 request asks for ERA5 alone, by Nairobi day, and clips what is not published", async () => {
  let url = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    url = String(input);
    return new Response(JSON.stringify({
      daily: {
        time: ["2026-09-15", "2026-09-16", "2026-09-17"],
        temperature_2m_mean: [17.9, 18.2, null],
        relative_humidity_2m_mean: [70, 72, null],
        precipitation_sum: [0.7, 2.0, null],
        wind_speed_10m_mean: [7.2, 9, null],
      },
    }));
  }) as typeof fetch;
  const points = await fetchEra5History(-1.09, 37.01, "2026-09-15", "2026-09-17", "daily", Date.parse("2026-09-22T12:00:00Z"));
  const params = new URL(url).searchParams;
  assert.equal(params.get("models"), "era5");
  assert.equal(params.get("timezone"), "Africa/Nairobi");
  assert.deepEqual(points, [
    { time: "2026-09-15", temp_c: 17.9, humidity_pct: 70, rain_mm: 0.7, wind_ms: 2 },
    { time: "2026-09-16", temp_c: 18.2, humidity_pct: 72, rain_mm: 2.0, wind_ms: 2.5 },
  ]);
});

test("the source chip on every live chart is named in both languages", () => {
  // The Dashboard's charts label their source from these; each one stayed
  // English on the Kiswahili page while it was written into the component.
  for (const key of ["conduit_live_badge", "conduit_archive_badge", "demo_mode", "cv_station_rain_source"]) {
    assert.ok(STRINGS.en[key], `${key} is missing`);
    assert.ok(STRINGS.sw[key], `${key} has no Kiswahili`);
  }
  assert.notEqual(STRINGS.sw.conduit_live_badge, STRINGS.en.conduit_live_badge);
  assert.notEqual(STRINGS.sw.conduit_archive_badge, STRINGS.en.conduit_archive_badge);
  assert.notEqual(STRINGS.sw.cv_station_rain_source, STRINGS.en.cv_station_rain_source);
});
