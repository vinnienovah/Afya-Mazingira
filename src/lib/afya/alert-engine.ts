// Threshold alert evaluation
// Pure decision logic shared by the daily cron (/api/cron/check-alerts, all
// users) and the manual test-send endpoint (/api/notifications/test, one
// user), so "what counts as a trigger" is defined in exactly one place.
//
// The cron runs once a day, at 08:00 in Nairobi. Heat rules judge the
// highest WBGT the station forecast gives for the rest of the day's daylight,
// not the band three hours ahead: at 11:00 the station almost never reaches
// the HIGH band, while the afternoon peak often does. Heat rules fire on a
// rise, since the same hot afternoon told every day is no longer news:
//  - exposure_tier: the day's forecast band is HIGH or above, and higher
//    than the band of yesterday's forecast peak;
//  - state_transition: the forecast reaches the hot state's WBGT today after
//    a forecast that stayed below it yesterday;
//  - best_time: a saved plan's window, fully inside today's forecast, is now
//    in a higher band than the band saved with the plan.
// The schema has no column for yesterday's band, so the cron recomputes it by
// running the forecast from the station's record at the same hour yesterday.
// Forecast is compared with forecast: the 08:00 forecast peak runs about
// 0.9 degC below the measured peak, so against yesterday's measurements a rise
// would almost never show. When yesterday cannot be recomputed,
// last_triggered_at stands in: a heat rule does not fire two days running.
// Every rule fires at most once per Nairobi day (the cron checks
// last_triggered_at).

import type { NotificationRule, ActivityPlan } from "@/db/schema";
import type { ForecastPoint, Lang, RiskLevel, SituationResult, StateId } from "./types";
import { RISK_META, STATES, getActivityProfile, riskRank, wbgtToRisk, type ActivityProfile } from "./constants";
import { fmtTime, fmtWindow } from "./format";
import { tf } from "./i18n";
import { alignToStep, findBestTime, isDaylight, windowPoints } from "./best-time-engine";
import { SavedResultSchema } from "./activity-plan";
import stateModel from "./model/states.json";
import { escapeHtml } from "./alert-email";

export interface AlertContent {
  subject_en: string;
  subject_sw: string;
  // Email paragraphs, HTML with any user text escaped.
  lines_en: string[];
  lines_sw: string[];
  // One plain-text sentence for a push notification.
  push_en: string;
  push_sw: string;
  // The page the alert links to.
  url: string;
}

export interface AlertContext {
  now?: number;
  // The daylight peak of the forecast run at the same hour yesterday.
  yesterdayPeak?: DayPeak | null;
  // The rule owner's saved plans, for best_time rules.
  plans?: ActivityPlan[];
}

export interface DayPeak {
  time: string;
  wbgt_c: number;
}

const DAY_MS = 86400_000;
const STEP_MS = 15 * 60 * 1000;
const EAT_OFFSET_MS = 3 * 3600 * 1000;
export const RAIN_ALERT_PROBABILITY = 0.5;
// A run whose newest observation is further than this from its anchor was not
// made from that hour's data.
const MAX_OBSERVATION_AGE_MS = 3 * 3600 * 1000;

/** The Nairobi calendar date of an instant, YYYY-MM-DD. */
export function nairobiDate(ms: number): string {
  return new Date(ms + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** True when the rule already fired on the Nairobi day that contains `ms`. */
export function firedOnDay(rule: Pick<NotificationRule, "last_triggered_at">, ms: number): boolean {
  if (!rule.last_triggered_at) return false;
  return nairobiDate(new Date(rule.last_triggered_at).getTime()) === nairobiDate(ms);
}

// Forecast points for what is left of today's daylight; the latest measured
// point, up to a quarter hour old, counts as now.
function todaysDaylight(series: ForecastPoint[], nowMs: number): ForecastPoint[] {
  const today = nairobiDate(nowMs);
  return series.filter((p) => {
    const t = Date.parse(p.time);
    return t >= nowMs - STEP_MS && nairobiDate(t) === today && isDaylight(p.time);
  });
}

/** The highest WBGT in the station forecast for the rest of today's daylight. */
export function forecastDayPeak(series: ForecastPoint[], nowMs: number): DayPeak | null {
  let peak: DayPeak | null = null;
  for (const p of todaysDaylight(series, nowMs)) {
    if (!peak || p.value > peak.wbgt_c) peak = { time: p.time, wbgt_c: p.value };
  }
  return peak;
}

/**
 * Yesterday's forecast peak from a pipeline run anchored 24 hours ago, or null
 * when that run did not come from the station's record at that hour (a
 * synthetic series, a gap, or data too poor to forecast from).
 */
export function yesterdayPeakFrom(run: SituationResult, anchorMs: number): DayPeak | null {
  if (run.demo_mode || run.quality.status === "POOR") return null;
  if (Math.abs(Date.parse(run.current.time) - anchorMs) > MAX_OBSERVATION_AGE_MS) return null;
  return forecastDayPeak(run.forecast_series, anchorMs);
}

/**
 * The warmest state of the fitted state model and the WBGT at its centre. The
 * forecast gives WBGT only, so "entering the hot state" means reaching the
 * WBGT the state is centred on.
 */
function findHotState(): { id: StateId; wbgt_c: number } | null {
  const j = stateModel.features.indexOf("wet_bulb_globe_temp");
  if (j < 0 || !stateModel.centroids.length) return null;
  const centres = stateModel.centroids.map((c) => c[j] * stateModel.feature_std[j] + stateModel.feature_mean[j]);
  const id = centres.indexOf(Math.max(...centres));
  return { id: id as StateId, wbgt_c: Math.round(centres[id] * 10) / 10 };
}

export const HOT_STATE = findHotState();

const bandLabel = (level: RiskLevel, lang: Lang) => (lang === "sw" ? RISK_META[level].sw : RISK_META[level].en);
const activityLabel = (profile: ActivityProfile, lang: Lang) =>
  (lang === "sw" ? profile.label_sw : profile.label_en).toLowerCase();
const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ");

function bilingual(url: string, build: (lang: Lang) => { subject: string; lines: string[]; push: string }): AlertContent {
  const en = build("en");
  const sw = build("sw");
  return {
    subject_en: oneLine(en.subject),
    subject_sw: oneLine(sw.subject),
    lines_en: en.lines,
    lines_sw: sw.lines,
    push_en: oneLine(en.push),
    push_sw: oneLine(sw.push),
    url,
  };
}

/** Returns alert content if `rule` is triggered by `situation`, else null. */
export function evaluateRule(rule: NotificationRule, situation: SituationResult, ctx: AlertContext = {}): AlertContent | null {
  const now = ctx.now ?? Date.now();
  const activity = getActivityProfile(rule.activity_type ?? "general");
  const yesterday = ctx.yesterdayPeak ?? null;

  switch (rule.rule_type) {
    case "exposure_tier":
      return heatAlert(rule, situation, activity, now, yesterday);
    case "state_transition":
      return hotStateAlert(rule, situation, activity, now, yesterday);
    case "best_time":
      return planAlert(rule, situation, now, ctx.plans ?? []);
    case "rain":
      return rainAlert(situation);
    case "data_quality":
      return qualityAlert(situation);
    default:
      return null;
  }
}

function heatAlert(
  rule: NotificationRule, situation: SituationResult, activity: ActivityProfile, now: number, yesterday: DayPeak | null,
): AlertContent | null {
  if (situation.quality.status === "POOR") return null;
  const peak = forecastDayPeak(situation.forecast_series, now);
  if (!peak) return null;
  const band = wbgtToRisk(peak.wbgt_c, activity.wbgt_caution_offset);
  if (riskRank(band) < riskRank("HIGH")) return null;
  const before = yesterday ? wbgtToRisk(yesterday.wbgt_c, activity.wbgt_caution_offset) : null;
  if (before ? riskRank(band) <= riskRank(before) : firedOnDay(rule, now - DAY_MS)) return null;

  return bilingual("/plan", (lang) => {
    const values = {
      time: fmtTime(peak.time),
      wbgt: peak.wbgt_c.toFixed(1),
      band: bandLabel(band, lang),
      activity: activityLabel(activity, lang),
    };
    const lines = [tf(lang, "alert_heat_line", values)];
    if (yesterday && before) {
      lines.push(tf(lang, "alert_heat_yesterday", { wbgt: yesterday.wbgt_c.toFixed(1), band: bandLabel(before, lang) }));
    }
    return { subject: tf(lang, "alert_heat_subject", values), lines, push: tf(lang, "alert_heat_push", values) };
  });
}

function hotStateAlert(
  rule: NotificationRule, situation: SituationResult, activity: ActivityProfile, now: number, yesterday: DayPeak | null,
): AlertContent | null {
  const hot = HOT_STATE;
  if (!hot || situation.quality.status === "POOR" || situation.state.state_id === hot.id) return null;
  const ahead = todaysDaylight(situation.forecast_series, now);
  const entry = ahead.find((p) => p.value >= hot.wbgt_c);
  const peak = forecastDayPeak(situation.forecast_series, now);
  if (!entry || !peak) return null;
  if (yesterday ? yesterday.wbgt_c >= hot.wbgt_c : firedOnDay(rule, now - DAY_MS)) return null;

  const band = wbgtToRisk(peak.wbgt_c, activity.wbgt_caution_offset);
  return bilingual("/plan", (lang) => {
    const values = {
      state: lang === "sw" ? STATES[hot.id].name_sw : STATES[hot.id].name,
      time: fmtTime(entry.time),
      peak_time: fmtTime(peak.time),
      wbgt: peak.wbgt_c.toFixed(1),
      band: bandLabel(band, lang),
      activity: activityLabel(activity, lang),
    };
    const lines = [tf(lang, "alert_state_line", values)];
    if (yesterday) lines.push(tf(lang, "alert_state_yesterday", { wbgt: yesterday.wbgt_c.toFixed(1) }));
    return { subject: tf(lang, "alert_state_subject", values), lines, push: tf(lang, "alert_state_push", values) };
  });
}

export interface PlanImpact {
  plan: ActivityPlan;
  // The window saved with the plan and its band then.
  window: { start: string; end: string };
  planned: RiskLevel;
  band: RiskLevel;
  peak: DayPeak;
  // The coolest window left in the plan's range, when it is in a lower band.
  better: { start: string; end: string; risk: RiskLevel } | null;
}

/**
 * A saved plan whose window, later today and fully inside the station
 * forecast, is now in a higher band for its activity than the band it was
 * saved with. Null otherwise, including for plans saved before bands were
 * stored, which have nothing to compare with.
 */
export function checkPlanImpact(plan: ActivityPlan, situation: SituationResult, now = Date.now()): PlanImpact | null {
  if (situation.quality.status === "POOR") return null;
  const saved = SavedResultSchema.safeParse(plan.last_result);
  if (!saved.success) return null;
  const { start, end, risk: planned } = saved.data.recommended;
  if (!planned) return null;
  const endMs = Date.parse(end);
  if (endMs <= now || nairobiDate(Date.parse(start)) !== nairobiDate(now)) return null;

  const points = windowPoints(situation.forecast_series, Math.max(Date.parse(start), alignToStep(now)), endMs);
  if (!points) return null;
  const top = points.reduce((a, b) => (b.value > a.value ? b : a));
  const band = wbgtToRisk(top.value, getActivityProfile(plan.activity_type).wbgt_caution_offset);
  if (riskRank(band) <= riskRank(planned)) return null;

  const fresh = findBestTime(
    plan.activity_type, plan.duration_minutes, plan.available_start, plan.available_end,
    situation.forecast_series, situation.quality, { nowIso: new Date(now).toISOString() },
  );
  const better = fresh && riskRank(fresh.recommended.risk) < riskRank(band)
    ? { start: fresh.recommended.start, end: fresh.recommended.end, risk: fresh.recommended.risk }
    : null;
  return { plan, window: { start, end }, planned, band, peak: { time: top.time, wbgt_c: top.value }, better };
}

// A best-time rule watches its owner's saved plans: all of them for a
// general rule, otherwise the plans of the rule's activity. Each plan is
// judged with its own activity's bands.
function planAlert(rule: NotificationRule, situation: SituationResult, now: number, plans: ActivityPlan[]): AlertContent | null {
  const watched = plans.filter((p) => !rule.activity_type || rule.activity_type === "general" || p.activity_type === rule.activity_type);
  const impacts = watched
    .map((p) => checkPlanImpact(p, situation, now))
    .filter((i): i is PlanImpact => i !== null);
  if (!impacts.length) return null;

  return bilingual("/plan", (lang) => {
    const describe = (i: PlanImpact) => ({
      name: i.plan.name,
      window: fmtWindow(i.window.start, i.window.end),
      planned: bandLabel(i.planned, lang),
      band: bandLabel(i.band, lang),
      activity: activityLabel(getActivityProfile(i.plan.activity_type), lang),
      wbgt: i.peak.wbgt_c.toFixed(1),
      time: fmtTime(i.peak.time),
    });
    const lines: string[] = [];
    for (const i of impacts) {
      const values = describe(i);
      lines.push(tf(lang, "alert_plan_line", { ...values, name: escapeHtml(values.name) }));
      lines.push(i.better
        ? tf(lang, "alert_plan_better", { window: fmtWindow(i.better.start, i.better.end), band: bandLabel(i.better.risk, lang) })
        : tf(lang, "alert_plan_no_better", {}));
    }
    const first = describe(impacts[0]);
    const subject = impacts.length === 1
      ? tf(lang, "alert_plan_subject_one", first)
      : tf(lang, "alert_plan_subject_many", { count: impacts.length });
    return { subject, lines, push: tf(lang, "alert_plan_push", first) };
  });
}

function rainAlert(situation: SituationResult): AlertContent | null {
  if (situation.risk.rain_probability < RAIN_ALERT_PROBABILITY) return null;
  const pct = Math.round(situation.risk.rain_probability * 100);
  return bilingual("/notifications", (lang) => ({
    subject: tf(lang, "alert_rain_subject", {}),
    lines: [tf(lang, "alert_rain_line", { pct })],
    push: tf(lang, "alert_rain_push", { pct }),
  }));
}

function qualityAlert(situation: SituationResult): AlertContent | null {
  if (situation.quality.status !== "POOR") return null;
  const time = fmtTime(situation.quality.updated_at);
  return bilingual("/notifications", (lang) => ({
    subject: tf(lang, "alert_quality_subject", {}),
    lines: [tf(lang, "alert_quality_line", {}), tf(lang, "alert_quality_last", { time })],
    push: `${tf(lang, "alert_quality_subject", {})}. ${tf(lang, "alert_quality_last", { time })}`,
  }));
}

export function pickSubject(content: AlertContent, lang: Lang): string {
  return lang === "sw" ? content.subject_sw : content.subject_en;
}
export function pickLines(content: AlertContent, lang: Lang): string[] {
  return lang === "sw" ? content.lines_sw : content.lines_en;
}
export function pickPush(content: AlertContent, lang: Lang): string {
  return lang === "sw" ? content.push_sw : content.push_en;
}
