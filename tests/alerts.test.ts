import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkPlanImpact, evaluateRule, firedOnDay, forecastDayPeak, HOT_STATE, yesterdayPeakFrom,
} from "../src/lib/afya/alert-engine";
import type { ActivityPlan, NotificationRule } from "../src/db/schema";
import type { ForecastPoint, SituationResult } from "../src/lib/afya/types";

const HOUR = 3600_000;
// EAT clock time on 22 September 2026, or a day later or earlier.
const eat = (hhmm: string, day = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 8, 22 + day, h - 3, m);
};
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = eat("08:00"); // when the daily job runs

// A station forecast from 08:00 to 17:00: ELEVATED for outdoor work at 11:00,
// HIGH at the 14:00 peak.
function forecast(peak = 22, eleven = 19.5): ForecastPoint[] {
  return Array.from({ length: 37 }, (_, i) => {
    const t = NOW + i * 900_000;
    const hour = 8 + i / 4;
    const value = hour <= 11 ? 17 + (eleven - 17) * ((hour - 8) / 3)
      : hour <= 14 ? eleven + (peak - eleven) * ((hour - 11) / 3)
      : peak - (hour - 14) * 0.8;
    const v = Math.round(value * 10) / 10;
    return { time: iso(t), value: v, lower: v - 1, upper: v + 1, horizon_minutes: i * 15 };
  });
}

function situation(overrides: Partial<SituationResult> = {}, series = forecast()): SituationResult {
  return {
    generated_at: iso(NOW),
    demo_mode: false,
    quality: { status: "GOOD", freshness_minutes: 5, flags: [], updated_at: iso(NOW) },
    current: { time: iso(NOW) },
    state: { state_id: 1, since: iso(NOW - 2 * HOUR), previous_state_id: 0, transition_likelihood: null },
    risk: { thermal: "ELEVATED", rain_probability: 0.1, uncertainty: "LOW", data_quality: "GOOD" },
    forecast_series: series,
    ...overrides,
  } as SituationResult;
}

function rule(rule_type: string, activity_type = "outdoor_work", last?: number): NotificationRule {
  return {
    id: 1, user_id: 1, name: "rule", rule_type, activity_type, enabled: true,
    last_triggered_at: last === undefined ? null : new Date(last),
    created_at: new Date(NOW - 30 * 24 * HOUR), updated_at: new Date(NOW - 30 * 24 * HOUR),
  };
}

const cooler = { time: iso(eat("13:30", -1)), wbgt_c: 20.2 };

test("a day that is ELEVATED at 11:00 but HIGH at its 14:00 peak raises a heat alert with the peak time", () => {
  const s = situation();
  assert.equal(s.forecast_series.find((p) => p.time === iso(eat("11:00")))?.value, 19.5);
  assert.deepEqual(forecastDayPeak(s.forecast_series, NOW), { time: iso(eat("14:00")), wbgt_c: 22 });
  const alert = evaluateRule(rule("exposure_tier"), s, { now: NOW, yesterdayPeak: cooler });
  assert.ok(alert);
  assert.equal(alert.subject_en, "Today's heat peak around 14:00: WBGT 22.0°C (HIGH) for outdoor work");
  assert.match(alert.subject_sw, /saa 14:00/);
  assert.match(alert.push_en, /14:00/);
  assert.doesNotMatch(alert.lines_en.join(" "), /right now/);
});

test("the peak is taken from today's daylight only", () => {
  // Points after sunset (18:27) and tomorrow do not count, however warm.
  const after = (ms: number) => ({ time: iso(ms), value: 26, lower: 25, upper: 27, horizon_minutes: 0 });
  const series = [...forecast(20, 19), after(eat("18:45")), after(eat("09:00", 1))];
  assert.equal(forecastDayPeak(series, NOW)?.wbgt_c, 20);
});

test("a heat alert needs a rise on yesterday's forecast", () => {
  const s = situation();
  assert.equal(evaluateRule(rule("exposure_tier"), s, { now: NOW, yesterdayPeak: { time: iso(eat("14:00", -1)), wbgt_c: 21.6 } }), null);
  assert.ok(evaluateRule(rule("exposure_tier"), s, { now: NOW, yesterdayPeak: cooler }));
  // Without yesterday's forecast the rule does not fire two days running.
  assert.equal(evaluateRule(rule("exposure_tier", "outdoor_work", eat("08:00", -1)), s, { now: NOW }), null);
  assert.ok(evaluateRule(rule("exposure_tier", "outdoor_work", eat("08:00", -2)), s, { now: NOW }));
});

test("the rule's activity sets the band", () => {
  // A 21.5 degC peak after an 18.5 degC day: HIGH for heavy or moderate work, not for light activity.
  const s = situation({}, forecast(21.5));
  const mild = { time: iso(eat("13:30", -1)), wbgt_c: 18.5 };
  assert.ok(evaluateRule(rule("exposure_tier", "construction"), s, { now: NOW, yesterdayPeak: mild }));
  assert.ok(evaluateRule(rule("exposure_tier", "outdoor_work"), s, { now: NOW, yesterdayPeak: mild }));
  assert.equal(evaluateRule(rule("exposure_tier", "general"), s, { now: NOW, yesterdayPeak: mild }), null);
  assert.equal(evaluateRule(rule("exposure_tier", "walking"), s, { now: NOW, yesterdayPeak: mild }), null);
});

test("heat alerts stay quiet when the station data is poor", () => {
  const poor = situation({ quality: { status: "POOR", freshness_minutes: 400, flags: [], updated_at: iso(NOW - 7 * HOUR) } });
  assert.equal(evaluateRule(rule("exposure_tier"), poor, { now: NOW, yesterdayPeak: cooler }), null);
  assert.equal(evaluateRule(rule("state_transition"), poor, { now: NOW, yesterdayPeak: cooler }), null);
  assert.ok(evaluateRule(rule("data_quality"), poor, { now: NOW }));
});

test("a rule fires at most once per Nairobi day", () => {
  assert.equal(firedOnDay(rule("rain", "general", eat("08:00")), eat("15:00")), true);
  assert.equal(firedOnDay(rule("rain", "general", eat("08:00", -1)), eat("08:00")), false);
  // 23:30 EAT and 00:30 EAT the next morning are different days, though both 21:xx UTC.
  assert.equal(firedOnDay(rule("rain", "general", eat("23:30", -1)), eat("00:30")), false);
  assert.equal(firedOnDay(rule("rain"), NOW), false);
});

test("the state alert fires only when today's forecast enters the hot state", () => {
  assert.ok(HOT_STATE && HOT_STATE.wbgt_c > 20 && HOT_STATE.wbgt_c < 23);
  const hot = HOT_STATE!.wbgt_c;
  const entering = evaluateRule(rule("state_transition"), situation({}, forecast(hot + 0.8)), { now: NOW, yesterdayPeak: cooler });
  assert.ok(entering);
  assert.match(entering.subject_en, /expected from about \d\d:\d\d today/);
  // Today stays below it.
  assert.equal(evaluateRule(rule("state_transition"), situation({}, forecast(hot - 0.5, 19)), { now: NOW, yesterdayPeak: cooler }), null);
  // Yesterday's forecast already reached it: no change of state to report.
  const hotYesterday = { time: iso(eat("14:00", -1)), wbgt_c: hot + 0.3 };
  assert.equal(evaluateRule(rule("state_transition"), situation({}, forecast(hot + 0.8)), { now: NOW, yesterdayPeak: hotYesterday }), null);
});

test("yesterday's run counts only when it came from that hour's observations", () => {
  const dayBefore = NOW - 24 * HOUR;
  const series = forecast().map((p) => ({ ...p, time: iso(Date.parse(p.time) - 24 * HOUR) }));
  const run = situation({ current: { time: iso(dayBefore - 15 * 60_000) } as SituationResult["current"] }, series);
  assert.equal(yesterdayPeakFrom(run, dayBefore)?.wbgt_c, 22);
  const stale = situation({ current: { time: iso(dayBefore - 30 * HOUR) } as SituationResult["current"] }, series);
  assert.equal(yesterdayPeakFrom(stale, dayBefore), null);
  assert.equal(yesterdayPeakFrom(situation({ demo_mode: true }, series), dayBefore), null);
});

function plan(risk: string | undefined, start = "13:00", end = "15:00", extra: Partial<ActivityPlan> = {}): ActivityPlan {
  return {
    id: 7, user_id: 1, name: "Pitch <b>practice</b>", activity_type: "sports", activity_label: null,
    duration_minutes: 120, available_start: iso(eat("09:00")), available_end: iso(eat("17:00")), preferred_start: null,
    last_result: {
      recommended: { start: iso(eat(start)), end: iso(eat(end)), reasons: [], ...(risk && { risk, peak_wbgt_c: 19 }) },
      alternative: null, activity: "sports", duration_minutes: 120,
    },
    created_at: new Date(NOW - 20 * HOUR), updated_at: new Date(NOW - 20 * HOUR),
    ...extra,
  };
}

test("a saved plan alerts only when its window is now in a higher band than when it was saved", () => {
  const s = situation();
  const impact = checkPlanImpact(plan("ELEVATED"), s, NOW);
  assert.ok(impact);
  assert.equal(impact.planned, "ELEVATED");
  assert.equal(impact.band, "HIGH"); // 22.0 degC at 14:00, for sports
  assert.equal(impact.peak.time, iso(eat("14:00")));
  assert.ok(impact.better && Date.parse(impact.better.end) <= eat("12:00"));
  assert.equal(checkPlanImpact(plan("HIGH"), s, NOW), null);
  // Saved before bands were stored: nothing to compare with.
  assert.equal(checkPlanImpact(plan(undefined), s, NOW), null);
  // A stored result of the wrong shape is ignored rather than trusted.
  assert.equal(checkPlanImpact(plan("ELEVATED", "13:00", "15:00", { last_result: { recommended: "13:00" } }), s, NOW), null);
  // Only windows the forecast covers in full are judged.
  assert.equal(checkPlanImpact(plan("LOW", "16:30", "18:30"), s, NOW), null);
});

test("the best-time rule reports hotter plans with the plan name escaped", () => {
  const s = situation();
  const alert = evaluateRule(rule("best_time", "general"), s, { now: NOW, plans: [plan("ELEVATED")] });
  assert.ok(alert);
  assert.match(alert.subject_en, /Pitch <b>practice<\/b>/);
  assert.match(alert.lines_en[0], /Pitch &#60;b&#62;practice/);
  assert.doesNotMatch(alert.lines_en.join(" "), /<b>/);
  // A rule for another activity does not watch this plan.
  assert.equal(evaluateRule(rule("best_time", "walking"), s, { now: NOW, plans: [plan("ELEVATED")] }), null);
  // Nothing changed: no alert, however many days in a row.
  assert.equal(evaluateRule(rule("best_time", "general"), s, { now: NOW, plans: [plan("HIGH")] }), null);
});

test("rain alerts speak of the next few hours, not of now", () => {
  const wet = situation({ risk: { thermal: "LOW", rain_probability: 0.6, uncertainty: "LOW", data_quality: "GOOD" } });
  const alert = evaluateRule(rule("rain", "general"), wet, { now: NOW });
  assert.ok(alert);
  assert.match(alert.lines_en[0], /60% chance of rain .* in the next few hours/);
  assert.equal(evaluateRule(rule("rain", "general"), situation(), { now: NOW }), null);
});
