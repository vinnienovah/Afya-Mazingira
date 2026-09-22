import type { BestTimeResult, BestWindow, DataQuality, ForecastPoint, RiskLevel } from "./types";
import { JKUAT_COORDS, getActivityProfile, riskRank, wbgtToRisk } from "./constants";

// Best-Time Engine
// Deterministic sliding-window algorithm.
// The LLM NEVER selects the window, this function does.
// Lexicographic ranking per spec section 30.

const STEP_MINUTES = 15;
const STEP_MS = STEP_MINUTES * 60 * 1000;

/** Below this chance of rain a window is called dry. */
export const LOW_RAIN_PROBABILITY = 0.2;
// A window is only said to lower exposure when its peak is at least this much
// below the hottest window on offer: smaller gaps are inside the forecast error.
const LOWER_EXPOSURE_MARGIN_C = 0.5;
const UNCERTAINTY_OK_WIDTH_C = 2.5;

const EAT_OFFSET_MS = 3 * 3600 * 1000;
const RAD = Math.PI / 180;

export interface SunTimes {
  sunrise: number; // epoch ms
  solarNoon: number;
  sunset: number;
}

/**
 * Sunrise, solar noon and sunset at the station on the Nairobi day that
 * contains `ms`, after NOAA's general solar position approximation (zenith
 * 90.833 degrees, which allows for refraction and the sun's radius).
 */
export function sunTimes(ms: number): SunTimes {
  const local = new Date(ms + EAT_OFFSET_MS);
  const year = local.getUTCFullYear();
  const dayStart = Date.UTC(year, local.getUTCMonth(), local.getUTCDate());
  const dayOfYear = Math.round((dayStart - Date.UTC(year, 0, 1)) / 86400_000) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);

  const eqTimeMin =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const lat = JKUAT_COORDS.lat * RAD;
  const hourAngleDeg =
    Math.acos(Math.cos(90.833 * RAD) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl)) / RAD;

  // Minutes after 00:00 UTC; at 37 degrees east all three fall on the same UTC day.
  const noonMin = 720 - 4 * JKUAT_COORDS.lng - eqTimeMin;
  return {
    sunrise: dayStart + (noonMin - 4 * hourAngleDeg) * 60_000,
    solarNoon: dayStart + noonMin * 60_000,
    sunset: dayStart + (noonMin + 4 * hourAngleDeg) * 60_000,
  };
}

function isDaylightMs(ms: number): boolean {
  const sun = sunTimes(ms);
  return ms >= sun.sunrise && ms <= sun.sunset;
}

/** True between sunrise and sunset at the station. */
export function isDaylight(iso: string): boolean {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && isDaylightMs(ms);
}

/** The next quarter hour on the clock at or after `ms`. */
export function alignToStep(ms: number): number {
  return Math.ceil(ms / STEP_MS) * STEP_MS;
}

/** Spacing of a forecast series: 15 minutes for the station's, an hour for the regional one. */
function seriesStepMs(series: ForecastPoint[]): number {
  let step = Infinity;
  for (let i = 1; i < series.length; i++) {
    const gap = Date.parse(series[i].time) - Date.parse(series[i - 1].time);
    if (gap > 0 && gap < step) step = gap;
  }
  return Number.isFinite(step) ? step : STEP_MS;
}

/**
 * The points of a time-ordered forecast that cover [startMs, endMs) with no
 * gap, each point standing for the `stepMs` after it; null when any part of
 * the window is not forecast.
 */
export function windowPoints(
  series: ForecastPoint[],
  startMs: number,
  endMs: number,
  stepMs = seriesStepMs(series),
): ForecastPoint[] | null {
  const inside = series.filter((p) => {
    const t = Date.parse(p.time);
    return t < endMs && t + stepMs > startMs;
  });
  let reach = startMs;
  for (const p of inside) {
    const t = Date.parse(p.time);
    if (t > reach) return null;
    reach = Math.max(reach, t + stepMs);
  }
  return inside.length && reach >= endMs ? inside : null;
}

export interface BestTimeOptions {
  /** No window starts before this; it is rounded up to the next quarter hour. */
  nowIso?: string;
  /** Chance of rain, 0 to 1: one value for the whole range, or one per forecast time. */
  rainProbability?: number | ((iso: string) => number);
  /** Keep every window between sunrise and sunset. On by default: all activity profiles are outdoors. */
  daylightOnly?: boolean;
}

/** A recommended window with the forecast peak it was judged on and the activity's band for it. */
export interface JudgedWindow extends BestWindow {
  peak_wbgt_c: number;
  risk: RiskLevel;
}

/** How the recommended window was covered: every point inside it, all present. */
export interface WindowCoverage {
  points: number;
  step_minutes: number;
  forecast_from: string;
  forecast_to: string;
}

export interface BestTimeDetail extends BestTimeResult {
  recommended: JudgedWindow;
  coverage: WindowCoverage;
}

interface Candidate {
  startMs: number;
  endMs: number;
  risk: RiskLevel;
  riskRank: number;
  peak: number;
  mean: number;
  rain: number | null;
  uncertainty: number;
  points: ForecastPoint[];
}

/**
 * Find the best available time window for an activity: every quarter-hour
 * start from the later of the range start and now, keeping only windows the
 * forecast covers in full (and, by default, that lie in daylight).
 *
 * @param quality  Station data quality, or null for a forecast the station
 *                 did not produce (the regional model), which never earns
 *                 the data-quality reason.
 */
export function findBestTime(
  activityKey: string,
  durationMinutes: number,
  windowStartIso: string,
  windowEndIso: string,
  forecastSeries: ForecastPoint[],
  quality: DataQuality | null,
  options: BestTimeOptions = {},
): BestTimeDetail | null {
  if (quality?.status === "POOR") return null; // never recommend when data is poor
  if (!forecastSeries.length) return null;

  const offset = getActivityProfile(activityKey).wbgt_caution_offset;
  const series = [...forecastSeries].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const stepMs = seriesStepMs(series);
  const daylightOnly = options.daylightOnly ?? true;
  const rain = options.rainProbability;
  const rainAt = typeof rain === "number" ? () => rain : rain;

  const winEnd = Date.parse(windowEndIso);
  const nowMs = options.nowIso ? Date.parse(options.nowIso) : -Infinity;
  const firstStart = alignToStep(Math.max(Date.parse(windowStartIso), nowMs));
  const durationMs = durationMinutes * 60 * 1000;
  if (!Number.isFinite(firstStart) || !Number.isFinite(winEnd)) return null;

  const candidates: Candidate[] = [];
  for (let startMs = firstStart; startMs + durationMs <= winEnd; startMs += STEP_MS) {
    const endMs = startMs + durationMs;
    if (daylightOnly && !(isDaylightMs(startMs) && isDaylightMs(endMs))) continue;
    const points = windowPoints(series, startMs, endMs, stepMs);
    if (!points) continue;

    const values = points.map((p) => p.value);
    const peak = Math.max(...values);
    const risk = wbgtToRisk(peak, offset);
    candidates.push({
      startMs,
      endMs,
      risk,
      riskRank: riskRank(risk),
      peak,
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      rain: rainAt ? Math.max(...points.map((p) => rainAt(p.time))) : null,
      uncertainty: points.reduce((a, p) => a + (p.upper - p.lower), 0) / points.length,
      points,
    });
  }
  if (!candidates.length) return null;

  // Lexicographic ranking:
  // 1. avoid worse risk categories
  // 2. minimize peak exposure
  // 3. minimize rain probability
  // 4. minimize uncertainty width
  // 5. minimize mean exposure (tie-breaker)
  const ranked = [...candidates].sort((a, b) => {
    if (a.riskRank !== b.riskRank) return a.riskRank - b.riskRank;
    if (Math.abs(a.peak - b.peak) > 0.05) return a.peak - b.peak;
    const rainA = a.rain ?? 0;
    const rainB = b.rain ?? 0;
    if (Math.abs(rainA - rainB) > 0.01) return rainA - rainB;
    if (Math.abs(a.uncertainty - b.uncertainty) > 0.1) return a.uncertainty - b.uncertainty;
    return a.mean - b.mean;
  });
  const best = ranked[0];

  // Alternative: second-best window that does not overlap the best, else any other.
  const alt =
    ranked.find((c) => c !== best && (c.endMs <= best.startMs || c.startMs >= best.endMs)) ??
    ranked.find((c) => c !== best);

  const lastPoint = Date.parse(series[series.length - 1].time);
  return {
    recommended: {
      start: iso(best.startMs),
      end: iso(best.endMs),
      reasons: reasonsFor(best, candidates, quality),
      peak_wbgt_c: best.peak,
      risk: best.risk,
    },
    alternative: alt ? { start: iso(alt.startMs), end: iso(alt.endMs) } : null,
    activity: activityKey,
    duration_minutes: durationMinutes,
    coverage: {
      points: best.points.length,
      step_minutes: Math.round(stepMs / 60_000),
      forecast_from: iso(Date.parse(series[0].time)),
      forecast_to: iso(lastPoint + stepMs),
    },
  };
}

// Only reasons that hold for this window.
function reasonsFor(best: Candidate, all: Candidate[], quality: DataQuality | null): string[] {
  const reasons: string[] = [];
  const hottest = Math.max(...all.map((c) => c.peak));
  if (best.peak <= hottest - LOWER_EXPOSURE_MARGIN_C) reasons.push("reason_lower_exposure");
  // After solar noon the sun is sinking for the whole window.
  if (best.startMs >= sunTimes(best.startMs).solarNoon) reasons.push("reason_radiation_declining");
  if (best.rain !== null && best.rain < LOW_RAIN_PROBABILITY) reasons.push("reason_low_rain");
  if (best.uncertainty < UNCERTAINTY_OK_WIDTH_C) reasons.push("reason_uncertainty_ok");
  if (quality?.status === "GOOD") reasons.push("reason_quality_good");
  return reasons;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Quick best-time from current forecast candidates.
 */
export function findBestWindowFromNow(
  forecastSeries: ForecastPoint[],
  activityKey: string,
  durationMinutes: number,
  availableHours: number,
  quality: DataQuality | null,
  startIso?: string,
  options: BestTimeOptions = {},
): BestTimeDetail | null {
  if (!forecastSeries.length) return null;
  const seriesStart = forecastSeries[0].time;
  // Clamp the window start to the effective "now" so a stale forecast never
  // recommends a window that has already elapsed.
  const start =
    startIso && new Date(startIso).getTime() > new Date(seriesStart).getTime()
      ? startIso
      : seriesStart;
  const end = new Date(new Date(start).getTime() + availableHours * 3600 * 1000).toISOString();
  return findBestTime(activityKey, durationMinutes, start, end, forecastSeries, quality, { nowIso: start, ...options });
}
