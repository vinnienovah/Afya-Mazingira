import { test } from "node:test";
import assert from "node:assert/strict";
import {
  era5FromRows,
  getEra5ContextLive,
  getRainfallContext,
  midRankPercentile,
  rainfallContextFrom,
  regionalRainAhead,
  soilMoistureContext,
  type Era5Row,
  type RegionalDaily,
} from "../src/lib/afya/sources-external";
import { datesEnding } from "../src/lib/afya/nairobi-time";

// Hourly ERA5 rows (UTC) with the sun up from 06:00 to 18:00 EAT.
function era5Rows(fromIso: string, hours: number): Era5Row[] {
  const start = Date.parse(fromIso);
  return Array.from({ length: hours }, (_, i) => {
    const t = start + i * 3600_000;
    const eatHour = (new Date(t).getUTCHours() + 3) % 24;
    const sun = Math.max(0, Math.sin(((eatHour - 6) / 12) * Math.PI));
    return {
      time: new Date(t).toISOString(),
      temp_c: 14 + 11 * sun,
      rh: 85 - 40 * sun,
      wind_ms: 2,
      wind_dir: 110,
      solar_wm2: 900 * sun,
      precip_mm: 0,
      soil_m3: 0.17,
      pressure_hpa: 850,
    };
  });
}

test("ERA5 is read at the station's hour of day on its latest day, not at its last hour", () => {
  // ERA5 runs to 17 September 23:00 UTC; the station reads 24.9 °C at 12:10 EAT on the 22nd.
  const rows = era5Rows("2026-09-10T00:00:00Z", 8 * 24);
  const ctx = era5FromRows(rows, "2026-09-22T09:10:00Z", 24.9, 48);
  assert.equal(ctx.available, true);
  assert.equal(ctx.valid_time, "2026-09-17T09:00:00.000Z");
  assert.equal(ctx.era5_temp_c, 25);
  assert.equal(ctx.local_temp_anomaly_c, -0.1);
  assert.ok((ctx.era5_solar_wm2 ?? 0) > 800);
});

test("an ERA5 hour after the anchor or with a value missing is passed over", () => {
  const rows = era5Rows("2026-09-10T00:00:00Z", 8 * 24);
  assert.equal(era5FromRows(rows, "2026-09-15T09:05:00Z", 24, 50).valid_time, "2026-09-15T09:00:00.000Z");
  const gappy = rows.map((r) => (r.time === "2026-09-17T09:00:00.000Z" ? { ...r, solar_wm2: null } : r));
  assert.equal(era5FromRows(gappy, "2026-09-22T09:10:00Z", 24, 50).valid_time, "2026-09-16T09:00:00.000Z");
});

test("unavailable context carries nulls, not stand-in numbers", async () => {
  const none = era5FromRows([], "2026-09-22T09:10:00Z", 24, 50);
  assert.equal(none.available, false);
  assert.ok(Object.entries(none).every(([k, v]) => k === "available" || v === null));
  // A replay anchor never fetches and gets no context.
  const era5 = await getEra5ContextLive("2026-02-10T09:00:00Z", 24, 50, false);
  assert.equal(era5.available, false);
  assert.equal(era5.era5_soil_moisture, null);
  const rain = await getRainfallContext("2026-02-10T09:00:00Z", false);
  assert.equal(rain.available, false);
  assert.equal(rain.chirps_7d_mm, null);
  assert.equal(rain.chirps_30d_mm, null);
});

test("a dry day among many dry days ranks in the middle, not at the top", () => {
  const month = [...Array(20).fill(0), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // (0 below + 20 ties / 2) / 30; counting the ties as below gave 67.
  assert.equal(midRankPercentile(month, 0), 33);
  assert.equal(midRankPercentile(month, 10), 98);
  assert.equal(midRankPercentile([5], 5), 50);
});

// The forecast API's record at 12:30 EAT on 22 September: 5.9 mm on the 20th,
// 1.8 mm on the 21st, and 0.2 mm in every hour of the 22nd.
function regionalRecord(): RegionalDaily {
  const dates = datesEnding("2026-09-22", 32).concat(["2026-09-23", "2026-09-24"]);
  const rain: Record<string, number> = { "2026-09-20": 5.9, "2026-09-21": 1.8 };
  return {
    days: dates.map((date) => ({ date, precip_mm: rain[date] ?? 0, tmax_c: 25, tmin_c: 14, et0_mm: 4 })),
    hours: Array.from({ length: 72 }, (_, i) => ({
      time: new Date(Date.parse("2026-09-21T21:00:00Z") + (i + 1) * 3600_000).toISOString(),
      precip_mm: 0.2,
    })),
  };
}

test("the rainfall context runs to today, with its windows named", () => {
  const ctx = rainfallContextFrom(regionalRecord(), Date.parse("2026-09-22T09:30:00Z"));
  assert.equal(ctx.available, true);
  assert.equal(ctx.source, "open-meteo-forecast");
  assert.equal(ctx.valid_date, "2026-09-22");
  assert.equal(ctx.window_7d_start, "2026-09-16");
  assert.equal(ctx.window_30d_start, "2026-08-24");
  assert.equal(ctx.through, "2026-09-22T09:00:00.000Z");
  // Twelve hours of today so far, 0.2 mm each.
  assert.equal(ctx.chirps_mm, 2.4);
  assert.equal(ctx.chirps_7d_mm, 10.1);
  assert.equal(ctx.chirps_30d_mm, 10.1);
  // 28 of the 30 days had less; mid-rank puts today at (28 + 0.5) / 30.
  assert.equal(ctx.chirps_percentile, 95);
  assert.equal(ctx.chirps_wet_spell_days, 3);
  assert.equal(ctx.chirps_dry_spell_days, 0);

  const gap = regionalRecord();
  gap.days[10].precip_mm = null;
  assert.equal(rainfallContextFrom(gap, Date.parse("2026-09-22T09:30:00Z")).available, false);
});

test("the rain ahead is the next 48 hours of the forecast, or nothing", () => {
  const record = regionalRecord();
  assert.equal(regionalRainAhead(record, Date.parse("2026-09-22T09:30:00Z")), 9.6);
  // The record ends 72 hours after it starts: two days ahead from late on the 23rd are not all there.
  assert.equal(regionalRainAhead(record, Date.parse("2026-09-23T12:00:00Z")), null);
});

test("soil moisture is placed within its own last 365 days", () => {
  const dates = datesEnding("2026-09-16", 400);
  // Wetter every day, so the latest value tops its record.
  const values = dates.map((_, i) => 0.1 + i / 10_000);
  const ctx = soilMoistureContext(dates, values);
  assert.equal(ctx?.date, "2026-09-16");
  assert.equal(ctx?.percentile, 100);
  assert.equal(ctx?.layer, "7-28 cm");
  // The trailing days ERA5-Land has not published yet are skipped.
  const late = soilMoistureContext([...dates, "2026-09-17", "2026-09-18"], [...values, null, null]);
  assert.equal(late?.date, "2026-09-16");
  // Too short a record for a yearly rank.
  assert.equal(soilMoistureContext(dates.slice(-200), values.slice(-200)), null);
});

test("the regional context asks the archive for ERA5 itself, not its blend of finer models", async () => {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ hourly: { time: [] } }), { status: 200 });
  }) as typeof fetch;
  try {
    await getEra5ContextLive(new Date().toISOString(), 24, 50, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  const era5 = urls.map((u) => new URL(u)).filter((u) => u.pathname.endsWith("/v1/era5"));
  assert.ok(era5.length > 0, urls.join("\n"));
  for (const u of era5) assert.equal(u.searchParams.get("models"), "era5");
});
