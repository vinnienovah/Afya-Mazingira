import type { RiskLevel, UncertaintyCategory } from "./types";
import { wbgtToRisk, riskRank } from "./constants";

// Risk / Exposure Engine
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
 * Chance of rain in the next few hours, 0 to 1. A rule of thumb (falling
 * pressure and high humidity raise it), not fitted to the station's rain
 * record: the rain gauges are too sparse and unreliable to fit it on.
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
 * Rank comparison between two risk levels.
 * Returns negative if a < b, positive if a > b.
 */
export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return riskRank(a) - riskRank(b);
}
