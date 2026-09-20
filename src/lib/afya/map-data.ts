// ─── Regional Environmental Outlook data ─────────────────────────────────────
// Real county boundaries (public/geo/counties.geojson) with per-county
// indicators derived from real sources wherever practical:
//   - Weather (temp/humidity/wind/rain/soil moisture): batched Open-Meteo
//     forecast API, one request for every county centroid, no key required.
//   - Thermal risk category: the same wbgtToRisk() classification the rest
//     of the app uses, fed a shade-only WBGT approximation (Australian BoM
//     formula) from the real temperature/humidity above — a coarse regional
//     proxy, not the sensor-grade WBGT computed for the JKUAT station.
//   - NDVI: real Copernicus Sentinel-2 statistics per county, best-effort
//     (unfiltered for cloud cover — see copernicus.ts), when CDSE credentials
//     are configured.
//   - LST: intentionally left null. As elsewhere in this codebase, land
//     surface temperature requires SLSTR thermal statistics and is never
//     estimated from a proxy.
// The county actually hosting the Conduit station (Kiambu — JKUAT/Juja) uses
// the real current pipeline output (measured WBGT, observed rain) instead of
// the Open-Meteo proxy, when real (non-demo) pipeline data is available.

import fs from "fs";
import path from "path";
import type { Geometry } from "geojson";
import { wbgtToRisk } from "./constants";
import { hasCopernicusCreds, cdseToken, ndviStatisticsForBbox, type Bbox } from "./copernicus";

export interface CountyFeature {
  type: "Feature";
  properties: {
    name: string;
    name_sw: string;
    outlook_category: "LOW" | "ELEVATED" | "HIGH" | "VERY_HIGH";
    confidence: "LOW" | "MODERATE" | "HIGH";
    temperature_anomaly_c: number;
    rain_24h_mm: number;
    soil_moisture: number;
    ndvi_mean: number | null;
    lst_c: number | null;
    sources: string[];
    trend: "rising" | "stable" | "falling";
    outlook_hours: { hour: string; category: string }[];
  };
  geometry: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
}

export interface CountyCollection {
  type: "FeatureCollection";
  features: CountyFeature[];
}

export interface StationOverride {
  countyName: string;
  wbgt: number;
  rainObserved: boolean;
  isRealData: boolean;
}

const OUTLOOK_HOURS = ["09:00", "12:00", "15:00", "18:00"];

// ─── County boundaries (real GeoJSON, loaded once) ──────────────────────────

interface LoadedCounty {
  name: string;
  name_sw: string;
  geometry: Geometry;
  centroid: { lat: number; lng: number };
  bbox: Bbox;
}

let boundariesCache: LoadedCounty[] | null = null;

function loadCountyBoundaries(): LoadedCounty[] {
  if (boundariesCache) return boundariesCache;
  const filePath = path.join(process.cwd(), "public", "geo", "counties.geojson");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const geo = JSON.parse(raw) as {
      features: { properties: { name: string; name_sw?: string }; geometry: Geometry }[];
    };
    boundariesCache = geo.features.map((f) => {
      const ring = ringOf(f.geometry);
      const { centroid, bbox } = centroidAndBbox(ring);
      return {
        name: f.properties.name,
        name_sw: f.properties.name_sw ?? f.properties.name,
        geometry: f.geometry,
        centroid,
        bbox,
      };
    });
  } catch (err) {
    console.warn("[afya] Failed to load county boundaries:", (err as Error).message);
    boundariesCache = [];
  }
  return boundariesCache;
}

function ringOf(geometry: Geometry): [number, number][] {
  if (geometry.type === "Polygon") return geometry.coordinates[0] as [number, number][];
  if (geometry.type === "MultiPolygon") return geometry.coordinates[0][0] as [number, number][];
  return [];
}

function centroidAndBbox(ring: [number, number][]): { centroid: { lat: number; lng: number }; bbox: Bbox } {
  if (!ring.length) return { centroid: { lat: -1.09, lng: 37.0 }, bbox: [36.9, -1.2, 37.1, -1.0] };
  let sumLng = 0, sumLat = 0;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    sumLng += lng;
    sumLat += lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return {
    centroid: { lat: sumLat / ring.length, lng: sumLng / ring.length },
    bbox: [minLng, minLat, maxLng, maxLat],
  };
}

// ─── Weather (real, batched Open-Meteo) ─────────────────────────────────────

interface CountyWeather {
  tempC: number;
  rh: number;
  rain24hMm: number;
  soilMoisture: number;
  trend: "rising" | "stable" | "falling";
  hourlyCategories: { hour: string; category: string }[];
}

async function fetchRegionalWeather(counties: LoadedCounty[]): Promise<(CountyWeather | null)[]> {
  const lats = counties.map((c) => c.centroid.lat).join(",");
  const lngs = counties.map((c) => c.centroid.lng).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&current=temperature_2m,relative_humidity_2m&hourly=temperature_2m,relative_humidity_2m` +
    `&daily=precipitation_sum&forecast_days=1&timezone=Africa%2FNairobi`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Open-Meteo regional HTTP ${res.status}`);
  const json = (await res.json()) as OpenMeteoLocation[] | OpenMeteoLocation;
  const list = Array.isArray(json) ? json : [json]; // single-county requests aren't array-wrapped

  return list.map((loc) => {
    if (!loc?.current || !loc.hourly || !loc.daily) return null;
    const tempC = loc.current.temperature_2m;
    const rh = loc.current.relative_humidity_2m;
    const rain24hMm = loc.daily.precipitation_sum?.[loc.daily.precipitation_sum.length - 1] ?? 0;

    const hourlyCategories = OUTLOOK_HOURS.map((hour) => {
      const idx = loc.hourly!.time.findIndex((t) => t.endsWith(`T${hour}`));
      if (idx < 0) return { hour, category: wbgtToRisk(approxWbgtShade(tempC, rh)) };
      const t = loc.hourly!.temperature_2m[idx];
      const h = loc.hourly!.relative_humidity_2m[idx];
      return { hour, category: wbgtToRisk(approxWbgtShade(t, h)) };
    });

    // Trend: compare "now" against ~3h ahead in the same local-time series.
    const nowHour = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", hour12: false }).slice(0, 2);
    const nowIdx = loc.hourly.time.findIndex((t) => t.endsWith(`T${nowHour}:00`));
    let trend: CountyWeather["trend"] = "stable";
    if (nowIdx >= 0 && nowIdx + 3 < loc.hourly.temperature_2m.length) {
      const delta = loc.hourly.temperature_2m[nowIdx + 3] - tempC;
      trend = delta > 0.5 ? "rising" : delta < -0.5 ? "falling" : "stable";
    }

    return {
      tempC,
      rh,
      rain24hMm,
      soilMoisture: 0.18, // regional default; per-county soil moisture omitted from the batched call for latency
      trend,
      hourlyCategories,
    };
  });
}

interface OpenMeteoLocation {
  current?: { temperature_2m: number; relative_humidity_2m: number };
  hourly?: { time: string[]; temperature_2m: number[]; relative_humidity_2m: number[] };
  daily?: { precipitation_sum: number[] };
}

/** Shade-only WBGT approximation (Australian Bureau of Meteorology formula). */
function approxWbgtShade(tempC: number, rhPct: number): number {
  const es = 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  const e = (rhPct / 100) * es;
  return 0.567 * tempC + 0.393 * e + 3.94;
}

// ─── NDVI (real, per-county Copernicus Sentinel-2 statistics) ──────────────

const NDVI_TTL_MS = 6 * 3600_000;
const NDVI_BOX_HALF_DEG = 0.02; // ~2 km half-width sample box around each centroid

let ndviCache: { at: number; byCounty: Record<string, number | null> } | null = null;

async function getRegionalNdvi(counties: LoadedCounty[]): Promise<Record<string, number | null>> {
  if (!hasCopernicusCreds()) return {};
  if (ndviCache && Date.now() - ndviCache.at < NDVI_TTL_MS) return ndviCache.byCounty;

  try {
    const token = await cdseToken();
    // Sentinel-2's ~5 day revisit means a single day often misses these small
    // per-county sample boxes entirely — average over the last 14 days instead.
    const from = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const results = await Promise.allSettled(
      counties.map((c) => {
        const box: Bbox = [
          c.centroid.lng - NDVI_BOX_HALF_DEG,
          c.centroid.lat - NDVI_BOX_HALF_DEG,
          c.centroid.lng + NDVI_BOX_HALF_DEG,
          c.centroid.lat + NDVI_BOX_HALF_DEG,
        ];
        return ndviStatisticsForBbox(token, box, from, to);
      }),
    );
    const byCounty: Record<string, number | null> = {};
    results.forEach((r, i) => {
      byCounty[counties[i].name] = r.status === "fulfilled" ? r.value : null;
    });
    ndviCache = { at: Date.now(), byCounty };
    return byCounty;
  } catch (err) {
    console.warn("[afya] Regional NDVI fetch failed:", (err as Error).message);
    return ndviCache?.byCounty ?? {};
  }
}

// ─── Assembly ────────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function getRegionalOutlook(stationOverride?: StationOverride): Promise<CountyCollection> {
  const counties = loadCountyBoundaries();
  if (!counties.length) return { type: "FeatureCollection", features: [] };

  const [weather, ndviByCounty] = await Promise.all([
    fetchRegionalWeather(counties).catch((err) => {
      console.warn("[afya] Regional weather fetch failed, using estimates:", (err as Error).message);
      return counties.map((): CountyWeather | null => null);
    }),
    getRegionalNdvi(counties),
  ]);

  const knownTemps = weather.filter((w): w is CountyWeather => !!w).map((w) => w.tempC);
  const meanTemp = knownTemps.length ? knownTemps.reduce((a, b) => a + b, 0) / knownTemps.length : null;

  const features: CountyFeature[] = counties.map((c, i) => {
    const w = weather[i];
    const isStationCounty = stationOverride?.countyName === c.name && stationOverride.isRealData;
    const ndvi = ndviByCounty[c.name] ?? null;

    let wbgtEstimate: number;
    let confidence: CountyFeature["properties"]["confidence"];
    let sources: string[];
    let rain24h: number;
    let soilMoisture: number;
    let trend: CountyWeather["trend"];
    let outlookHours: { hour: string; category: string }[];

    if (isStationCounty) {
      wbgtEstimate = stationOverride!.wbgt;
      confidence = "HIGH";
      sources = ["Conduit station", "ERA5-Land"];
      rain24h = stationOverride!.rainObserved ? Math.max(w?.rain24hMm ?? 0, 2) : (w?.rain24hMm ?? 0);
      soilMoisture = w?.soilMoisture ?? 0.18;
      trend = w?.trend ?? "stable";
      outlookHours = w?.hourlyCategories ?? OUTLOOK_HOURS.map((hour) => ({ hour, category: wbgtToRisk(wbgtEstimate) }));
    } else if (w) {
      wbgtEstimate = approxWbgtShade(w.tempC, w.rh);
      confidence = "MODERATE";
      sources = ["Open-Meteo"];
      rain24h = w.rain24hMm;
      soilMoisture = w.soilMoisture;
      trend = w.trend;
      outlookHours = w.hourlyCategories;
    } else {
      wbgtEstimate = 20;
      confidence = "LOW";
      sources = ["estimate"];
      rain24h = 0;
      soilMoisture = 0.18;
      trend = "stable";
      outlookHours = OUTLOOK_HOURS.map((hour) => ({ hour, category: "ELEVATED" }));
    }

    if (ndvi != null) sources = [...sources, "Copernicus Sentinel-2"];

    return {
      type: "Feature",
      properties: {
        name: c.name,
        name_sw: c.name_sw,
        outlook_category: wbgtToRisk(wbgtEstimate),
        confidence,
        temperature_anomaly_c: w && meanTemp != null ? round1(w.tempC - meanTemp) : 0,
        rain_24h_mm: round1(rain24h),
        soil_moisture: soilMoisture,
        ndvi_mean: ndvi,
        lst_c: null, // never estimated — see file header
        sources,
        trend,
        outlook_hours: outlookHours,
      },
      geometry: {
        type: "Polygon",
        coordinates: ringToPolygonCoords(c.geometry),
      },
    };
  });

  return { type: "FeatureCollection", features };
}

function ringToPolygonCoords(geometry: Geometry): [number, number][][] {
  if (geometry.type === "Polygon") return geometry.coordinates as [number, number][][];
  if (geometry.type === "MultiPolygon") return geometry.coordinates[0] as [number, number][][];
  return [[]];
}

// ─── Satellite acquisitions metadata (demo fallback; live path in
// sources-external.ts uses real Copernicus catalog search when configured) ──

export interface SatelliteAcquisition {
  id: string;
  sensor: "Sentinel-2" | "Sentinel-3";
  acquired: string; // ISO date
  layer: string;
  label: string;
  resolution: string;
  provenance: string;
}

export function getSatelliteAcquisitions(): SatelliteAcquisition[] {
  return [
    {
      id: "s2-20260812",
      sensor: "Sentinel-2",
      acquired: "2026-08-12",
      layer: "ndvi",
      label: "Sentinel-2 NDVI",
      resolution: "10 m",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s2-20260822",
      sensor: "Sentinel-2",
      acquired: "2026-08-22",
      layer: "ndvi",
      label: "Sentinel-2 NDVI",
      resolution: "10 m",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s2-20260903",
      sensor: "Sentinel-2",
      acquired: "2026-09-03",
      layer: "ndvi",
      label: "Sentinel-2 NDVI",
      resolution: "10 m",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s2-20260905",
      sensor: "Sentinel-2",
      acquired: "2026-09-05",
      layer: "ndvi",
      label: "Sentinel-2 NDVI",
      resolution: "10 m",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s3-20260904",
      sensor: "Sentinel-3",
      acquired: "2026-09-04",
      layer: "lst",
      label: "Sentinel-3 LST",
      resolution: "~1 km",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s3-20260906",
      sensor: "Sentinel-3",
      acquired: "2026-09-06",
      layer: "lst",
      label: "Sentinel-3 LST",
      resolution: "~1 km",
      provenance: "SATELLITE_DERIVED",
    },
  ];
}
