// External context adapters: ERA5 reanalysis and Open-Meteo's forecast model
// for the regional picture around the station, Copernicus Sentinel for the
// satellite one. Every getter serves a fresh cached value or awaits a real
// refresh. When a source cannot be read the context says so (available: false,
// every value null); nothing is filled in with made-up numbers.
//
// Refreshes are awaited rather than fired in the background: on Vercel a
// function can be frozen the moment its response is sent, so a background
// refresh may never finish.

import type { Era5Context, SentinelContext, ChirpsContext } from "./types";
import { generateSentinelContext } from "./demo-observations";
import { getSatelliteAcquisitions, type SatelliteAcquisition } from "./map-data";
import { hasCopernicusCreds, cdseToken, ndviStatisticsForBbox } from "./copernicus";
import { JKUAT_COORDS } from "./constants";
import { spellLength } from "./farm-engine";
import { datesEnding, nairobiDate, nairobiDayStartMs } from "./nairobi-time";

const JKUAT_NDVI_BBOX: [number, number, number, number] = [37.0, -1.11, 37.03, -1.08];

/** Mid-rank percentile of `x` among `values` (x among them): tied values count
 * half, so a dry day among many dry days lands in the middle of them rather
 * than at the top. */
export function midRankPercentile(values: number[], x: number): number {
  if (!values.length) return 0;
  const below = values.filter((v) => v < x).length;
  const equal = values.filter((v) => v === x).length;
  return Math.round(((below + equal / 2) / values.length) * 100);
}

// ERA5 regional context
// ERA5 (~28 km) through Open-Meteo's archive API, which runs about five days
// behind. The station is compared with ERA5 at the same hour of day on the
// latest day ERA5 has, and valid_time says which hour that was.

const ERA5_TTL = 3 * 3600_000;
let era5Cache: { at: number; rows: Era5Row[] } | null = null;
let era5Inflight: Promise<void> | null = null;

export interface Era5Row {
  time: string;
  temp_c: number;
  rh: number;
  wind_ms: number | null;
  wind_dir: number | null;
  solar_wm2: number | null;
  precip_mm: number | null;
  soil_m3: number | null;
  pressure_hpa: number | null;
}

const ERA5_UNAVAILABLE: Era5Context = {
  available: false,
  era5_temp_c: null,
  era5_dewpoint_c: null,
  era5_relative_humidity: null,
  era5_pressure_hpa: null,
  era5_wind_speed_ms: null,
  era5_wind_dir_deg: null,
  era5_solar_wm2: null,
  era5_precip_hourly_mm: null,
  era5_soil_moisture: null,
  local_temp_anomaly_c: null,
  local_humidity_anomaly: null,
  valid_time: null,
};

/**
 * `nearNow` gates the fetch: for a historical replay anchor there is no
 * recent ERA5 to compare with, so no request is made.
 */
export async function getEra5ContextLive(
  anchorIso: string,
  localTempC: number,
  localHum: number,
  nearNow: boolean = true,
): Promise<Era5Context> {
  if (nearNow && (!era5Cache || Date.now() - era5Cache.at > ERA5_TTL)) {
    await refreshEra5(); // swallows its own errors; leaves era5Cache unset/stale on failure
  }
  if (era5Cache) return era5FromRows(era5Cache.rows, anchorIso, localTempC, localHum);
  return ERA5_UNAVAILABLE;
}

async function refreshEra5(): Promise<void> {
  if (era5Inflight) {
    await era5Inflight.catch(() => {});
    return;
  }
  era5Inflight = (async () => {
    // ERA5 publishes about five days late; 30 days back also feeds the
    // regional series on the climate dashboard.
    const end = new Date(Date.now() - 5 * 86400_000);
    const start = new Date(end.getTime() - 30 * 86400_000);
    const params = new URLSearchParams({
      latitude: String(JKUAT_COORDS.lat),
      longitude: String(JKUAT_COORDS.lng),
      hourly: [
        "temperature_2m",
        "relative_humidity_2m",
        "wind_speed_10m",
        "wind_direction_10m",
        "surface_pressure",
        "shortwave_radiation",
        "precipitation",
        "soil_moisture_0_to_7cm",
      ].join(","),
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      // Without it the endpoint blends finer models into the latest days.
      models: "era5",
      timezone: "UTC",
    });
    const res = await fetch(`https://archive-api.open-meteo.com/v1/era5?${params}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(`ERA5 HTTP ${res.status}`);
    const json = (await res.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: (number | null)[];
        relative_humidity_2m?: (number | null)[];
        wind_speed_10m?: (number | null)[];
        wind_direction_10m?: (number | null)[];
        surface_pressure?: (number | null)[];
        shortwave_radiation?: (number | null)[];
        precipitation?: (number | null)[];
        soil_moisture_0_to_7cm?: (number | null)[];
      };
    };
    const h = json.hourly;
    if (!h?.time?.length) throw new Error("ERA5 returned no hourly data");

    const rows: Era5Row[] = [];
    for (let i = 0; i < h.time.length; i++) {
      const t = h.temperature_2m?.[i];
      const rh = h.relative_humidity_2m?.[i];
      if (t == null || rh == null) continue;
      const windKmh = h.wind_speed_10m?.[i];
      rows.push({
        time: new Date(h.time[i].endsWith("Z") ? h.time[i] : `${h.time[i]}Z`).toISOString(),
        temp_c: t,
        rh,
        wind_ms: windKmh == null ? null : windKmh / 3.6, // km/h → m/s
        wind_dir: h.wind_direction_10m?.[i] ?? null,
        solar_wm2: h.shortwave_radiation?.[i] ?? null,
        precip_mm: h.precipitation?.[i] ?? null,
        soil_m3: h.soil_moisture_0_to_7cm?.[i] ?? null,
        pressure_hpa: h.surface_pressure?.[i] ?? null,
      });
    }
    if (rows.length < 12) throw new Error("ERA5 rows too sparse");
    era5Cache = { at: Date.now(), rows };
  })();
  try {
    await era5Inflight;
  } catch (err) {
    console.warn("[afya] ERA5 refresh failed:", (err as Error).message);
  } finally {
    era5Inflight = null;
  }
}

type CompleteEra5Row = { [K in keyof Era5Row]: NonNullable<Era5Row[K]> };

const isComplete = (r: Era5Row): r is CompleteEra5Row =>
  r.wind_ms != null && r.wind_dir != null && r.solar_wm2 != null &&
  r.precip_mm != null && r.soil_m3 != null && r.pressure_hpa != null;

/** ERA5 at the anchor's hour of day (to the nearest hour) on the latest day
 * that has every value, never later than the anchor itself. */
export function era5FromRows(
  rows: Era5Row[],
  anchorIso: string,
  localTempC: number,
  localHum: number,
): Era5Context {
  const anchorMs = Date.parse(anchorIso);
  const hour = new Date(Math.round(anchorMs / 3600_000) * 3600_000).getUTCHours();
  let best: CompleteEra5Row | null = null;
  for (const r of rows) {
    const t = Date.parse(r.time);
    if (t > anchorMs || new Date(t).getUTCHours() !== hour || !isComplete(r)) continue;
    if (!best || t > Date.parse(best.time)) best = r;
  }
  if (!best) return ERA5_UNAVAILABLE;

  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    available: true,
    era5_temp_c: r1(best.temp_c),
    era5_dewpoint_c: r1(dewpoint(best.temp_c, best.rh)),
    era5_relative_humidity: r1(best.rh),
    era5_pressure_hpa: r1(best.pressure_hpa),
    era5_wind_speed_ms: r1(best.wind_ms),
    era5_wind_dir_deg: Math.round(best.wind_dir),
    era5_solar_wm2: Math.round(best.solar_wm2),
    era5_precip_hourly_mm: r1(best.precip_mm),
    era5_soil_moisture: Math.round(best.soil_m3 * 100) / 100,
    local_temp_anomaly_c: r1(localTempC - best.temp_c),
    local_humidity_anomaly: r1(localHum - best.rh),
    valid_time: best.time,
  };
}

function dewpoint(tC: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const alpha = Math.log(Math.max(rh, 1) / 100) + (a * tC) / (b + tC);
  return (b * alpha) / (a - alpha);
}

export interface Era5SeriesPoint {
  time: string;
  temp_c: number;
  rh: number;
  precip_mm: number | null;
}

/** Raw hourly ERA5 rows for charting, ensures the cache is warm first. */
export async function getEra5Series(): Promise<Era5SeriesPoint[]> {
  if (!era5Cache || Date.now() - era5Cache.at > ERA5_TTL) await refreshEra5();
  return (era5Cache?.rows ?? []).map((r) => ({
    time: r.time,
    temp_c: r.temp_c,
    rh: r.rh,
    precip_mm: r.precip_mm,
  }));
}

/** ERA5 daily rainfall totals (UTC calendar days) for a bar-chart timeline. */
export async function getDailyRainfallSeries(): Promise<{ date: string; mm: number }[]> {
  if (!era5Cache || Date.now() - era5Cache.at > ERA5_TTL) await refreshEra5();
  const rows = era5Cache?.rows ?? [];
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.precip_mm == null) continue;
    const day = r.time.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Math.max(0, r.precip_mm));
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, mm]) => ({ date, mm: Math.round(mm * 10) / 10 }));
}

// Regional daily record
// Open-Meteo's forecast API with past days: a model, not a measurement, but
// with no publication lag, so the past month runs up to today. It gives the
// rainfall context, and the farm advice falls back on it when the station has
// too little of its own.

export interface RegionalDay {
  /** Nairobi calendar date */
  date: string;
  precip_mm: number | null;
  tmax_c: number | null;
  tmin_c: number | null;
  /** FAO-56 Penman-Monteith reference evapotranspiration */
  et0_mm: number | null;
}

export interface RegionalHour {
  /** End of the hour the rain fell in, UTC */
  time: string;
  precip_mm: number | null;
}

export interface RegionalDaily {
  /** Oldest first: the past month, today and two days ahead */
  days: RegionalDay[];
  hours: RegionalHour[];
}

const REGIONAL_DAILY_TTL = 3600_000;
const REGIONAL_DAILY_MAX_AGE = 6 * 3600_000;
const REGIONAL_PAST_DAYS = 31;
let regionalDailyCache: { at: number; data: RegionalDaily } | null = null;
let regionalDailyInflight: Promise<RegionalDaily | null> | null = null;

export async function getRegionalDaily(): Promise<RegionalDaily | null> {
  if (regionalDailyCache && Date.now() - regionalDailyCache.at < REGIONAL_DAILY_TTL) {
    return regionalDailyCache.data;
  }
  if (!regionalDailyInflight) {
    regionalDailyInflight = fetchRegionalDaily()
      .then((data) => {
        regionalDailyCache = { at: Date.now(), data };
        return data;
      })
      .catch((err) => {
        console.warn("[afya] Regional daily record unavailable:", (err as Error).message);
        const cached = regionalDailyCache;
        return cached && Date.now() - cached.at < REGIONAL_DAILY_MAX_AGE ? cached.data : null;
      })
      .finally(() => {
        regionalDailyInflight = null;
      });
  }
  return regionalDailyInflight;
}

async function fetchRegionalDaily(): Promise<RegionalDaily> {
  const params = new URLSearchParams({
    latitude: String(JKUAT_COORDS.lat),
    longitude: String(JKUAT_COORDS.lng),
    daily: "precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration",
    hourly: "precipitation",
    past_days: String(REGIONAL_PAST_DAYS),
    forecast_days: "3",
    timezone: "Africa/Nairobi",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Open-Meteo daily HTTP ${res.status}`);
  const data = parseRegionalDaily(await res.json());
  if (!data) throw new Error("Open-Meteo daily: empty response");
  return data;
}

/** The forecast API's daily and hourly arrays (Nairobi local times) as records. */
export function parseRegionalDaily(json: unknown): RegionalDaily | null {
  const { daily: d, hourly: h } = json as {
    daily?: {
      time?: string[];
      precipitation_sum?: (number | null)[];
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
      et0_fao_evapotranspiration?: (number | null)[];
    };
    hourly?: { time?: string[]; precipitation?: (number | null)[] };
  };
  if (!d?.time?.length || !h?.time?.length) return null;
  return {
    days: d.time.map((date, i) => ({
      date,
      precip_mm: d.precipitation_sum?.[i] ?? null,
      tmax_c: d.temperature_2m_max?.[i] ?? null,
      tmin_c: d.temperature_2m_min?.[i] ?? null,
      et0_mm: d.et0_fao_evapotranspiration?.[i] ?? null,
    })),
    hours: h.time.map((t, i) => ({
      time: new Date(`${t}:00+03:00`).toISOString(),
      precip_mm: h.precipitation?.[i] ?? null,
    })),
  };
}

/** Rain per Nairobi day for the `n` days ending today, today counting only the
 * hours that have ended by `nowMs`. */
export function regionalRainDays(data: RegionalDaily, nowMs: number, n = 30): { date: string; mm: number | null }[] {
  const today = nairobiDate(nowMs);
  const byDate = new Map(data.days.map((d) => [d.date, d.precip_mm]));
  return datesEnding(today, n).map((date) => ({
    date,
    mm: date === today ? rainSoFarToday(data, nowMs) : byDate.get(date) ?? null,
  }));
}

function rainSoFarToday(data: RegionalDaily, nowMs: number): number | null {
  const dayStart = nairobiDayStartMs(nairobiDate(nowMs));
  let total = 0;
  for (const h of data.hours) {
    const t = Date.parse(h.time);
    if (t <= dayStart || t > nowMs) continue;
    if (h.precip_mm == null) return null;
    total += h.precip_mm;
  }
  return Math.round(total * 10) / 10;
}

/** Rain in the regional forecast for the `hours` after `nowMs`. */
export function regionalRainAhead(data: RegionalDaily, nowMs: number, hours = 48): number | null {
  const end = nowMs + hours * 3600_000;
  const ahead = data.hours.filter((h) => {
    const t = Date.parse(h.time);
    return t > nowMs && t <= end;
  });
  if (ahead.length < hours || ahead.some((h) => h.precip_mm == null)) return null;
  return Math.round(ahead.reduce((sum, h) => sum + (h.precip_mm ?? 0), 0) * 10) / 10;
}

/** The ending hour of the last hour counted into today's total. */
function lastHourCounted(data: RegionalDaily, nowMs: number): string {
  let last = nairobiDayStartMs(nairobiDate(nowMs));
  for (const h of data.hours) {
    const t = Date.parse(h.time);
    if (t <= nowMs && t > last) last = t;
  }
  return new Date(last).toISOString();
}

const RAINFALL_UNAVAILABLE: ChirpsContext = {
  available: false,
  source: null,
  chirps_mm: null,
  chirps_7d_mm: null,
  chirps_30d_mm: null,
  chirps_percentile: null,
  chirps_dry_spell_days: null,
  chirps_wet_spell_days: null,
  valid_date: null,
  window_7d_start: null,
  window_30d_start: null,
  through: null,
};

/** The rainfall context for the Nairobi day of `nowMs`. */
export function rainfallContextFrom(data: RegionalDaily, nowMs: number): ChirpsContext {
  const days = regionalRainDays(data, nowMs, 30);
  const totals = days.map((d) => d.mm);
  if (totals.some((mm) => mm == null)) return RAINFALL_UNAVAILABLE;
  const mm = totals as number[];
  const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10;
  const today = mm[mm.length - 1];

  return {
    available: true,
    source: "open-meteo-forecast",
    chirps_mm: today,
    chirps_7d_mm: sum(mm.slice(-7)),
    chirps_30d_mm: sum(mm),
    chirps_percentile: midRankPercentile(mm, today),
    chirps_dry_spell_days: spellLength(mm, false),
    chirps_wet_spell_days: spellLength(mm, true),
    valid_date: days[days.length - 1].date,
    window_7d_start: days[days.length - 7].date,
    window_30d_start: days[0].date,
    through: lastHourCounted(data, nowMs),
  };
}

/** Rainfall around the station for today and the 7 and 30 days ending today.
 * A replay anchor gets no context: the model's past days do not reach back far. */
export async function getRainfallContext(anchorIso: string, nearNow: boolean = true): Promise<ChirpsContext> {
  if (!nearNow) return RAINFALL_UNAVAILABLE;
  const data = await getRegionalDaily();
  return data ? rainfallContextFrom(data, Date.now()) : RAINFALL_UNAVAILABLE;
}

// Regional soil moisture, context only
// ERA5-Land (~9 km) daily mean at 7 to 28 cm, the layer most crop roots draw
// on, placed within its own last 365 days. A modelled grid cell is not the
// field, so it is never read against soil water limits. The archive runs about
// five days behind, so this is fetched once a day.

export interface RegionalSoilMoisture {
  /** Latest day ERA5-Land has */
  date: string;
  value_m3: number;
  /** Mid-rank percentile among the 365 days ending on `date` */
  percentile: number;
  layer: "7-28 cm";
  source: "ERA5-Land";
}

const SOIL_RECORD_DAYS = 365;
const SOIL_MIN_RECORD_DAYS = 330;
let soilCache: { day: string; data: RegionalSoilMoisture } | null = null;

export async function getRegionalSoilMoisture(): Promise<RegionalSoilMoisture | null> {
  const day = new Date().toISOString().slice(0, 10);
  if (soilCache?.day === day) return soilCache.data;
  try {
    const params = new URLSearchParams({
      latitude: String(JKUAT_COORDS.lat),
      longitude: String(JKUAT_COORDS.lng),
      models: "era5_land",
      daily: "soil_moisture_7_to_28cm_mean",
      start_date: new Date(Date.now() - (SOIL_RECORD_DAYS + 30) * 86400_000).toISOString().slice(0, 10),
      end_date: day,
      timezone: "Africa/Nairobi",
    });
    const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`ERA5-Land HTTP ${res.status}`);
    const json = (await res.json()) as { daily?: { time?: string[]; soil_moisture_7_to_28cm_mean?: (number | null)[] } };
    const data = soilMoistureContext(json.daily?.time ?? [], json.daily?.soil_moisture_7_to_28cm_mean ?? []);
    if (!data) throw new Error("ERA5-Land soil moisture record too short");
    soilCache = { day, data };
    return data;
  } catch (err) {
    console.warn("[afya] Regional soil moisture unavailable:", (err as Error).message);
    return soilCache?.data ?? null;
  }
}

/** The latest day with a value and its place among the 365 days ending then. */
export function soilMoistureContext(dates: string[], values: (number | null)[]): RegionalSoilMoisture | null {
  const known: { date: string; value: number }[] = [];
  dates.forEach((date, i) => {
    const value = values[i];
    if (typeof value === "number" && Number.isFinite(value)) known.push({ date, value });
  });
  if (!known.length) return null;
  const latest = known[known.length - 1];
  const from = Date.parse(latest.date) - (SOIL_RECORD_DAYS - 1) * 86400_000;
  const record = known.filter((d) => Date.parse(d.date) >= from).map((d) => d.value);
  if (record.length < SOIL_MIN_RECORD_DAYS) return null;
  return {
    date: latest.date,
    value_m3: latest.value,
    percentile: midRankPercentile(record, latest.value),
    layer: "7-28 cm",
    source: "ERA5-Land",
  };
}

// Regional day-ahead outlook (real Open-Meteo forecast, no key needed)
// Model output for the future, unlike the ERA5 archive above. It exists so
// planning still works when the Conduit ground station has gone quiet for
// longer than the +9h forecast horizon: the station forecast is anchored to the
// last real observation and becomes meaningless once "now" has moved past
// its own horizon, but a regional model forecast doesn't depend on the
// station at all. Always labeled REGIONAL_MODEL, a real forecast, but a
// shade WBGT estimate for a ~9 km grid cell, not the station's own
// measurements.
export interface RegionalOutlookPoint {
  time: string;
  wbgt_like: number;
  temp_c: number;
  humidity_pct: number;
}

const REGIONAL_FORECAST_TTL = 3 * 3600_000;
let regionalForecastCache: { at: number; lat: number; lng: number; points: RegionalOutlookPoint[] } | null = null;

export async function getRegionalForecastSeries(lat: number, lng: number): Promise<RegionalOutlookPoint[]> {
  if (
    regionalForecastCache &&
    Date.now() - regionalForecastCache.at < REGIONAL_FORECAST_TTL &&
    Math.abs(regionalForecastCache.lat - lat) < 0.001 &&
    Math.abs(regionalForecastCache.lng - lng) < 0.001
  ) {
    return regionalForecastCache.points;
  }

  const { shadeWbgtFromHumidity } = await import("./constants");
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: "temperature_2m,relative_humidity_2m",
    forecast_days: "3",
    timezone: "UTC",
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
    const json = (await res.json()) as {
      hourly?: { time?: string[]; temperature_2m?: (number | null)[]; relative_humidity_2m?: (number | null)[] };
    };
    const h = json.hourly;
    if (!h?.time?.length) throw new Error("Open-Meteo forecast: empty hourly series");

    // An hour missing either value is left out, not filled in.
    const points: RegionalOutlookPoint[] = [];
    h.time.forEach((t, i) => {
      const temp = h.temperature_2m?.[i];
      const rh = h.relative_humidity_2m?.[i];
      if (temp == null || rh == null) return;
      points.push({
        time: t.endsWith("Z") ? t : `${t}Z`,
        temp_c: temp,
        humidity_pct: rh,
        wbgt_like: Math.round(shadeWbgtFromHumidity(temp, rh) * 10) / 10,
      });
    });

    regionalForecastCache = { at: Date.now(), lat, lng, points };
    return points;
  } catch (err) {
    console.warn("[afya] Regional forecast unavailable:", err instanceof Error ? err.message : err);
    return regionalForecastCache?.points ?? [];
  }
}

// Copernicus Data Space, Sentinel-2 / Sentinel-3
// Real acquisition metadata from the CDSE Catalog + NDVI statistics via the
// Sentinel Hub Statistical API. LST values require SLSTR thermal statistics
// and are intentionally left null rather than estimated.

const SAT_TTL = 6 * 3600_000;
let satCache: { at: number; data: LiveSat } | null = null;
let satInflight: Promise<void> | null = null;

interface CatalogFeature {
  id: string;
  properties?: { datetime?: string; "eo:cloud_cover"?: number };
}

interface LiveSat {
  acquisitions: SatelliteAcquisition[];
  s2: { acquired: string; ndvi: number | null } | null;
  s3: { acquired: string } | null;
}

// Both `await` the refresh rather than firing it in the background, see the
// header for why that pattern doesn't reliably work on a serverless platform.

export async function getSentinelContextLive(nearNow: boolean = true): Promise<SentinelContext> {
  if (nearNow && hasCopernicusCreds() && (!satCache || Date.now() - satCache.at > SAT_TTL)) {
    await refreshSatellite();
  }
  if (satCache) return satContextFrom(satCache.data);
  return generateSentinelContext();
}

export async function getSatelliteAcquisitionsLive(nearNow: boolean = true): Promise<SatelliteAcquisition[]> {
  if (nearNow && hasCopernicusCreds() && (!satCache || Date.now() - satCache.at > SAT_TTL)) {
    await refreshSatellite();
  }
  if (satCache) return satCache.data.acquisitions;
  return getSatelliteAcquisitions();
}

function satContextFrom(d: LiveSat): SentinelContext {
  return {
    sentinel2_available: !!d.s2,
    sentinel2_acquired: d.s2?.acquired ?? null,
    sentinel2_ndvi_mean: d.s2?.ndvi ?? null,
    sentinel3_available: !!d.s3,
    sentinel3_acquired: d.s3?.acquired ?? null,
    sentinel3_lst_c: null, // real LST requires SLSTR thermal statistics, never estimated
  };
}

async function catalogSearch(token: string, collection: string, limit: number): Promise<CatalogFeature[]> {
  const from = new Date(Date.now() - 60 * 86400_000).toISOString();
  const to = new Date().toISOString();
  const url = new URL("https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search");
  url.searchParams.set("bbox", "36.95,-1.15,37.10,-1.05");
  url.searchParams.set("collections", collection);
  url.searchParams.set("datetime", `${from}/${to}`);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`catalog ${collection} HTTP ${res.status}`);
  const json = (await res.json()) as { features?: CatalogFeature[] };
  return (json.features ?? []).filter((f) => !!f.properties?.datetime);
}

async function refreshSatellite(): Promise<void> {
  if (satInflight) {
    await satInflight.catch(() => {});
    return;
  }
  satInflight = (async () => {
    const token = await cdseToken();
    const [s2All, s3All] = await Promise.all([
      catalogSearch(token, "sentinel-2-l2a", 10),
      catalogSearch(token, "sentinel-3-slstr", 6).catch(() => [] as CatalogFeature[]),
    ]);

    // Prefer clearer scenes; catalog returns newest first. NDVI is only
    // computed from clear scenes (< 60% cloud), cloudy-scene NDVI
    // would be dominated by cloud pixels and scientifically misleading.
    const s2 = s2All.filter((f) => (f.properties?.["eo:cloud_cover"] ?? 100) < 80).slice(0, 6);
    const s2Clear = s2All.filter((f) => (f.properties?.["eo:cloud_cover"] ?? 100) < 60);
    const s3 = s3All.slice(0, 4);

    const acquisitions: SatelliteAcquisition[] = [
      ...s2.map((f) => toAcquisition(f, "Sentinel-2", "ndvi", "Sentinel-2 NDVI", "10 m")),
      ...s3.map((f) => toAcquisition(f, "Sentinel-3", "lst", "Sentinel-3 LST", "~1 km")),
    ].sort((a, b) => a.acquired.localeCompare(b.acquired));

    // Real NDVI mean from the latest clear Sentinel-2 acquisition (best effort)
    const s2ForNdvi = s2Clear[0] ?? null;
    const s2ForNdviDay = (s2ForNdvi?.properties?.datetime ?? "").slice(0, 10);
    const ndviMean =
      s2ForNdvi && /^\d{4}-\d{2}-\d{2}$/.test(s2ForNdviDay)
        ? await ndviStatisticsForBbox(token, JKUAT_NDVI_BBOX, s2ForNdviDay).catch(() => null)
        : null;
    // Context provenance must match the scene the NDVI came from
    const s2ContextSource = s2ForNdvi ?? s2[0] ?? null;

    satCache = {
      at: Date.now(),
      data: {
        acquisitions,
        s2: s2ContextSource
          ? {
              acquired: (s2ContextSource.properties?.datetime ?? "").slice(0, 10),
              ndvi: ndviMean,
            }
          : null,
        s3: s3[0] ? { acquired: (s3[0].properties?.datetime ?? "").slice(0, 10) } : null,
      },
    };
  })();
  try {
    await satInflight;
  } catch (err) {
    console.warn("[afya] Copernicus refresh failed, staying on fallback:", (err as Error).message);
  } finally {
    satInflight = null;
  }
}

function toAcquisition(
  f: CatalogFeature,
  sensor: "Sentinel-2" | "Sentinel-3",
  layer: string,
  label: string,
  resolution: string,
): SatelliteAcquisition {
  return {
    id: f.id,
    sensor,
    acquired: (f.properties?.datetime ?? "").slice(0, 10),
    layer,
    label,
    resolution,
    provenance: "SATELLITE_DERIVED",
  };
}
