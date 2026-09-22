import type { DemoObservation } from "./demo-observations";
import type { HorizonForecast } from "./types";
import type { ReplayStep } from "./pipeline";

// Historical Replay: which days can be replayed, which frames really come from
// the station's record at their hour, and how each frame's forecast compares
// with what the station recorded afterwards.

/** The first day of the station archive. */
export const REPLAY_FIRST_DAY = "2025-06-01";

// A frame whose newest observation is older than this was not made from its
// hour's data (the data-quality limit past which the app stops advising).
const MAX_FRAME_AGE_MINUTES = 180;
const HOURS_AHEAD: Record<HorizonForecast["horizon"], number> = { "1h": 1, "3h": 3, "6h": 6, "9h": 9 };
const STEP_MS = 15 * 60 * 1000;
const EAT_OFFSET_MS = 3 * 3600 * 1000;
// Fields shade WBGT is computed from; a slot where any was filled in is not a recording.
const WBGT_INPUTS = ["temp_sht", "humidity_sht", "wet_bulb_temp"];

/** Yesterday's date in Nairobi, YYYY-MM-DD: the last day with a full record. */
export function lastReplayDay(nowMs: number): string {
  return new Date(nowMs + EAT_OFFSET_MS - 86400_000).toISOString().slice(0, 10);
}

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Null when `date` is a real calendar day from the archive's first day to yesterday. */
export function replayDateProblem(date: unknown, nowMs: number): string | null {
  if (!isCalendarDay(date)) return "Give the date as YYYY-MM-DD.";
  if (date < REPLAY_FIRST_DAY || date > lastReplayDay(nowMs)) {
    return `Choose a date from ${REPLAY_FIRST_DAY} to ${lastReplayDay(nowMs)}.`;
  }
  return null;
}

export interface HorizonCheck {
  horizon: HorizonForecast["horizon"];
  // The time the forecast was for.
  target: string;
  forecast: number;
  lower: number;
  upper: number;
  // Shade WBGT the station recorded then; null when it was not recorded.
  recorded: number | null;
  // Forecast minus recorded.
  error: number | null;
}

/** The recorded peak over a window; null unless every quarter hour of it was recorded. */
export interface WindowRecord {
  start: string;
  end: string;
  peak: number | null;
}

export interface ReplayFrame extends ReplayStep {
  // Newest observation the frame was made from.
  observed_at: string;
  // False when the frame is synthetic or its data is far older than its hour.
  available: boolean;
  checks: HorizonCheck[];
  recommended: WindowRecord | null;
  // The same length from 12:00, the fixed midday window.
  midday: WindowRecord | null;
}

export interface HorizonSummary {
  horizon: HorizonForecast["horizon"];
  n: number;
  mae: number | null;
  // Share of recorded values inside the forecast's 80 % band.
  within_band: number | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function recordedByTime(observations: DemoObservation[]): Map<number, number> {
  const byTime = new Map<number, number>();
  for (const o of observations) {
    if (WBGT_INPUTS.some((f) => o.imputed?.includes(f))) continue;
    byTime.set(Date.parse(o.ts), o.wet_bulb_globe_temp);
  }
  return byTime;
}

function windowRecord(recorded: Map<number, number>, startMs: number, endMs: number): WindowRecord {
  let peak = -Infinity;
  for (let t = startMs; t < endMs; t += STEP_MS) {
    const v = recorded.get(t);
    if (v === undefined) return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), peak: null };
    peak = Math.max(peak, v);
  }
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), peak: round1(peak) };
}

/** True when a frame was made from the station's record near its own hour. */
export function frameIsReal(step: ReplayStep): boolean {
  if (step.situation.demo_mode) return false;
  const age = Math.abs(Date.parse(step.sim_time) - Date.parse(step.situation.current.time)) / 60_000;
  return age <= MAX_FRAME_AGE_MINUTES;
}

/**
 * Each step with its forecasts set against what the station recorded 1, 3, 6
 * and 9 hours later, and its recommended window against the fixed midday
 * window of the same length, both by recorded peak.
 */
export function buildReplayFrames(steps: ReplayStep[], observations: DemoObservation[]): ReplayFrame[] {
  const recorded = recordedByTime(observations);
  return steps.map((step) => {
    const available = frameIsReal(step);
    const issued = Date.parse(step.situation.generated_at);
    const checks: HorizonCheck[] = available
      ? step.situation.forecast.map((f) => {
          const target = issued + HOURS_AHEAD[f.horizon] * 3600_000;
          const value = recorded.get(target);
          const actual = value === undefined ? null : round1(value);
          return {
            horizon: f.horizon,
            target: new Date(target).toISOString(),
            forecast: f.value,
            lower: f.lower,
            upper: f.upper,
            recorded: actual,
            error: actual === null ? null : round1(f.value - actual),
          };
        })
      : [];

    const best = available ? step.situation.best_time : null;
    let recommended: WindowRecord | null = null;
    let midday: WindowRecord | null = null;
    if (best) {
      const start = Date.parse(best.recommended.start);
      const length = Date.parse(best.recommended.end) - start;
      const localDay = Math.floor((start + EAT_OFFSET_MS) / 86400_000) * 86400_000;
      const noon = localDay + 12 * 3600_000 - EAT_OFFSET_MS;
      recommended = windowRecord(recorded, start, start + length);
      midday = windowRecord(recorded, noon, noon + length);
    }
    return { ...step, observed_at: step.situation.current.time, available, checks, recommended, midday };
  });
}

/** Mean absolute error per horizon over a day's frames. */
export function summariseHorizons(frames: ReplayFrame[]): HorizonSummary[] {
  return (Object.keys(HOURS_AHEAD) as HorizonForecast["horizon"][]).map((horizon) => {
    const checks = frames.flatMap((f) => f.checks).filter((c) => c.horizon === horizon && c.error !== null);
    if (!checks.length) return { horizon, n: 0, mae: null, within_band: null };
    const mae = checks.reduce((a, c) => a + Math.abs(c.error!), 0) / checks.length;
    const inside = checks.filter((c) => c.recorded! >= c.lower && c.recorded! <= c.upper).length;
    return { horizon, n: checks.length, mae: Math.round(mae * 100) / 100, within_band: Math.round((inside / checks.length) * 100) / 100 };
  });
}
