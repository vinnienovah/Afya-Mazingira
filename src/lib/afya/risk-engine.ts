import type { RiskLevel, UncertaintyCategory } from "./types";
import type { RainInputs } from "./feature-engine";
import { wbgtToRisk, riskRank } from "./constants";
import rainModel from "./model/rain-model.json";

// Risk / Exposure Engine
// Thermal exposure risk is activity-aware.
// No universal health score. No medical claims.

/**
 * Compute thermal exposure risk for a given WBGT value and activity profile.
 * @param wbgt  Wet bulb globe temperature in shade, °C
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
 * Chance, 0 to 1, that gauge 1 records rain in the next three hours: a
 * logistic regression on humidity, recent changes in humidity, pressure and
 * temperature, the time of day and recent rain, fitted to the gauge's own
 * record by scripts/fit-models.ts and tested month by month on months it had
 * not seen. Without inputs it gives how often it has rained in the next three
 * hours at this month and hour.
 */
export function computeRainProbability(inputs: RainInputs | null, atIso: string): number {
  if (rainModel.kind === "logistic" && inputs) {
    let z = rainModel.intercept;
    rainModel.features.forEach((name, j) => {
      z += rainModel.coef[j] * ((inputs[name as keyof RainInputs] - rainModel.feature_mean[j]) / rainModel.feature_std[j]);
    });
    return 1 / (1 + Math.exp(-z));
  }
  const local = new Date(Date.parse(atIso) + 3 * 3600 * 1000);
  return rainModel.month_hour[local.getUTCMonth()][local.getUTCHours()];
}

/**
 * Rank comparison between two risk levels.
 * Returns negative if a < b, positive if a > b.
 */
export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return riskRank(a) - riskRank(b);
}
