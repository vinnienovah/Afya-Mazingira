import type { ForecastPoint, Lang, RiskLevel } from "./types";
import { RISK_META, getActivityProfile, riskRank, wbgtToRisk } from "./constants";
import { findBestTime } from "./best-time-engine";
import { tf } from "./i18n";

export interface PlannedActivity {
  id: number;
  name: string;
  start_hour: number; // local (EAT) hour
  end_hour: number;
  activity_type: string;
}

export interface ActivityAssessment {
  affected: boolean;
  peak_wbgt_c: number | null;
  risk: RiskLevel | null;
  text_en: string;
  text_sw: string;
  // The stretch of the activity the forecast judged: from now if it has
  // begun, to where the forecast ends if that comes first.
  judged: { from: string; to: string; partial: boolean } | null;
}

const EAT_OFFSET_MS = 3 * 3600 * 1000;
const STEP_MS = 15 * 60 * 1000;
const DAY_MS = 86400 * 1000;
const hh = (ms: number) => new Date(ms + EAT_OFFSET_MS).toISOString().slice(11, 16);
const iso = (ms: number) => new Date(ms).toISOString();

/** The activity's next or current occurrence: the first one that has not ended by `nowMs`. */
function occurrence(activity: PlannedActivity, nowMs: number): { start: number; end: number } {
  const local = new Date(nowMs + EAT_OFFSET_MS);
  const hours = (activity.end_hour - activity.start_hour + 24) % 24 || 24;
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), activity.start_hour) - EAT_OFFSET_MS;
  for (const start of [today - DAY_MS, today, today + DAY_MS]) {
    if (start + hours * 3600 * 1000 > nowMs) return { start, end: start + hours * 3600 * 1000 };
  }
  return { start: today + DAY_MS, end: today + DAY_MS + hours * 3600 * 1000 };
}

function bilingual(key: string, values: (lang: Lang) => Record<string, string>) {
  return { text_en: tf("en", key, values("en")), text_sw: tf("sw", key, values("sw")) };
}

/**
 * Judge a planned activity against the forecast: the highest WBGT in what is
 * left of its window, the risk band that gives for this activity, and, when it
 * is high, the lowest-exposure daylight window of the same length the forecast
 * covers in full. When the forecast ends inside the window the band is said to
 * hold only up to that point.
 */
export function assessActivity(
  activity: PlannedActivity,
  series: ForecastPoint[],
  nowMs: number,
): ActivityAssessment {
  const { start, end } = occurrence(activity, nowMs);
  // The latest reading, up to a quarter hour old, stands for now.
  const from = Math.max(start, nowMs - STEP_MS);
  const inWindow = series.filter((p) => {
    const t = Date.parse(p.time);
    return t >= from && t < end;
  });
  const offset = getActivityProfile(activity.activity_type).wbgt_caution_offset;

  if (!inWindow.length) {
    return {
      affected: false,
      peak_wbgt_c: null,
      risk: null,
      ...bilingual("ops_beyond_forecast", () => ({})),
      judged: null,
    };
  }

  const firstMs = Date.parse(inWindow[0].time);
  const reach = Date.parse(inWindow[inWindow.length - 1].time) + STEP_MS;
  const partial = reach < end;
  const judged = { from: iso(Math.max(start, firstMs)), to: iso(Math.min(end, reach)), partial };

  const peak = Math.max(...inWindow.map((p) => p.value));
  const risk = wbgtToRisk(peak, offset);
  const band = (lang: Lang) => (lang === "sw" ? RISK_META[risk].sw : RISK_META[risk].en);
  const affected = riskRank(risk) >= riskRank("HIGH");
  if (!affected) {
    return {
      affected,
      peak_wbgt_c: peak,
      risk,
      ...(partial
        ? bilingual("ops_peak_partial", (lang) => ({
            wbgt: peak.toFixed(1), band: band(lang), from: hh(Date.parse(judged.from)), to: hh(Date.parse(judged.to)),
          }))
        : bilingual("ops_peak", (lang) => ({ wbgt: peak.toFixed(1), band: band(lang) }))),
      judged,
    };
  }

  // Lowest-peak daylight window of the same length that the forecast covers in full.
  const lengthMinutes = Math.round((end - start) / 60_000);
  const best = findBestTime(activity.activity_type, lengthMinutes, iso(nowMs), iso(nowMs + DAY_MS), series, null, {
    nowIso: iso(nowMs),
  });
  const better = best && best.recommended.peak_wbgt_c < peak - 0.5 ? best.recommended : null;
  return {
    affected,
    peak_wbgt_c: peak,
    risk,
    ...(better
      ? bilingual("ops_peak_better", () => ({
          wbgt: peak.toFixed(1),
          from: hh(Date.parse(better.start)),
          to: hh(Date.parse(better.end)),
          better: better.peak_wbgt_c.toFixed(1),
        }))
      : bilingual("ops_peak_no_better", () => ({ wbgt: peak.toFixed(1) }))),
    judged,
  };
}
