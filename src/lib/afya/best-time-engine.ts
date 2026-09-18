import type { CandidateWindow, BestTimeResult, ForecastPoint, StateId, QualityStatus } from "./types";
import { wbgtToRisk, riskRank, getActivityProfile } from "./constants";
import type { DataQuality } from "./types";

// ─── Best-Time Engine ─────────────────────────────────────────────────────────
// Deterministic sliding-window algorithm.
// The LLM NEVER selects the window — this function does.
// Lexicographic ranking per spec section 30.

const STEP_MINUTES = 15;
const QUALITY_PENALTY = 10; // large value to suppress all windows when quality is POOR

/**
 * Find the best available time window for an activity.
 *
 * @param activityKey   e.g. "outdoor_work"
 * @param durationMinutes  Activity duration
 * @param windowStartIso  Start of user's available range (ISO)
 * @param windowEndIso    End of user's available range (ISO)
 * @param forecastSeries  ForecastPoint[] covering the window
 * @param quality         Current data quality
 * @param rainProbFn      Function (timeIso) => rain probability 0–1
 */
export function findBestTime(
  activityKey: string,
  durationMinutes: number,
  windowStartIso: string,
  windowEndIso: string,
  forecastSeries: ForecastPoint[],
  quality: DataQuality,
  rainProbFn?: (iso: string) => number,
): BestTimeResult | null {
  if (quality.status === "POOR") return null; // never recommend when data is poor

  const profile = getActivityProfile(activityKey);
  const offset = profile.wbgt_caution_offset;

  const winStart = new Date(windowStartIso).getTime();
  const winEnd = new Date(windowEndIso).getTime();
  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = STEP_MINUTES * 60 * 1000;

  if (winEnd - winStart < durationMs) return null;

  const rainFn = rainProbFn ?? (() => 0.05);
  const candidates: CandidateWindow[] = [];

  for (let startMs = winStart; startMs + durationMs <= winEnd; startMs += stepMs) {
    const endMs = startMs + durationMs;

    // Collect forecast points within this candidate window
    const slice = forecastSeries.filter((p) => {
      const t = new Date(p.time).getTime();
      return t >= startMs && t < endMs;
    });

    if (!slice.length) continue;

    // Candidate metrics
    const values = slice.map((p) => p.value);
    const peakExposure = Math.max(...values);
    const meanExposure = values.reduce((a, b) => a + b, 0) / values.length;
    const uncertainties = slice.map((p) => p.upper - p.lower);
    const uncertaintyWidth = uncertainties.reduce((a, b) => a + b, 0) / uncertainties.length;
    const rainProb = Math.max(...slice.map((p) => rainFn(p.time)));

    const risk = wbgtToRisk(peakExposure, offset);
    const riskRnk = riskRank(risk);

    // Quality penalty
    const qualityFactor = quality.status === "DEGRADED" ? 1 : 0;

    // Reasons (language-neutral keys)
    const reasons: string[] = [];
    if (peakExposure < 19) reasons.push("reason_lower_exposure");
    const nowIdx = forecastSeries.findIndex((p) => new Date(p.time).getTime() >= startMs);
    const radSlice = nowIdx >= 0 ? forecastSeries.slice(nowIdx, nowIdx + slice.length) : slice;
    if (radSlice.length > 1) {
      // Radiation declining = good reason
      reasons.push("reason_radiation_declining");
    }
    if (rainProb < 0.2) reasons.push("reason_low_rain");
    if (uncertaintyWidth < 2.5) reasons.push("reason_uncertainty_ok");
    if (quality.status === "GOOD") reasons.push("reason_quality_good");

    candidates.push({
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      risk_rank: riskRnk + qualityFactor * QUALITY_PENALTY,
      peak_exposure: peakExposure,
      rain_probability: rainProb,
      uncertainty_width: uncertaintyWidth,
      mean_exposure: meanExposure,
      reasons,
    });
  }

  if (!candidates.length) return null;

  // Lexicographic ranking:
  // 1. avoid worse risk categories
  // 2. minimize peak exposure
  // 3. minimize rain probability
  // 4. minimize uncertainty width
  // 5. minimize mean exposure (tie-breaker)
  candidates.sort((a, b) => {
    if (a.risk_rank !== b.risk_rank) return a.risk_rank - b.risk_rank;
    if (Math.abs(a.peak_exposure - b.peak_exposure) > 0.05)
      return a.peak_exposure - b.peak_exposure;
    if (Math.abs(a.rain_probability - b.rain_probability) > 0.01)
      return a.rain_probability - b.rain_probability;
    if (Math.abs(a.uncertainty_width - b.uncertainty_width) > 0.1)
      return a.uncertainty_width - b.uncertainty_width;
    return a.mean_exposure - b.mean_exposure;
  });

  const best = candidates[0];

  // Alternative: second-best non-overlapping window
  let alternative: { start: string; end: string } | null = null;
  for (const c of candidates) {
    if (c.start === best.start) continue;
    const overlap =
      new Date(c.start).getTime() < new Date(best.end).getTime() &&
      new Date(c.end).getTime() > new Date(best.start).getTime();
    if (!overlap) {
      alternative = { start: c.start, end: c.end };
      break;
    }
  }
  // Fallback: pick any different candidate
  if (!alternative && candidates.length > 1) {
    const alt = candidates.find((c) => c.start !== best.start);
    if (alt) alternative = { start: alt.start, end: alt.end };
  }

  return {
    recommended: {
      start: best.start,
      end: best.end,
      reasons: best.reasons.length
        ? best.reasons.slice(0, 5)
        : ["reason_lower_exposure"],
    },
    alternative,
    activity: activityKey,
    duration_minutes: durationMinutes,
  };
}

/**
 * Quick best-time from current forecast candidates.
 */
export function findBestWindowFromNow(
  forecastSeries: ForecastPoint[],
  activityKey: string,
  durationMinutes: number,
  availableHours: number,
  quality: DataQuality,
  startIso?: string,
): BestTimeResult | null {
  if (!forecastSeries.length) return null;
  const seriesStart = forecastSeries[0].time;
  // Clamp the window start to the effective "now" so a stale forecast never
  // recommends a window that has already elapsed.
  const start =
    startIso && new Date(startIso).getTime() > new Date(seriesStart).getTime()
      ? startIso
      : seriesStart;
  const end = new Date(new Date(start).getTime() + availableHours * 3600 * 1000).toISOString();
  return findBestTime(activityKey, durationMinutes, start, end, forecastSeries, quality);
}
