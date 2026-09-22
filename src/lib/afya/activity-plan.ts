import { z } from "zod";
import type { DataQuality, ForecastPoint } from "./types";
import { ACTIVITY_PROFILES } from "./constants";
import { alignToStep, findBestTime, isDaylight, sunTimes, type BestTimeDetail } from "./best-time-engine";

// Activity planning for the Plan page and saved plans: what a request may ask
// for, and which forecast answers it. The station's own forecast comes first;
// the regional model answers only what the station forecast cannot reach.

const ACTIVITY_KEYS = ACTIVITY_PROFILES.map((p) => p.key) as [string, ...string[]];
export const ActivityKeySchema = z.enum(ACTIVITY_KEYS);

const IsoDateTime = z.iso.datetime({ offset: true });
const Duration = z.number().int().min(5).max(480);

// The regional forecast runs three days ahead, so nothing is planned past it.
export const PLAN_MAX_AHEAD_HOURS = 72;
const MAX_RANGE_HOURS = 24;

export const RecommendationRequestSchema = z.object({
  activity: ActivityKeySchema,
  duration_minutes: Duration,
  window_start: IsoDateTime,
  window_end: IsoDateTime,
});
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

const WindowSchema = z.object({ start: IsoDateTime, end: IsoDateTime });

/** A recommendation as saved with a plan. Older plans lack the band and coverage. */
export const SavedResultSchema = z.object({
  recommended: WindowSchema.extend({
    reasons: z.array(z.string()),
    peak_wbgt_c: z.number().optional(),
    risk: z.enum(["LOW", "ELEVATED", "HIGH", "VERY_HIGH"]).optional(),
  }),
  alternative: WindowSchema.nullable(),
  activity: z.string(),
  duration_minutes: z.number(),
  source: z.enum(["station", "regional"]).optional(),
  coverage: z.object({
    points: z.number(),
    step_minutes: z.number(),
    forecast_from: IsoDateTime,
    forecast_to: IsoDateTime,
  }).optional(),
  searched_from: IsoDateTime.nullable().optional(),
});
export type SavedResult = z.infer<typeof SavedResultSchema>;

const PlanFields = z.object({
  name: z.string().trim().min(1).max(200),
  activity_type: ActivityKeySchema,
  activity_label: z.string().max(200).optional(),
  duration_minutes: Duration,
  available_start: IsoDateTime,
  available_end: IsoDateTime,
  preferred_start: IsoDateTime.nullable().optional(),
  last_result: SavedResultSchema.nullable().optional(),
});

type RangeFields = { available_start?: string; available_end?: string; duration_minutes?: number };

function checkRange(v: RangeFields, ctx: z.RefinementCtx) {
  if (!v.available_start || !v.available_end) return;
  const problem = rangeProblem(Date.parse(v.available_start), Date.parse(v.available_end), v.duration_minutes);
  if (problem) ctx.addIssue({ code: "custom", path: ["available_end"], message: problem.message });
}

export const PlanCreateSchema = PlanFields.superRefine(checkRange);
export const PlanUpdateSchema = PlanFields.partial().superRefine(checkRange);

export type PlanErrorCode =
  | "window_order"
  | "window_too_long"
  | "window_too_short"
  | "window_past"
  | "window_mostly_past"
  | "beyond_forecast"
  | "no_daylight_window"
  | "no_window"
  | "quality_poor";

export interface PlanFailure {
  ok: false;
  status: 400 | 404 | 503;
  error: PlanErrorCode;
  message: string;
  // Times the message refers to, for the page to show in its own language.
  details?: Record<string, string>;
}

/** The recommended window, which forecast judged it, and where the search began when the range had already started. */
export interface PlannedWindow extends BestTimeDetail {
  source: "station" | "regional";
  searched_from: string | null;
}

export type PlanOutcome = { ok: true; result: PlannedWindow } | PlanFailure;

export interface PlanForecasts {
  station: ForecastPoint[];
  quality: DataQuality;
  // The station's chance of rain over the next hours, 0 to 1.
  rainProbability: number;
  regional: { time: string; wbgt_like: number }[];
}

const iso = (ms: number) => new Date(ms).toISOString();

function fail(status: PlanFailure["status"], error: PlanErrorCode, message: string, details?: Record<string, string>): PlanFailure {
  return { ok: false, status, error, message, details };
}

/** What is wrong with an available range on its own, before the clock is considered. */
export function rangeProblem(startMs: number, endMs: number, durationMinutes?: number): PlanFailure | null {
  if (endMs <= startMs) return fail(400, "window_order", "The end of the available time must be after its start.");
  if (endMs - startMs > MAX_RANGE_HOURS * 3600_000) {
    return fail(400, "window_too_long", `The available time can span at most ${MAX_RANGE_HOURS} hours.`);
  }
  if (durationMinutes !== undefined && endMs - startMs < durationMinutes * 60_000) {
    return fail(400, "window_too_short", "The available time is shorter than the activity.");
  }
  return null;
}

/**
 * Checks a request against the clock: a range that has ended, or has too little
 * left of it, or starts beyond the forecasts, is refused before any forecast
 * is run. Null when it can be planned.
 */
export function checkPlanWindow(req: RecommendationRequest, nowMs: number): PlanFailure | null {
  const startMs = Date.parse(req.window_start);
  const endMs = Date.parse(req.window_end);
  const range = rangeProblem(startMs, endMs, req.duration_minutes);
  if (range) return range;

  if (endMs <= nowMs) {
    return fail(400, "window_past", "That time has already passed. Choose a window later today or tomorrow.", {
      end: iso(endMs),
    });
  }
  const from = alignToStep(Math.max(startMs, nowMs));
  if (endMs - from < req.duration_minutes * 60_000) {
    return fail(400, "window_mostly_past", "Too little of that window is left for the activity.", {
      from: iso(from),
      end: iso(endMs),
    });
  }
  if (startMs - nowMs > PLAN_MAX_AHEAD_HOURS * 3600_000) {
    return fail(400, "beyond_forecast", `No forecast reaches that far; plans can start up to ${PLAN_MAX_AHEAD_HOURS / 24} days ahead.`);
  }
  return null;
}

/**
 * The regional model as a forecast series. Its band is ±2 °C, wider than the
 * station model's, because a grid-cell estimate stands in for the station
 * here. The width is a judgement, not fitted.
 */
export function regionalSeries(points: { time: string; wbgt_like: number }[], nowMs: number): ForecastPoint[] {
  return points.map((p) => ({
    time: p.time,
    value: p.wbgt_like,
    lower: p.wbgt_like - 2,
    upper: p.wbgt_like + 2,
    horizon_minutes: Math.max(0, Math.round((Date.parse(p.time) - nowMs) / 60_000)),
  }));
}

function daylightRoom(fromMs: number, endMs: number, durationMs: number): boolean {
  for (let s = fromMs; s + durationMs <= endMs; s += 15 * 60_000) {
    if (isDaylight(iso(s)) && isDaylight(iso(s + durationMs))) return true;
  }
  return false;
}

/**
 * The best window for a request: from the station forecast when it covers a
 * whole window in the range, otherwise from the regional model. Only windows
 * that start from now on, lie in daylight and have every forecast point are
 * considered.
 */
export function planActivity(req: RecommendationRequest, forecasts: PlanForecasts, nowMs: number): PlanOutcome {
  const early = checkPlanWindow(req, nowMs);
  if (early) return early;

  const startMs = Date.parse(req.window_start);
  const endMs = Date.parse(req.window_end);
  const from = alignToStep(Math.max(startMs, nowMs));
  const searched_from = from > alignToStep(startMs) ? iso(from) : null;
  const nowIso = iso(nowMs);

  if (forecasts.quality.status !== "POOR") {
    const station = findBestTime(
      req.activity, req.duration_minutes, req.window_start, req.window_end,
      forecasts.station, forecasts.quality,
      { nowIso, rainProbability: forecasts.rainProbability },
    );
    if (station) return { ok: true, result: { ...station, source: "station", searched_from } };
  }

  // The station's rain chance is for the next few hours only, so a regional
  // window is judged without one rather than borrowing it.
  const regional = findBestTime(
    req.activity, req.duration_minutes, req.window_start, req.window_end,
    regionalSeries(forecasts.regional, nowMs), null,
    { nowIso },
  );
  if (regional) return { ok: true, result: { ...regional, source: "regional", searched_from } };

  if (!daylightRoom(from, endMs, req.duration_minutes * 60_000)) {
    const sun = sunTimes(Math.max(from, startMs));
    return fail(404, "no_daylight_window", "Outdoor activities are only planned between sunrise and sunset, and no daylight window of that length is left in the range.", {
      sunrise: iso(sun.sunrise),
      sunset: iso(sun.sunset),
    });
  }
  if (forecasts.quality.status === "POOR" && !forecasts.regional.length) {
    return fail(503, "quality_poor", "AFYA MAZINGIRA cannot make a high-confidence recommendation right now.");
  }
  return fail(404, "no_window", "No forecast covers a whole window of that length in the range.");
}
