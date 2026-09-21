import type { ForecastPoint, RiskLevel } from "./types";
import { getActivityProfile, riskRank, wbgtToRisk } from "./constants";

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
}

const EAT_OFFSET_MS = 3 * 3600 * 1000;
const hh = (ms: number) => new Date(ms + EAT_OFFSET_MS).toISOString().slice(11, 16);

/** The next time the local clock reads `hour`, at or after `nowMs`. */
function nextLocalHour(hour: number, nowMs: number): number {
  const local = new Date(nowMs + EAT_OFFSET_MS);
  const candidate =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - EAT_OFFSET_MS;
  return candidate >= nowMs - 3600 * 1000 ? candidate : candidate + 86400 * 1000;
}

/**
 * Judge a planned activity against the forecast: the highest WBGT inside its
 * window, the risk band that gives for this activity, and, when it is high,
 * the lowest-exposure window of the same length the forecast can offer.
 */
export function assessActivity(
  activity: PlannedActivity,
  series: ForecastPoint[],
  nowMs: number,
): ActivityAssessment {
  const start = nextLocalHour(activity.start_hour, nowMs);
  const hours = (activity.end_hour - activity.start_hour + 24) % 24 || 24;
  const end = start + hours * 3600 * 1000;
  const inWindow = series.filter((p) => {
    const t = Date.parse(p.time);
    return t >= start && t <= end;
  });
  const offset = getActivityProfile(activity.activity_type).wbgt_caution_offset;

  if (!inWindow.length) {
    return {
      affected: false,
      peak_wbgt_c: null,
      risk: null,
      text_en: "Beyond the 9-hour forecast. Check again nearer the time.",
      text_sw: "Iko nje ya utabiri wa saa 9. Angalia tena karibu na wakati huo.",
    };
  }

  const peak = Math.max(...inWindow.map((p) => p.value));
  const risk = wbgtToRisk(peak, offset);
  const affected = riskRank(risk) >= riskRank("HIGH");
  if (!affected) {
    return {
      affected,
      peak_wbgt_c: peak,
      risk,
      text_en: `Forecast peak ${peak.toFixed(1)}°C WBGT in this window: ${risk.replace("_", " ").toLowerCase()} for this activity.`,
      text_sw: `Kilele cha utabiri ${peak.toFixed(1)}°C WBGT katika muda huu: hatari ${risk === "LOW" ? "ya chini" : "imeinuka"} kwa shughuli hii.`,
    };
  }

  // Lowest-peak window of the same length that the forecast covers.
  const steps = Math.min(hours * 4, series.length - 1);
  let best: { from: number; to: number; peak: number } | null = null;
  for (let i = 0; i + steps < series.length; i++) {
    const slice = series.slice(i, i + steps + 1);
    const slicePeak = Math.max(...slice.map((p) => p.value));
    if (!best || slicePeak < best.peak) {
      best = { from: Date.parse(slice[0].time), to: Date.parse(slice[slice.length - 1].time), peak: slicePeak };
    }
  }
  const better = best && best.peak < peak - 0.5 ? best : null;
  return {
    affected,
    peak_wbgt_c: peak,
    risk,
    text_en: better
      ? `Forecast peak ${peak.toFixed(1)}°C WBGT. ${hh(better.from)}–${hh(better.to)} peaks at ${better.peak.toFixed(1)}°C.`
      : `Forecast peak ${peak.toFixed(1)}°C WBGT, and no cooler window of this length in the next 9 hours. Plan shade, water and rest.`,
    text_sw: better
      ? `Kilele cha utabiri ${peak.toFixed(1)}°C WBGT. ${hh(better.from)}–${hh(better.to)} kilele ni ${better.peak.toFixed(1)}°C.`
      : `Kilele cha utabiri ${peak.toFixed(1)}°C WBGT, na hakuna muda baridi zaidi wa urefu huu katika saa 9 zijazo. Panga kivuli, maji na mapumziko.`,
  };
}
