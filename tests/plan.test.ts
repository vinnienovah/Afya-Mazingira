import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  checkPlanWindow, forecastReach, planActivity, PlanCreateSchema, PlanUpdateSchema, SavedResultSchema,
  type PlanForecasts,
} from "../src/lib/afya/activity-plan";
import { isDaylight } from "../src/lib/afya/best-time-engine";
import type { DataQuality, ForecastPoint } from "../src/lib/afya/types";

const HOUR = 3600_000;
// EAT clock time on 22 September 2026 (day 0) or a later day.
const eat = (hhmm: string, day = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 8, 22 + day, h - 3, m);
};
const iso = (ms: number) => new Date(ms).toISOString();

const GOOD: DataQuality = { status: "GOOD", freshness_minutes: 5, flags: [], updated_at: iso(eat("12:00")) };

// A station forecast issued at `from`: nine hours, every 15 minutes, warmest at 14:00.
function station(from: number): ForecastPoint[] {
  return Array.from({ length: 37 }, (_, i) => {
    const t = from + i * 900_000;
    const hour = new Date(t + 3 * HOUR).getUTCHours() + new Date(t).getUTCMinutes() / 60;
    const value = Math.round((22 - Math.abs(hour - 14) * 0.8) * 10) / 10;
    return { time: iso(t), value, lower: value - 1, upper: value + 1, horizon_minutes: i * 15 };
  });
}

// The regional model: hourly from 03:00 EAT today for three days, as Open-Meteo
// gives it, with times written without seconds ("2026-09-22T00:00Z").
function regional(): { time: string; wbgt_like: number }[] {
  return Array.from({ length: 72 }, (_, i) => {
    const t = eat("03:00") + i * HOUR;
    const hour = (new Date(t + 3 * HOUR).getUTCHours());
    return { time: `${iso(t).slice(0, 16)}Z`, wbgt_like: Math.round((21 - Math.abs(hour - 14) * 0.7) * 10) / 10 };
  });
}

function forecasts(nowMs: number, quality = GOOD): PlanForecasts {
  const from = nowMs - (nowMs % 900_000);
  return { station: station(from), quality, rain: { probability: 0.1, at: iso(from) }, regional: regional() };
}

const request = (start: number, end: number, duration = 60, activity = "outdoor_work") => ({
  activity, duration_minutes: duration, window_start: iso(start), window_end: iso(end),
});

test("a window that has already ended is refused with a 400", () => {
  const now = eat("12:03");
  const failure = checkPlanWindow(request(eat("08:00"), eat("11:00")), now);
  assert.equal(failure?.status, 400);
  assert.equal(failure?.error, "window_past");
  const outcome = planActivity(request(eat("08:00"), eat("11:00")), forecasts(now), now);
  assert.equal(outcome.ok, false);
});

test("a window that has begun is searched from the next quarter hour, and says so", () => {
  const now = eat("12:01");
  const outcome = planActivity(request(eat("09:00"), eat("16:00")), forecasts(now), now);
  assert.ok(outcome.ok);
  assert.ok(Date.parse(outcome.result.recommended.start) >= eat("12:15"));
  assert.equal(outcome.result.searched_from, iso(eat("12:15")));
  assert.equal(outcome.result.source, "station");
});

test("too little left of a window for the activity is a 400, not an old slot", () => {
  const now = eat("12:01");
  const failure = checkPlanWindow(request(eat("09:00"), eat("13:00"), 90), now);
  assert.equal(failure?.error, "window_mostly_past");
  assert.equal(failure?.details?.from, iso(eat("12:15")));
});

test("the station forecast answers what it covers; tomorrow goes to the regional model", () => {
  const now = eat("08:00");
  const today = planActivity(request(eat("08:00"), eat("16:00"), 120, "sports"), forecasts(now), now);
  assert.ok(today.ok);
  assert.equal(today.result.source, "station");
  assert.equal(today.result.coverage.points, 8);
  assert.ok(today.result.recommended.reasons.includes("reason_quality_good"));

  const tomorrow = planActivity(request(eat("08:00", 1), eat("18:00", 1), 120, "sports"), forecasts(now), now);
  assert.ok(tomorrow.ok);
  assert.equal(tomorrow.result.source, "regional");
  assert.equal(tomorrow.result.coverage.step_minutes, 60);
  // The regional model is not the station: no data-quality reason, no rain claim.
  assert.ok(!tomorrow.result.recommended.reasons.includes("reason_quality_good"));
  assert.ok(!tomorrow.result.recommended.reasons.includes("reason_low_rain"));
  // And a plan saved with it passes the saved-result check.
  assert.ok(SavedResultSchema.safeParse(JSON.parse(JSON.stringify(tomorrow.result))).success);
});

test("the station's rain chance is only claimed for the hours it covers", () => {
  const now = eat("08:00");
  const soon = planActivity(request(eat("08:00"), eat("10:00")), forecasts(now), now);
  assert.ok(soon.ok);
  assert.equal(soon.result.source, "station");
  assert.ok(soon.result.recommended.reasons.includes("reason_low_rain"));

  // Still the station's own forecast, but hours past the rain model's reach.
  const later = planActivity(request(eat("13:00"), eat("15:00")), forecasts(now), now);
  assert.ok(later.ok);
  assert.equal(later.result.source, "station");
  assert.ok(!later.result.recommended.reasons.includes("reason_low_rain"));
});

test("the regional fallback never offers the hours of today that have passed", () => {
  const now = eat("12:03");
  const poor = { ...GOOD, status: "POOR" as const };
  const outcome = planActivity(request(eat("06:30"), eat("18:00"), 90), forecasts(now, poor), now);
  assert.ok(outcome.ok);
  assert.equal(outcome.result.source, "regional");
  assert.ok(Date.parse(outcome.result.recommended.start) >= eat("12:15"));
});

test("a window is never offered past the end of every forecast, and the refusal says where it ends", () => {
  // The regional model runs from 03:00 EAT on day 0 and ends 72 hours later,
  // at 03:00 EAT on day 3: day 2 is reachable, day 3 is not.
  const now = eat("08:00");
  assert.equal(forecastReach(forecasts(now), now), eat("03:00", 3));

  const dayTwo = planActivity(request(eat("08:00", 2), eat("18:00", 2), 120), forecasts(now), now);
  assert.ok(dayTwo.ok);
  assert.equal(dayTwo.result.source, "regional");

  const outcome = planActivity(request(eat("08:00", 3), eat("18:00", 3), 120), forecasts(now), now);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.error, "beyond_forecast");
  assert.equal(outcome.ok === false && outcome.details?.reach, iso(eat("03:00", 3)));
});

test("without a regional outlook the limit follows the station's own nine hours", () => {
  const now = eat("08:00");
  const stationOnly = { ...forecasts(now), regional: [] };
  assert.equal(forecastReach(stationOnly, now), eat("08:00") + 9 * HOUR + 900_000);
  const outcome = planActivity(request(eat("08:00", 1), eat("18:00", 1), 120), stationOnly, now);
  assert.equal(outcome.ok === false && outcome.error, "beyond_forecast");
});

test("after dark there is no outdoor window to offer", () => {
  const now = eat("08:00");
  const outcome = planActivity(request(eat("19:00"), eat("22:00")), forecasts(now), now);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.error, "no_daylight_window");
  const evening = planActivity(request(eat("16:00"), eat("22:00"), 120), forecasts(eat("15:30")), eat("15:30"));
  assert.ok(evening.ok);
  assert.ok(isDaylight(evening.result.recommended.end));
});

test("plan bodies are checked: known activities, real times, a range that fits the activity", () => {
  const base = {
    name: "Weeding", activity_type: "field_work", duration_minutes: 90,
    available_start: iso(eat("08:00")), available_end: iso(eat("12:00")),
  };
  assert.ok(PlanCreateSchema.safeParse(base).success);
  assert.equal(PlanCreateSchema.safeParse({ ...base, activity_type: "paragliding" }).success, false);
  assert.equal(PlanCreateSchema.safeParse({ ...base, available_start: "2026-02-30T05:00:00Z" }).success, false);
  assert.equal(PlanCreateSchema.safeParse({ ...base, available_end: iso(eat("07:00")) }).success, false);
  assert.equal(PlanCreateSchema.safeParse({ ...base, available_end: iso(eat("09:00")) }).success, false);
  assert.equal(PlanCreateSchema.safeParse({ ...base, last_result: { recommended: "09:00" } }).success, false);
  assert.ok(PlanUpdateSchema.safeParse({ name: "Weeding, north field" }).success);
});

test("a saved result keeps its band and coverage, and unknown fields are dropped", () => {
  const now = eat("08:00");
  const outcome = planActivity(request(eat("08:00"), eat("16:00")), forecasts(now), now);
  assert.ok(outcome.ok);
  const stored = JSON.parse(JSON.stringify({ ...outcome.result, injected: "<script>" }));
  const parsed = SavedResultSchema.parse(stored);
  assert.equal(parsed.recommended.risk, outcome.result.recommended.risk);
  assert.equal(parsed.coverage?.points, outcome.result.coverage.points);
  assert.equal("injected" in parsed, false);
});

async function recommend(body: string) {
  const { POST } = await import("../src/app/api/recommendations/route");
  const res = await POST(new NextRequest("http://localhost/api/recommendations", {
    method: "POST", body, headers: { "content-type": "application/json" },
  }));
  return { status: res.status, data: await res.json() };
}

test("the recommendations endpoint answers bad requests with a 400 before any forecast runs", async () => {
  assert.equal((await recommend("{not json")).status, 400);
  const ok = { activity: "sports", duration_minutes: 60 };
  const later = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
  const unknown = await recommend(JSON.stringify({ ...ok, activity: "flying", window_start: later(1), window_end: later(5) }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.error, "invalid_input");
  const nonsense = await recommend(JSON.stringify({ ...ok, window_start: "2026-13-45T99:00:00Z", window_end: later(5) }));
  assert.equal(nonsense.status, 400);
  const past = await recommend(JSON.stringify({ ...ok, window_start: later(-30), window_end: later(-26) }));
  assert.equal(past.status, 400);
  assert.equal(past.data.error, "window_past");
  const backwards = await recommend(JSON.stringify({ ...ok, window_start: later(5), window_end: later(1) }));
  assert.equal(backwards.status, 400);
  assert.equal(backwards.data.error, "window_order");
});
