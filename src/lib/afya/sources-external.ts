// ─── External context adapters (ERA5-Land regional + Copernicus Sentinel) ────
// Live retrieval with caching + graceful fallback (spec §40). All getters are
// async: they serve the cached live value when it's still fresh, otherwise
// await a real refresh directly before falling back to the demo fixture only
// if that refresh fails. (An earlier fire-and-forget-background-refresh
// version of this file assumed a long-running process; on Vercel a function
// can be frozen the instant its response is sent, so a background refresh
// never reliably got to finish — every cold invocation would silently serve
// the synthetic fixture forever, even with real credentials configured.)

import type { Era5Context, SentinelContext, ChirpsContext } from "./types";
import { generateEra5Context, generateSentinelContext, generateChirpsContext } from "./demo-observations";
import { getSatelliteAcquisitions, type SatelliteAcquisition } from "./map-data";
import { hasCopernicusCreds, cdseToken, ndviStatisticsForBbox } from "./copernicus";

const JKUAT = { lat: -1.0931, lng: 37.0149 };
const JKUAT_NDVI_BBOX: [number, number, number, number] = [37.0, -1.11, 37.03, -1.08];

// ═══ ERA5-Land regional context ═════════════════════════════════════════════
// Production CDS path (async job → NetCDF, CDS_API_KEY in .env) requires the
// Python sidecar prescribed by the technical specification. This Node adapter
// retrieves the same ECMWF ERA5-Land data through the ERA5 archive REST mirror,
// which serves instant JSON. ERA5 publishes with ~5 days of latency, so the
// regional baseline is diurnal-cycle matched (same hour, most recent day).

const ERA5_TTL = 3 * 3600_000;
let era5Cache: { at: number; rows: Era5Row[] } | null = null;
let era5Inflight: Promise<void> | null = null;

interface Era5Row {
  time: string;
  temp_c: number;
  rh: number;
  wind_ms: number;
  wind_dir: number;
  solar_wm2: number;
  precip_mm: number;
  soil_m3: number;
  pressure_hpa: number;
}

/**
 * `nearNow` gates whether we bother attempting a real fetch at all: for a
 * genuine historical replay anchor, "real recent ERA5" isn't a meaningful
 * concept, so we go straight to the synthetic (but anchor-consistent)
 * generator rather than wasting a network round trip.
 *
 * This is `await`ed rather than fire-and-forget-with-instant-fallback: on a
 * serverless platform (Vercel) a function's execution can be frozen the
 * moment its response is sent, so a background refresh kicked off here has
 * no reliable chance to finish and populate the cache for next time — every
 * cold invocation would otherwise silently serve the synthetic fallback
 * forever, even with real credentials configured.
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
  return generateEra5Context(anchorIso, localTempC, localHum);
}

async function refreshEra5(): Promise<void> {
  if (era5Inflight) {
    await era5Inflight.catch(() => {});
    return;
  }
  era5Inflight = (async () => {
    // ERA5 publishes with ~5-day latency — request a guaranteed-available window.
    // 30 days wide (not just enough for the diurnal-match) so the same hourly
    // precipitation rows can also back a real 7d/30d rainfall accumulation
    // (see getRainfallContext) instead of a fabricated stand-in for CHIRPS.
    const end = new Date(Date.now() - 5 * 86400_000);
    const start = new Date(end.getTime() - 30 * 86400_000);
    const params = new URLSearchParams({
      latitude: String(JKUAT.lat),
      longitude: String(JKUAT.lng),
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
        time: h.time[i].endsWith("Z") ? h.time[i] : `${h.time[i]}Z`,
        temp_c: t,
        rh,
        wind_ms: windKmh == null ? 0 : windKmh / 3.6, // km/h → m/s
        wind_dir: h.wind_direction_10m?.[i] ?? 0,
        solar_wm2: h.shortwave_radiation?.[i] ?? 0,
        precip_mm: h.precipitation?.[i] ?? 0,
        soil_m3: h.soil_moisture_0_to_7cm?.[i] ?? 0.18,
        pressure_hpa: h.surface_pressure?.[i] ?? 850,
      });
    }
    if (rows.length < 12) throw new Error("ERA5 rows too sparse");
    era5Cache = { at: Date.now(), rows };
  })();
  try {
    await era5Inflight;
  } catch (err) {
    console.warn("[afya] ERA5 refresh failed, staying on fallback:", (err as Error).message);
  } finally {
    era5Inflight = null;
  }
}

function era5FromRows(
  rows: Era5Row[],
  anchorIso: string,
  localTempC: number,
  localHum: number,
): Era5Context {
  if (!rows.length) return generateEra5Context(anchorIso, localTempC, localHum);
  // Pick the ERA5 hour closest to the situation anchor → diurnal-matched baseline
  const anchorMs = new Date(anchorIso).getTime();
  let best = rows[0];
  let bestDiff = Infinity;
  for (const r of rows) {
    const d = Math.abs(new Date(r.time).getTime() - anchorMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = r;
    }
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
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

// ═══ Rainfall accumulation (real, from the same ERA5 hourly precipitation) ══
// The technical spec calls for CHIRPS satellite rainfall; a genuine point
// extraction from CHIRPS's gridded product needs raster tooling this Node
// adapter doesn't have. Real ERA5-Land precipitation serves the same purpose
// (regional rainfall accumulation) and is already being fetched for the
// temperature/humidity context above — so this reuses those same hourly
// rows instead of fabricating fixed numbers, which is what happened before.

export async function getRainfallContext(anchorIso: string, nearNow: boolean = true): Promise<ChirpsContext> {
  if (nearNow && (!era5Cache || Date.now() - era5Cache.at > ERA5_TTL)) {
    await refreshEra5();
  }
  if (era5Cache) return rainfallFromRows(era5Cache.rows, anchorIso);
  return generateChirpsContext(anchorIso);
}

export interface Era5SeriesPoint {
  time: string;
  temp_c: number;
  rh: number;
  precip_mm: number;
}

/** Raw hourly ERA5 rows for charting — ensures the cache is warm first. */
export async function getEra5Series(): Promise<Era5SeriesPoint[]> {
  if (!era5Cache || Date.now() - era5Cache.at > ERA5_TTL) await refreshEra5();
  return (era5Cache?.rows ?? []).map((r) => ({
    time: r.time,
    temp_c: r.temp_c,
    rh: r.rh,
    precip_mm: r.precip_mm,
  }));
}

// ─── Regional day-ahead outlook (real Open-Meteo forecast, no key needed) ────
// Unlike everything else in this file (which reads the ERA5-Land *archive*,
// i.e. the recent past), this hits Open-Meteo's actual forecast product —
// genuine future model output, not a proxy of it. It exists specifically so
// planning still works when the Conduit ground station has gone quiet for
// longer than the +9h forecast horizon: the ML forecast is anchored to the
// last real observation and becomes meaningless once "now" has moved past
// its own horizon, but a regional model forecast doesn't depend on the
// station at all. Always labeled REGIONAL_MODEL — a real forecast, but a
// shade-only WBGT approximation for a ~9km grid cell, not the sensor-grade
// ground truth Conduit provides when it's reporting.
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

  const { approxWbgtShade } = await import("./constants");
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
      hourly?: { time?: string[]; temperature_2m?: number[]; relative_humidity_2m?: number[] };
    };
    const h = json.hourly;
    if (!h?.time?.length) throw new Error("Open-Meteo forecast: empty hourly series");

    const points: RegionalOutlookPoint[] = h.time.map((t, i) => {
      const temp = h.temperature_2m?.[i] ?? 20;
      const rh = h.relative_humidity_2m?.[i] ?? 60;
      return {
        time: t.endsWith("Z") ? t : `${t}Z`,
        temp_c: temp,
        humidity_pct: rh,
        wbgt_like: Math.round(approxWbgtShade(temp, rh) * 10) / 10,
      };
    });

    regionalForecastCache = { at: Date.now(), lat, lng, points };
    return points;
  } catch (err) {
    console.warn("[afya] Regional forecast unavailable:", err instanceof Error ? err.message : err);
    return regionalForecastCache?.points ?? [];
  }
}

/** Real daily rainfall totals (UTC calendar days) for a bar-chart timeline. */
export async function getDailyRainfallSeries(): Promise<{ date: string; mm: number }[]> {
  if (!era5Cache || Date.now() - era5Cache.at > ERA5_TTL) await refreshEra5();
  const rows = era5Cache?.rows ?? [];
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.time.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Math.max(0, r.precip_mm));
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, mm]) => ({ date, mm: Math.round(mm * 10) / 10 }));
}

function rainfallFromRows(rows: Era5Row[], anchorIso: string): ChirpsContext {
  if (!rows.length) return generateChirpsContext(anchorIso);

  // Sum hourly precip into UTC calendar days, sorted ascending.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.time.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Math.max(0, r.precip_mm));
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (days.length < 5) return generateChirpsContext(anchorIso);

  const totals = days.map(([, mm]) => mm);
  const lastIdx = days.length - 1;
  const last7 = totals.slice(Math.max(0, lastIdx - 6), lastIdx + 1);
  const last30 = totals.slice(Math.max(0, lastIdx - 29), lastIdx + 1);
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const todayMm = totals[lastIdx];
  const percentile = Math.round(
    (last30.filter((v) => v <= todayMm).length / last30.length) * 100,
  );

  let drySpell = 0;
  for (let i = lastIdx; i >= 0 && totals[i] < 0.1; i--) drySpell++;
  let wetSpell = 0;
  for (let i = lastIdx; i >= 0 && totals[i] >= 0.1; i--) wetSpell++;

  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    chirps_mm: r1(todayMm),
    chirps_7d_mm: r1(sum(last7)),
    chirps_30d_mm: r1(sum(last30)),
    chirps_percentile: percentile,
    chirps_dry_spell_days: drySpell,
    chirps_wet_spell_days: wetSpell,
    valid_date: days[lastIdx][0],
  };
}

// ═══ Copernicus Data Space — Sentinel-2 / Sentinel-3 ════════════════════════
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

// Both `await` the refresh rather than firing it in the background — see the
// comment on getEra5ContextLive for why that pattern doesn't reliably work
// on a serverless platform, where the function can be frozen right after its
// response is sent, before a background fetch gets a chance to finish.

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
    sentinel3_lst_c: null, // real LST requires SLSTR thermal statistics — never estimated
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
    // computed from genuinely clear scenes (< 60% cloud) — cloudy-scene NDVI
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

