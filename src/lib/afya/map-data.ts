// Regional outlook: real county boundaries (public/geo/counties.geojson) with
// indicators per county.
//   - Weather: one batched request to Open-Meteo's forecast API for every
//     county centroid, no key required: current temperature and humidity,
//     today's hourly temperature and humidity, this hour's 0-7 cm soil moisture
//     and today's rain total (the Nairobi day, hours still to come included).
//     All of it is model output, not measurement.
//   - Thermal and outlook: air temperature at 09:00, 12:00, 15:00 and 18:00,
//     and the same wbgtToRisk() bands as the rest of the app applied to shade
//     WBGT from temperature and humidity (Stull wet bulb, no sun term).
//   - NDVI: Copernicus Sentinel-2 statistics per county when CDSE credentials
//     are configured (not filtered for cloud; see copernicus.ts).
// Kiambu, the county the Conduit station stands in, takes the station for the
// hours it covers while the station is current: its measurement for hours
// already past today, its WBGT forecast for hours the forecast reaches, and
// gauge 1's own daily total in place of the model's rain.
// A county Open-Meteo did not answer for has null weather values, shown on the
// map and the flood page as unavailable.

import fs from "fs";
import path from "path";
import type { Geometry } from "geojson";
import type { RiskLevel, SituationResult } from "./types";
import { wbgtToRisk, shadeWbgtFromHumidity } from "./constants";
import { hasCopernicusCreds, cdseToken, ndviStatisticsForBbox, type Bbox } from "./copernicus";
import { EAT_OFFSET_MS, nairobiDate, nairobiTimeMs } from "./nairobi-time";

export type HourSource = "station_measured" | "station_forecast" | "regional_forecast";

export interface OutlookHour {
  /** Nairobi clock time today */
  hour: string;
  category: RiskLevel | null;
  /** Shade WBGT behind the category */
  wbgt_c: number | null;
  wbgt_source: HourSource | null;
  /** Air temperature, for the Thermal layer */
  temp_c: number | null;
  temp_source: HourSource | null;
}

export type FloodRisk = "LOW" | "ELEVATED" | "HIGH";

export interface CountyFeature {
  type: "Feature";
  properties: {
    name: string;
    name_sw: string;
    /** False when Open-Meteo gave nothing for this county */
    weather_available: boolean;
    /** Now: the station's WBGT in Kiambu while it is current, the forecast model elsewhere */
    outlook_category: RiskLevel | null;
    confidence: "LOW" | "MODERATE" | "HIGH";
    /** Current temperature minus the mean of the counties */
    temperature_anomaly_c: number | null;
    /** Today's total (Nairobi day): the station gauge in Kiambu while it covers
     * the day, otherwise the forecast, hours still to come included */
    rain_today_mm: number | null;
    /** This hour, 0 to 7 cm, m³/m³, forecast model */
    soil_moisture: number | null;
    /** Null when the rain or soil value it needs is missing */
    flood_risk: FloodRisk | null;
    ndvi_mean: number | null;
    sources: string[];
    outlook_hours: OutlookHour[];
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

export interface StationSlot {
  ts: string;
  temp_sht: number;
  wet_bulb_globe_temp: number;
  imputed?: string[];
}

export interface StationOverride {
  countyName: string;
  /** Current shade WBGT at the station */
  wbgt: number;
  /** Real station data no more than three hours old */
  isRealData: boolean;
  /** The station's 15-minute slots, oldest first */
  measured: StationSlot[];
  /** The station's WBGT forecast */
  forecast: { time: string; value: number }[];
  /** Gauge 1's own total for today so far, mm; null when the gauge missed too
   * much of the day for a total to mean anything (see dailyRainFrom). */
  rainTodayMm: number | null;
}

export const OUTLOOK_HOURS = ["09:00", "12:00", "15:00", "18:00"];

const STATION_COUNTY = "Kiambu";
const STATION_FRESH_MINUTES = 180;
/** Named apart from the station itself: the gauge is a measurement where the
 * rest of the rain on this map is model output. */
export const STATION_RAIN_SOURCE = "Conduit rain gauge";

/** Kiambu's station override from a pipeline run, the station series behind it
 * and gauge 1's total for today so far. */
export function stationOverrideFrom(
  situation: SituationResult,
  series: StationSlot[] | null,
  rainTodayMm: number | null = null,
): StationOverride {
  // Stale or synthetic station data is not shown as the county's current state.
  const isRealData = situation.data_source !== "DEMO" && situation.quality.freshness_minutes <= STATION_FRESH_MINUTES;
  return {
    countyName: STATION_COUNTY,
    wbgt: situation.current.wbgt_c,
    isRealData,
    measured: series ?? [],
    forecast: situation.forecast_series,
    rainTodayMm: isRealData ? rainTodayMm : null,
  };
}

// County boundaries (real GeoJSON, loaded once)

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

// Weather (real, batched Open-Meteo)

export interface CountyWeather {
  tempC: number;
  rh: number;
  rainTodayMm: number | null;
  soilMoisture: number | null;
  hours: OutlookHour[];
}

export interface OpenMeteoLocation {
  current?: { temperature_2m: number | null; relative_humidity_2m: number | null };
  hourly?: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    soil_moisture_0_to_7cm?: (number | null)[];
  };
  daily?: { time: string[]; precipitation_sum: (number | null)[] };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function emptyHour(hour: string): OutlookHour {
  return { hour, category: null, wbgt_c: null, wbgt_source: null, temp_c: null, temp_source: null };
}

function regionalHour(hour: string, tempC: number | null, rh: number | null): OutlookHour {
  if (tempC == null) return emptyHour(hour);
  const wbgt = rh == null ? null : round1(shadeWbgtFromHumidity(tempC, rh));
  return {
    hour,
    category: wbgt == null ? null : wbgtToRisk(wbgt),
    wbgt_c: wbgt,
    wbgt_source: wbgt == null ? null : "regional_forecast",
    temp_c: round1(tempC),
    temp_source: "regional_forecast",
  };
}

/** One county's forecast read at `nowMs`; null without current conditions. */
export function parseCountyWeather(loc: OpenMeteoLocation | undefined, nowMs: number): CountyWeather | null {
  const tempC = loc?.current?.temperature_2m;
  const rh = loc?.current?.relative_humidity_2m;
  if (tempC == null || rh == null) return null;

  const today = nairobiDate(nowMs);
  const h = loc?.hourly;
  const indexAt = (hhmm: string) => h?.time.indexOf(`${today}T${hhmm}`) ?? -1;
  const hours = OUTLOOK_HOURS.map((hour) => {
    const i = indexAt(hour);
    return i < 0 ? emptyHour(hour) : regionalHour(hour, h!.temperature_2m[i], h!.relative_humidity_2m[i]);
  });

  const nowIdx = indexAt(`${new Date(nowMs + EAT_OFFSET_MS).toISOString().slice(11, 13)}:00`);
  const dayIdx = loc?.daily?.time.indexOf(today) ?? -1;
  return {
    tempC,
    rh,
    rainTodayMm: dayIdx >= 0 ? loc!.daily!.precipitation_sum[dayIdx] ?? null : null,
    soilMoisture: nowIdx >= 0 ? h!.soil_moisture_0_to_7cm?.[nowIdx] ?? null : null,
    hours,
  };
}

// One request covers all 11 counties, so a refusal empties the whole map. The
// last answer stands in for up to an hour, and the page says when it was read.
const WEATHER_TTL_MS = 60 * 60_000;
let lastWeather: { at: number; data: (CountyWeather | null)[] } | null = null;

/** When the county weather on display was read, or null when it is this request's. */
export function regionalWeatherAsOf(nowMs: number = Date.now()): number | null {
  return lastWeather && nowMs - lastWeather.at > 60_000 ? lastWeather.at : null;
}

async function fetchRegionalWeather(counties: LoadedCounty[], nowMs: number): Promise<(CountyWeather | null)[]> {
  const lats = counties.map((c) => c.centroid.lat).join(",");
  const lngs = counties.map((c) => c.centroid.lng).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&current=temperature_2m,relative_humidity_2m&hourly=temperature_2m,relative_humidity_2m,soil_moisture_0_to_7cm` +
    `&daily=precipitation_sum&forecast_days=1&timezone=Africa%2FNairobi`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo regional HTTP ${res.status}`);
  const json = (await res.json()) as OpenMeteoLocation[] | OpenMeteoLocation;
  const list = Array.isArray(json) ? json : [json]; // single-county requests aren't array-wrapped
  const parsed = counties.map((_, i) => parseCountyWeather(list[i], nowMs));
  if (parsed.some((w) => w !== null)) lastWeather = { at: nowMs, data: parsed };
  return parsed;
}

// The station series is 15-minute slots; a forecast step is 15 minutes too.
const MEASURED_TOLERANCE_MS = 15 * 60_000;
const FORECAST_TOLERANCE_MS = 8 * 60_000;

function nearest<T>(items: T[], timeOf: (item: T) => number, at: number, tolerance: number): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const item of items) {
    const gap = Math.abs(timeOf(item) - at);
    if (gap <= tolerance && gap < bestGap) {
      best = item;
      bestGap = gap;
    }
  }
  return best;
}

const measuredTemp = (s: StationSlot) => !s.imputed?.includes("temp_sht");
const measuredWbgt = (s: StationSlot) =>
  measuredTemp(s) && !s.imputed?.includes("humidity_sht") && !s.imputed?.includes("wet_bulb_temp");

/** The station county's outlook hours: the station's measurement for hours
 * already past today, its WBGT forecast for hours the forecast reaches, and the
 * regional forecast otherwise. Air temperature ahead stays regional: the
 * station forecasts WBGT only. */
export function stationOutlookHours(nowMs: number, station: StationOverride, regional: OutlookHour[]): OutlookHour[] {
  const today = nairobiDate(nowMs);
  return OUTLOOK_HOURS.map((hour, i) => {
    const at = nairobiTimeMs(today, hour);
    const fallback = regional[i] ?? emptyHour(hour);
    if (at <= nowMs) {
      const slots = station.measured.filter(measuredTemp);
      const slot = nearest(slots, (s) => Date.parse(s.ts), at, MEASURED_TOLERANCE_MS);
      if (!slot) return fallback;
      const wbgtSlot = measuredWbgt(slot) ? slot : null;
      return {
        hour,
        category: wbgtSlot ? wbgtToRisk(wbgtSlot.wet_bulb_globe_temp) : fallback.category,
        wbgt_c: wbgtSlot ? round1(wbgtSlot.wet_bulb_globe_temp) : fallback.wbgt_c,
        wbgt_source: wbgtSlot ? "station_measured" : fallback.wbgt_source,
        temp_c: round1(slot.temp_sht),
        temp_source: "station_measured",
      };
    }
    const point = nearest(station.forecast, (p) => Date.parse(p.time), at, FORECAST_TOLERANCE_MS);
    if (!point) return fallback;
    return {
      ...fallback,
      category: wbgtToRisk(point.value),
      wbgt_c: round1(point.value),
      wbgt_source: "station_forecast",
    };
  });
}

// NDVI (real, per-county Copernicus Sentinel-2 statistics)

const NDVI_TTL_MS = 6 * 3600_000;
const NDVI_BOX_HALF_DEG = 0.02; // ~2 km half-width sample box around each centroid

let ndviCache: { at: number; byCounty: Record<string, number | null> } | null = null;

async function getRegionalNdvi(counties: LoadedCounty[]): Promise<Record<string, number | null>> {
  if (!hasCopernicusCreds()) return {};
  if (ndviCache && Date.now() - ndviCache.at < NDVI_TTL_MS) return ndviCache.byCounty;

  try {
    const token = await cdseToken();
    // Sentinel-2's ~5 day revisit means a single day often misses these small
    // per-county sample boxes entirely, average over the last 14 days instead.
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

// Assembly

/** Indicators for one county. `meanTemp` is the mean current temperature of
 * the counties Open-Meteo answered for. */
export function countyProperties(
  county: { name: string; name_sw: string },
  w: CountyWeather | null,
  ndvi: number | null,
  meanTemp: number | null,
  station: StationOverride | undefined,
  nowMs: number,
): CountyFeature["properties"] {
  const isStationCounty = station?.countyName === county.name && station.isRealData;
  const regionalHours = w?.hours ?? OUTLOOK_HOURS.map(emptyHour);

  let outlookCategory: RiskLevel | null = w ? wbgtToRisk(shadeWbgtFromHumidity(w.tempC, w.rh)) : null;
  let outlookHours = regionalHours;
  let confidence: CountyFeature["properties"]["confidence"] = w ? "MODERATE" : "LOW";
  let sources = w ? ["Open-Meteo"] : [];
  // The gauge is the only measured rainfall on this map. Kiambu keeps the model
  // total when the gauge missed too much of the day, as every other county does.
  const gaugeRain = isStationCounty ? station!.rainTodayMm : null;
  if (isStationCounty) {
    outlookCategory = wbgtToRisk(station!.wbgt);
    outlookHours = stationOutlookHours(nowMs, station!, regionalHours);
    confidence = "HIGH";
    sources = gaugeRain == null
      ? ["Conduit station", ...sources]
      : ["Conduit station", STATION_RAIN_SOURCE, ...sources];
  }
  if (ndvi != null) sources = [...sources, "Copernicus Sentinel-2"];

  const rainToday = gaugeRain ?? w?.rainTodayMm ?? null;
  const soilMoisture = w?.soilMoisture ?? null;
  return {
    name: county.name,
    name_sw: county.name_sw,
    weather_available: !!w,
    outlook_category: outlookCategory,
    confidence,
    temperature_anomaly_c: w && meanTemp != null ? round1(w.tempC - meanTemp) : null,
    rain_today_mm: rainToday == null ? null : round1(rainToday),
    soil_moisture: soilMoisture,
    flood_risk: computeFloodRisk(rainToday, soilMoisture),
    ndvi_mean: ndvi,
    sources,
    outlook_hours: outlookHours,
  };
}

export async function getRegionalOutlook(
  stationOverride?: StationOverride,
  nowMs: number = Date.now(),
): Promise<CountyCollection> {
  const counties = loadCountyBoundaries();
  if (!counties.length) return { type: "FeatureCollection", features: [] };

  const [weather, ndviByCounty] = await Promise.all([
    fetchRegionalWeather(counties, nowMs).catch((err) => {
      const held = lastWeather && nowMs - lastWeather.at < WEATHER_TTL_MS ? lastWeather.data : null;
      console.warn(
        `[afya] Regional weather fetch failed, ${held ? "showing the last read" : "counties marked unavailable"}:`,
        (err as Error).message,
      );
      return held ?? counties.map((): CountyWeather | null => null);
    }),
    getRegionalNdvi(counties),
  ]);

  const knownTemps = weather.filter((w): w is CountyWeather => !!w).map((w) => w.tempC);
  const meanTemp = knownTemps.length ? knownTemps.reduce((a, b) => a + b, 0) / knownTemps.length : null;

  const features: CountyFeature[] = counties.map((c, i) => ({
    type: "Feature",
    properties: countyProperties(c, weather[i], ndviByCounty[c.name] ?? null, meanTemp, stationOverride, nowMs),
    geometry: {
      type: "Polygon",
      coordinates: ringToPolygonCoords(c.geometry),
    },
  }));

  return { type: "FeatureCollection", features };
}

// Rain today (mm) and 0-7 cm soil moisture (m³/m³) behind the flood categories.
// The 0-7 cm layer is a depth average over ground that takes days to wet and
// dry, so it never reaches the near-saturation values a skin layer hits within
// an hour of rain: the bar belongs at the middle of field capacity rather than
// its top. 0.25 m³/m³ is the middle of the range FAO-56 Table 19 gives for
// loam (0.20 to 0.30) and inside silt loam's (0.22 to 0.36); ground that wet
// sheds new rain as runoff rather than absorbing it.
const FLOOD_WET_SOIL_M3 = 0.25;
const FLOOD_HIGH_RAIN_MM = 30;
const FLOOD_ELEVATED_RAIN_MM = 15;
const FLOOD_WET_SOIL_RAIN_MM = 5;

/** The page prints these, so a reader does not have to open the source. */
export const FLOOD_THRESHOLDS = {
  high_rain_mm: FLOOD_HIGH_RAIN_MM,
  elevated_rain_mm: FLOOD_ELEVATED_RAIN_MM,
  wet_soil_rain_mm: FLOOD_WET_SOIL_RAIN_MM,
  wet_soil_m3: FLOOD_WET_SOIL_M3,
};

/**
 * Flood-conducive-conditions indicator: rainfall + soil saturation, the same
 * two signals operational flash-flood guidance systems use before any terrain
 * modelling. This is deliberately NOT a flood-susceptibility map: that would
 * require a DEM, flow-accumulation or proximity-to-drainage data this project
 * doesn't have. County soils vary, so the category is indicative.
 * Null when the answer turns on a value that is missing: missing data is not LOW.
 */
export function computeFloodRisk(rainTodayMm: number | null, soilMoisture: number | null): FloodRisk | null {
  if (rainTodayMm == null) return null;
  const wet = soilMoisture == null ? null : soilMoisture >= FLOOD_WET_SOIL_M3;
  if (rainTodayMm >= FLOOD_HIGH_RAIN_MM) return wet == null ? null : wet ? "HIGH" : "ELEVATED";
  if (rainTodayMm >= FLOOD_ELEVATED_RAIN_MM) return "ELEVATED";
  if (rainTodayMm >= FLOOD_WET_SOIL_RAIN_MM) return wet == null ? null : wet ? "ELEVATED" : "LOW";
  return "LOW";
}

function ringToPolygonCoords(geometry: Geometry): [number, number][][] {
  if (geometry.type === "Polygon") return geometry.coordinates as [number, number][][];
  if (geometry.type === "MultiPolygon") return geometry.coordinates[0] as [number, number][][];
  return [[]];
}

// Satellite acquisitions metadata (demo fallback; live path in
// sources-external.ts uses real Copernicus catalog search when configured)
export interface SatelliteAcquisition {
  id: string;
  sensor: "Sentinel-2" | "Sentinel-3";
  acquired: string; // ISO date
  layer: string;
  label: string;
  resolution: string;
  provenance: string;
}

// Without a real catalogue answer there are no acquisitions to list; no
// stand-in dates are shown.
export function getSatelliteAcquisitions(): SatelliteAcquisition[] {
  return [];
}
