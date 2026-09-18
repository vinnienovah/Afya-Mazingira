import type { RiskLevel, UncertaintyCategory } from "./types";
import { wbgtToRisk, riskRank } from "./constants";

// ─── Risk / Exposure Engine ───────────────────────────────────────────────────
// Thermal exposure risk is activity-aware.
// No universal health score. No medical claims.

/**
 * Compute thermal exposure risk for a given WBGT value and activity profile.
 * @param wbgt  Wet bulb globe temperature (WBGT-like) °C
 * @param activityOffset  From ACTIVITY_PROFILES (positive = more tolerant)
 */
export function computeThermalRisk(wbgt: number, activityOffset = 0): RiskLevel {
  return wbgtToRisk(wbgt, activityOffset);
}

/**
 * Compute uncertainty category from forecast confidence width.
 */
export function computeUncertainty(lower: number, upper: number): UncertaintyCategory {
  const width = upper - lower;
  if (width <= 1.5) return "LOW";
  if (width <= 3.0) return "MODERATE";
  return "HIGH";
}

/**
 * Compute rain probability (0–1) for the next N hours.
 * Secondary capability — sparse in current data.
 */
export function computeRainProbability(
  currentRainObserved: boolean,
  pressureDelta1h: number,
  humidityCurrent: number,
): number {
  if (currentRainObserved) return 0.85;
  // Falling pressure + high humidity = elevated signal
  let score = 0.05;
  if (pressureDelta1h < -0.5) score += 0.20;
  if (pressureDelta1h < -1.2) score += 0.15;
  if (humidityCurrent > 80) score += 0.15;
  if (humidityCurrent > 90) score += 0.10;
  return Math.min(0.92, score);
}

/**
 * WBGT-based activity guidance.
 * Returns guidance keys, i18n'd on client.
 * NOT medical advice — environmental decision support only.
 */
export function getActivityGuidance(
  wbgt: number,
  activityKey: string,
): { guidance_key: string; detail_key: string } {
  const profile = ACTIVITY_OFFSETS[activityKey] ?? 0;
  const effective = wbgt + profile;

  if (effective < 18) return { guidance_key: "low_exposure", detail_key: "low_exposure_detail" };
  if (effective < 21) return { guidance_key: "moderate_exposure", detail_key: "moderate_exposure_detail" };
  if (effective < 24) return { guidance_key: "high_exposure", detail_key: "high_exposure_detail" };
  return { guidance_key: "very_high_exposure", detail_key: "very_high_exposure_detail" };
}

const ACTIVITY_OFFSETS: Record<string, number> = {
  walking: 2,
  sports: -1.5,
  outdoor_work: 0,
  construction: -1.5,
  outdoor_event: 0.5,
  field_work: 0,
  general: 1,
};

/**
 * Rank comparison between two risk levels.
 * Returns negative if a < b, positive if a > b.
 */
export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return riskRank(a) - riskRank(b);
}
