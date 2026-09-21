// Threshold alert evaluation
// Pure decision logic shared by the daily cron (/api/cron/check-alerts, all
// users) and the manual test-send endpoint (/api/notifications/test, one
// user), so "what counts as a trigger" is defined in exactly one place.

import type { NotificationRule, ActivityPlan } from "@/db/schema";
import type { SituationResult, Lang, BestTimeResult } from "./types";
import { STATES, wbgtToRisk } from "./constants";
import { fmtTime, fmtWindow } from "./format";
import { findBestTime } from "./best-time-engine";

export interface AlertContent {
  subject_en: string;
  subject_sw: string;
  lines_en: string[];
  lines_sw: string[];
}

/** A rule re-fires at most once per this window, so a still-true condition
 * (e.g. quality staying POOR for days) doesn't re-email every cron run. */
export const ALERT_COOLDOWN_MS = 20 * 3600 * 1000; // ~20h, just under the daily cron cadence

export function coolingDown(rule: Pick<NotificationRule, "last_triggered_at">): boolean {
  if (!rule.last_triggered_at) return false;
  return Date.now() - new Date(rule.last_triggered_at).getTime() < ALERT_COOLDOWN_MS;
}

/** Returns alert content if `rule` is triggered by `situation` right now, else null. */
export function evaluateRule(rule: NotificationRule, situation: SituationResult): AlertContent | null {
  const stateName = STATES[situation.state.state_id].name;
  const stateNameSw = STATES[situation.state.state_id].name_sw;

  switch (rule.rule_type) {
    case "exposure_tier": {
      if (situation.risk.thermal !== "HIGH" && situation.risk.thermal !== "VERY_HIGH") return null;
      const wbgt = situation.current.wbgt_c.toFixed(1);
      return {
        subject_en: `Thermal exposure is ${situation.risk.thermal.replace("_", " ")} right now`,
        subject_sw: `Kupatwa na joto ni ${situation.risk.thermal === "HIGH" ? "JUU" : "JUU SANA"} sasa hivi`,
        lines_en: [
          `Current thermal exposure at JKUAT/Juja is <strong>${situation.risk.thermal.replace("_", " ")}</strong> (WBGT ${wbgt}°C).`,
          `Environmental state: ${stateName}.`,
        ],
        lines_sw: [
          `Kupatwa na joto kwa sasa katika JKUAT/Juja ni <strong>${situation.risk.thermal === "HIGH" ? "JUU" : "JUU SANA"}</strong> (WBGT ${wbgt}°C).`,
          `Hali ya mazingira: ${stateNameSw}.`,
        ],
      };
    }
    case "rain": {
      if (situation.risk.rain_probability < 0.5) return null;
      const pct = Math.round(situation.risk.rain_probability * 100);
      return {
        subject_en: "Higher chance of rain today",
        subject_sw: "Uwezekano mkubwa wa mvua leo",
        lines_en: [`AFYA MAZINGIRA estimates a ${pct}% chance of rain around JKUAT/Juja right now.`],
        lines_sw: [`AFYA MAZINGIRA inakadiria uwezekano wa ${pct}% wa mvua karibu na JKUAT/Juja sasa hivi.`],
      };
    }
    case "data_quality": {
      if (situation.quality.status !== "POOR") return null;
      return {
        subject_en: "Station data quality is POOR",
        subject_sw: "Ubora wa data ya kituo ni MBAYA",
        lines_en: [
          "The Conduit ground station's data quality is currently POOR, so AFYA MAZINGIRA's recommendations carry much higher uncertainty than usual.",
          `Last reliable observation: ${fmtTime(situation.quality.updated_at)}.`,
        ],
        lines_sw: [
          "Ubora wa data wa kituo cha Conduit kwa sasa ni MBAYA, hivyo mapendekezo ya AFYA MAZINGIRA yana utata mkubwa zaidi ya kawaida.",
          `Kipimo cha mwisho cha kuaminika: ${fmtTime(situation.quality.updated_at)}.`,
        ],
      };
    }
    case "state_transition": {
      const sinceMs = new Date(situation.state.since).getTime();
      if (Date.now() - sinceMs > 24 * 3600 * 1000) return null; // not a recent transition
      if (situation.state.previous_state_id === null) return null;
      const prevName = STATES[situation.state.previous_state_id].name;
      const prevNameSw = STATES[situation.state.previous_state_id].name_sw;
      return {
        subject_en: `Environmental state changed: ${prevName} → ${stateName}`,
        subject_sw: `Hali ya mazingira imebadilika: ${prevNameSw} → ${stateNameSw}`,
        lines_en: [`The environmental state at JKUAT/Juja changed from <strong>${prevName}</strong> to <strong>${stateName}</strong> at ${fmtTime(situation.state.since)}.`],
        lines_sw: [`Hali ya mazingira katika JKUAT/Juja imebadilika kutoka <strong>${prevNameSw}</strong> hadi <strong>${stateNameSw}</strong> saa ${fmtTime(situation.state.since)}.`],
      };
    }
    case "best_time": {
      if (!situation.best_time) return null;
      const win = fmtWindow(situation.best_time.recommended.start, situation.best_time.recommended.end);
      return {
        subject_en: `Best outdoor window today: ${win}`,
        subject_sw: `Dirisha bora la nje leo: ${win}`,
        lines_en: [`AFYA MAZINGIRA found a good outdoor window today: <strong>${win}</strong>.`],
        lines_sw: [`AFYA MAZINGIRA imepata dirisha zuri la nje leo: <strong>${win}</strong>.`],
      };
    }
    default:
      return null;
  }
}

/**
 * Checks whether a saved plan's window is still safe against the *current*
 * forecast. Only meaningful for plans whose window is still ahead of us
 * (today/near-term), a plan for a past date has nothing to warn about.
 * Uses the plan's own stored activity/duration/window with fresh forecast
 * data, so this is a real recomputation, not a guess.
 */
export function checkPlanImpact(plan: ActivityPlan, situation: SituationResult): AlertContent | null {
  const winStartMs = new Date(plan.available_start).getTime();
  const winEndMs = new Date(plan.available_end).getTime();
  const nowMs = Date.now();
  if (winEndMs < nowMs || winEndMs - nowMs > 48 * 3600 * 1000) return null; // not upcoming/near-term

  const savedResult = plan.last_result as BestTimeResult | null;
  if (!savedResult?.recommended) return null;

  // Peak exposure the saved window would now see, per the current forecast.
  const slice = situation.forecast_series.filter((p) => {
    const t = new Date(p.time).getTime();
    return t >= new Date(savedResult.recommended.start).getTime() && t < new Date(savedResult.recommended.end).getTime();
  });
  if (!slice.length) return null; // saved window has fallen outside the current forecast's reach
  const peak = Math.max(...slice.map((p) => p.value));
  const nowRisk = wbgtToRisk(peak);
  if (nowRisk !== "HIGH" && nowRisk !== "VERY_HIGH") return null; // still fine

  const fresh = findBestTime(plan.activity_type, plan.duration_minutes, plan.available_start, plan.available_end, situation.forecast_series, situation.quality);
  const savedWin = fmtWindow(savedResult.recommended.start, savedResult.recommended.end);
  const freshWin = fresh ? fmtWindow(fresh.recommended.start, fresh.recommended.end) : null;

  return {
    subject_en: `Your plan "${plan.name}" may need to move`,
    subject_sw: `Mpango wako "${plan.name}" huenda ukahitaji kubadilishwa`,
    lines_en: [
      `Conditions have changed since you saved "${plan.name}", the window you saved (${savedWin}) now looks like ${nowRisk.replace("_", " ")} thermal exposure.`,
      freshWin ? `A better window right now: <strong>${freshWin}</strong>.` : "AFYA MAZINGIRA couldn't find a clearly better window in your available range, check the Plan page for the latest picture.",
    ],
    lines_sw: [
      `Hali zimebadilika tangu uhifadhi "${plan.name}", dirisha ulilohifadhi (${savedWin}) sasa linaonekana na kupatwa na joto ${nowRisk === "HIGH" ? "JUU" : "JUU SANA"}.`,
      freshWin ? `Dirisha bora zaidi sasa hivi: <strong>${freshWin}</strong>.` : "AFYA MAZINGIRA haikupata dirisha bora zaidi wazi katika muda wako uliopatikana, angalia ukurasa wa Mpango kwa taswira mpya.",
    ],
  };
}

export function pickSubject(content: AlertContent, lang: Lang): string {
  return lang === "sw" ? content.subject_sw : content.subject_en;
}
export function pickLines(content: AlertContent, lang: Lang): string[] {
  return lang === "sw" ? content.lines_sw : content.lines_en;
}
