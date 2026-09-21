// AFYA MAZINGIRA · Farm Advisory Engine
// Deterministic agronomic decision layer built on the validated pipeline.
//
// Scientific basis:
//   · Reference evapotranspiration (ET₀), Hargreaves–Samani (1985)
//   · Crop water requirement (ETc), FAO-56 single crop coefficient (ETc = Kc × ET₀)
//   · Soil water balance, recent rainfall (CHIRPS) + soil moisture (ERA5-Land) − ETc
//   · Spray suitability, wind drift + evaporation + wash-off risk windows
//
// This produces AGRONOMIC DECISION SUPPORT ONLY. It does not predict yield,
// diagnose plant disease, or replace extension-officer judgement.

import type { SituationResult } from "./types";

export type GrowthStage = "establishment" | "vegetative" | "flowering" | "maturity";
export type IrrigationAction = "IRRIGATE_NOW" | "IRRIGATE_SOON" | "HOLD_RAIN_EXPECTED" | "NO_IRRIGATION";
export type WindowQuality = "GOOD" | "MARGINAL" | "AVOID";

export interface CropProfile {
  key: string;
  label_en: string;
  label_sw: string;
  /** FAO-56 single crop coefficients by stage */
  kc: Record<GrowthStage, number>;
  /** Root zone depth (m), drives soil water holding capacity */
  root_depth_m: number;
  /** Fraction of available water depleted before stress (FAO-56 p-value) */
  depletion_fraction: number;
  /** Typical rainfall (mm) needed to justify planting in a rain-fed season */
  planting_rain_mm: number;
}

// Crops common to Kiambu / Juja smallholder and institutional farms
export const CROP_PROFILES: CropProfile[] = [
  {
    key: "maize", label_en: "Maize", label_sw: "Mahindi",
    kc: { establishment: 0.40, vegetative: 0.80, flowering: 1.20, maturity: 0.60 },
    root_depth_m: 1.0, depletion_fraction: 0.55, planting_rain_mm: 40,
  },
  {
    key: "beans", label_en: "Beans", label_sw: "Maharagwe",
    kc: { establishment: 0.40, vegetative: 0.75, flowering: 1.15, maturity: 0.35 },
    root_depth_m: 0.6, depletion_fraction: 0.45, planting_rain_mm: 30,
  },
  {
    key: "kale", label_en: "Kale (sukuma wiki)", label_sw: "Sukuma wiki",
    kc: { establishment: 0.70, vegetative: 0.95, flowering: 1.05, maturity: 0.95 },
    root_depth_m: 0.4, depletion_fraction: 0.40, planting_rain_mm: 20,
  },
  {
    key: "tomato", label_en: "Tomato", label_sw: "Nyanya",
    kc: { establishment: 0.60, vegetative: 0.90, flowering: 1.15, maturity: 0.80 },
    root_depth_m: 0.7, depletion_fraction: 0.40, planting_rain_mm: 25,
  },
  {
    key: "potato", label_en: "Potato", label_sw: "Viazi",
    kc: { establishment: 0.50, vegetative: 0.85, flowering: 1.15, maturity: 0.75 },
    root_depth_m: 0.5, depletion_fraction: 0.35, planting_rain_mm: 30,
  },
  {
    key: "coffee", label_en: "Coffee", label_sw: "Kahawa",
    kc: { establishment: 0.90, vegetative: 0.95, flowering: 0.95, maturity: 0.95 },
    root_depth_m: 1.3, depletion_fraction: 0.50, planting_rain_mm: 50,
  },
  {
    key: "napier", label_en: "Napier / fodder", label_sw: "Napier / malisho",
    kc: { establishment: 0.90, vegetative: 1.00, flowering: 1.05, maturity: 0.95 },
    root_depth_m: 1.0, depletion_fraction: 0.55, planting_rain_mm: 35,
  },
];

export function getCropProfile(key: string): CropProfile {
  return CROP_PROFILES.find((c) => c.key === key) ?? CROP_PROFILES[0];
}

// Reference evapotranspiration (Hargreaves–Samani)
// ET₀ = 0.0023 × (Tmean + 17.8) × √(Tmax − Tmin) × Ra
// Ra at the equator ≈ 36.2 MJ/m²/day ≈ 14.8 mm/day water equivalent.

const RA_EQUATOR_MM = 14.8;

export function computeEt0(tmaxC: number, tminC: number): number {
  const tmean = (tmaxC + tminC) / 2;
  const range = Math.max(0.5, tmaxC - tminC);
  const et0 = 0.0023 * (tmean + 17.8) * Math.sqrt(range) * RA_EQUATOR_MM;
  return Math.max(0, Math.round(et0 * 100) / 100);
}

// Soil water balance

export interface WaterBalance {
  et0_mm_day: number;
  etc_mm_day: number;
  kc: number;
  rain_7d_mm: number;
  rain_30d_mm: number;
  demand_7d_mm: number;
  balance_7d_mm: number;
  demand_30d_mm: number;
  balance_30d_mm: number;
  soil_moisture_pct: number;
  depletion_pct: number;
  readily_available_mm: number;
}

/**
 * Total available water (mm) in the root zone.
 * Assumes a loam soil typical of the Juja/Kiambu area: ~150 mm/m available water
 * (i.e. field capacity − wilting point ≈ 0.15 m³/m³ volumetric, matching the
 * FIELD_CAPACITY/WILTING_POINT pair below).
 */
const AVAILABLE_WATER_MM_PER_M = 150;
const FIELD_CAPACITY_VOL = 0.30;
const WILTING_POINT_VOL = 0.15;

export function computeWaterBalance(
  situation: SituationResult,
  crop: CropProfile,
  stage: GrowthStage,
  tmaxC: number,
  tminC: number,
): WaterBalance {
  const et0 = computeEt0(tmaxC, tminC);
  const kc = crop.kc[stage];
  const etc = Math.round(et0 * kc * 100) / 100;

  const rain7 = situation.chirps.chirps_7d_mm;
  const rain30 = situation.chirps.chirps_30d_mm;
  const demand7 = Math.round(etc * 7 * 10) / 10;
  const balance7 = Math.round((rain7 - demand7) * 10) / 10;
  // A 7-day rain deficit that looks fine can still mask a longer dry stretch,
  // check the 30-day balance too rather than deciding on one short window alone.
  const demand30 = Math.round(etc * 30 * 10) / 10;
  const balance30 = Math.round((rain30 - demand30) * 10) / 10;

  // ERA5-Land volumetric soil water (m³/m³) → percentage
  const soilVol = situation.era5.era5_soil_moisture;
  const soilPct = Math.round(soilVol * 1000) / 10;

  const taw = AVAILABLE_WATER_MM_PER_M * crop.root_depth_m;
  const raw = Math.round(taw * crop.depletion_fraction * 10) / 10;

  // Depletion from the rain-vs-demand accounting, for both windows.
  const deficit7 = Math.max(0, -balance7);
  const depletion7Pct = Math.min(100, Math.round((deficit7 / Math.max(1, raw)) * 1000) / 10);
  const deficit30 = Math.max(0, -balance30);
  const depletion30Pct = Math.min(100, Math.round((deficit30 / Math.max(1, raw)) * 1000) / 10);

  // Depletion from the real ERA5 soil moisture reading directly, a much more
  // direct signal of actual root-zone water status than rainfall accounting
  // alone, since it also reflects drainage, prior irrigation and evaporation
  // that a simple rain-minus-demand tally can't see.
  const availableFraction = Math.max(
    0,
    Math.min(1, (soilVol - WILTING_POINT_VOL) / (FIELD_CAPACITY_VOL - WILTING_POINT_VOL)),
  );
  const soilDepletionPct = Math.round((1 - availableFraction) * 1000) / 10;

  // The most severe of the three signals wins, irrigation decisions should
  // never be reassured by a short calm window while soil moisture or the
  // longer trend already shows real stress.
  const depletionPct = Math.max(depletion7Pct, depletion30Pct, soilDepletionPct);

  return {
    et0_mm_day: et0,
    etc_mm_day: etc,
    kc,
    rain_7d_mm: rain7,
    rain_30d_mm: rain30,
    demand_7d_mm: demand7,
    balance_7d_mm: balance7,
    demand_30d_mm: demand30,
    balance_30d_mm: balance30,
    soil_moisture_pct: soilPct,
    depletion_pct: depletionPct,
    readily_available_mm: raw,
  };
}

// Irrigation recommendation

export interface IrrigationAdvice {
  action: IrrigationAction;
  /** Suggested application depth in mm (0 when no irrigation is advised) */
  depth_mm: number;
  /** Litres per m² == mm; provided for smallholder framing */
  litres_per_m2: number;
  reason_keys: string[];
  confidence: "LOW" | "MODERATE" | "HIGH";
}

export function computeIrrigationAdvice(
  wb: WaterBalance,
  situation: SituationResult,
): IrrigationAdvice {
  const reasons: string[] = [];
  const rainProb = situation.risk.rain_probability;

  // Rain expected soon → hold, avoid wasting water
  if (rainProb >= 0.45 && wb.depletion_pct < 85) {
    reasons.push("farm_reason_rain_expected");
    if (wb.balance_7d_mm < 0) reasons.push("farm_reason_deficit_but_rain");
    return {
      action: "HOLD_RAIN_EXPECTED",
      depth_mm: 0,
      litres_per_m2: 0,
      reason_keys: reasons,
      confidence: situation.quality.status === "GOOD" ? "MODERATE" : "LOW",
    };
  }

  // Severe depletion → irrigate now.
  // Depth is sized off the depletion fraction itself (not just the 7-day rain
  // deficit) so it stays sensible even when soil moisture, not the recent
  // rain balance, is what's driving the decision.
  if (wb.depletion_pct >= 70) {
    const depth = Math.round(wb.readily_available_mm * (wb.depletion_pct / 100) * 10) / 10;
    reasons.push("farm_reason_high_depletion");
    if (wb.balance_7d_mm < 0) reasons.push("farm_reason_demand_exceeds_rain");
    if (wb.soil_moisture_pct <= 17) reasons.push("farm_reason_low_soil_moisture");
    if (wb.etc_mm_day > 4.5) reasons.push("farm_reason_high_et");
    return {
      action: "IRRIGATE_NOW",
      depth_mm: depth,
      litres_per_m2: depth,
      reason_keys: reasons,
      confidence: situation.quality.status === "GOOD" ? "HIGH" : "MODERATE",
    };
  }

  // Moderate depletion → irrigate soon
  if (wb.depletion_pct >= 40) {
    const depth = Math.round((wb.readily_available_mm * 0.5) * 10) / 10;
    reasons.push("farm_reason_moderate_depletion");
    if (wb.rain_7d_mm < 10) reasons.push("farm_reason_low_recent_rain");
    if (wb.soil_moisture_pct <= 17) reasons.push("farm_reason_low_soil_moisture");
    return {
      action: "IRRIGATE_SOON",
      depth_mm: depth,
      litres_per_m2: depth,
      reason_keys: reasons,
      confidence: situation.quality.status === "GOOD" ? "MODERATE" : "LOW",
    };
  }

  // Adequate water. A negative 7-day balance can still be safe when the root
  // zone holds enough readily available water to buffer it, say so explicitly
  // rather than implying rainfall alone met demand.
  if (wb.balance_7d_mm < 0) {
    reasons.push("farm_reason_buffered_by_rootzone");
  } else {
    reasons.push("farm_reason_adequate_moisture");
    if (wb.rain_7d_mm >= wb.demand_7d_mm) reasons.push("farm_reason_rain_meets_demand");
  }
  return {
    action: "NO_IRRIGATION",
    depth_mm: 0,
    litres_per_m2: 0,
    reason_keys: reasons,
    confidence: situation.quality.status === "GOOD" ? "HIGH" : "MODERATE",
  };
}

// Spray / field-operation suitability

export interface FieldWindow {
  operation: "spraying" | "planting" | "harvesting" | "field_work";
  quality: WindowQuality;
  reason_keys: string[];
}

/**
 * Spray suitability. Deterministic rules based on documented agronomic practice:
 *   · wind > 4 m/s        → drift risk
 *   · wind < 0.4 m/s      → inversion / poor deposition
 *   · temperature > 28 °C → rapid evaporation of droplets
 *   · rain probability    → wash-off before uptake
 */
export function evaluateSprayWindow(situation: SituationResult): FieldWindow {
  const reasons: string[] = [];
  const wind = situation.current.wind_speed_ms;
  const temp = situation.current.temperature_c;
  const rainProb = situation.risk.rain_probability;

  let score: WindowQuality = "GOOD";

  if (wind > 4.0) { score = "AVOID"; reasons.push("farm_reason_wind_drift"); }
  else if (wind < 0.4) { score = "MARGINAL"; reasons.push("farm_reason_wind_too_calm"); }
  else reasons.push("farm_reason_wind_suitable");

  if (rainProb >= 0.5) { score = "AVOID"; reasons.push("farm_reason_washoff"); }
  else if (rainProb >= 0.25 && score === "GOOD") { score = "MARGINAL"; reasons.push("farm_reason_rain_possible"); }
  else if (rainProb < 0.25) reasons.push("farm_reason_low_rain_risk");

  if (temp > 28) {
    if (score === "GOOD") score = "MARGINAL";
    reasons.push("farm_reason_evaporation");
  }

  if (situation.quality.status === "POOR") {
    score = "MARGINAL";
    reasons.push("farm_reason_data_limited");
  }

  return { operation: "spraying", quality: score, reason_keys: reasons.slice(0, 4) };
}

// Planting outlook (rain-fed)

export interface PlantingOutlook {
  favourable: boolean;
  rain_30d_mm: number;
  required_mm: number;
  dry_spell_days: number;
  percentile: number;
  message_key: string;
}

export function evaluatePlantingOutlook(
  situation: SituationResult,
  crop: CropProfile,
): PlantingOutlook {
  const rain30 = situation.chirps.chirps_30d_mm;
  const dry = situation.chirps.chirps_dry_spell_days;
  const pct = situation.chirps.chirps_percentile;
  const required = crop.planting_rain_mm;

  // Rain-fed planting favours accumulated moisture plus no long dry spell
  const favourable = rain30 >= required && dry <= 7;

  let key: string;
  if (favourable && pct >= 60) key = "farm_plant_favourable_wet";
  else if (favourable) key = "farm_plant_favourable";
  else if (rain30 < required && dry > 7) key = "farm_plant_dry";
  else if (rain30 < required) key = "farm_plant_insufficient";
  else key = "farm_plant_dryspell";

  return {
    favourable,
    rain_30d_mm: rain30,
    required_mm: required,
    dry_spell_days: dry,
    percentile: pct,
    message_key: key,
  };
}

// Crop heat stress (activity-aware, NOT a disease or yield model)

export type HeatStress = "NONE" | "MILD" | "MODERATE" | "SEVERE";

export interface CropStressSignal {
  level: HeatStress;
  /** Peak air temperature used for the assessment */
  peak_temp_c: number;
  reason_keys: string[];
}

/**
 * Crop heat-stress signal from forecast air temperature.
 * Thresholds reflect widely documented cardinal temperatures for the
 * crops listed above; they are advisory signals, not yield predictions.
 */
export function evaluateCropStress(
  situation: SituationResult,
  crop: CropProfile,
  stage: GrowthStage,
): CropStressSignal {
  // Approximate peak air temperature from the WBGT-like peak and current offset
  const peakWbgt = situation.expected_peak?.wbgt_c ?? situation.current.wbgt_c;
  const offset = situation.current.temperature_c - situation.current.wbgt_c;
  const peakTemp = Math.round((peakWbgt + offset) * 10) / 10;

  const reasons: string[] = [];
  let level: HeatStress = "NONE";

  // Flowering is the most heat-sensitive stage for most of these crops
  const sensitive = stage === "flowering";
  const t1 = sensitive ? 28 : 30;
  const t2 = sensitive ? 32 : 34;
  const t3 = sensitive ? 35 : 38;

  if (peakTemp >= t3) { level = "SEVERE"; reasons.push("farm_reason_severe_heat"); }
  else if (peakTemp >= t2) { level = "MODERATE"; reasons.push("farm_reason_moderate_heat"); }
  else if (peakTemp >= t1) { level = "MILD"; reasons.push("farm_reason_mild_heat"); }
  else reasons.push("farm_reason_no_heat_stress");

  if (sensitive && level !== "NONE") reasons.push("farm_reason_flowering_sensitive");
  if (situation.era5.era5_soil_moisture < 0.15 && level !== "NONE") {
    reasons.push("farm_reason_dry_soil_compounds");
  }

  return { level, peak_temp_c: peakTemp, reason_keys: reasons.slice(0, 3) };
}

// Full farm advisory bundle

export interface FarmAdvisory {
  crop: CropProfile;
  stage: GrowthStage;
  water_balance: WaterBalance;
  irrigation: IrrigationAdvice;
  spray_window: FieldWindow;
  planting: PlantingOutlook;
  stress: CropStressSignal;
  /** Best time to do physical field work, from the deterministic Best-Time engine */
  field_work_window: { start: string; end: string; reasons: string[] } | null;
  generated_at: string;
  data_quality: string;
}

export function buildFarmAdvisory(
  situation: SituationResult,
  cropKey: string,
  stage: GrowthStage,
): FarmAdvisory {
  const crop = getCropProfile(cropKey);

  // Daily temperature range from the forecast series (drives Hargreaves ET₀)
  const temps = situation.forecast_series.map((p) => p.value);
  const offset = situation.current.temperature_c - situation.current.wbgt_c;
  const tmax = Math.round((Math.max(...temps) + offset) * 10) / 10;
  const tmin = Math.round((Math.min(...temps) + offset) * 10) / 10;

  const wb = computeWaterBalance(situation, crop, stage, tmax, tmin);

  return {
    crop,
    stage,
    water_balance: wb,
    irrigation: computeIrrigationAdvice(wb, situation),
    spray_window: evaluateSprayWindow(situation),
    planting: evaluatePlantingOutlook(situation, crop),
    stress: evaluateCropStress(situation, crop, stage),
    field_work_window: situation.best_time
      ? {
          start: situation.best_time.recommended.start,
          end: situation.best_time.recommended.end,
          reasons: situation.best_time.recommended.reasons,
        }
      : null,
    generated_at: situation.generated_at,
    data_quality: situation.quality.status,
  };
}
