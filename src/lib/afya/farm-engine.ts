// AFYA MAZINGIRA · Farm Advisory Engine
// Deterministic agronomic decision layer built on the validated pipeline.
//
// Scientific basis, FAO-56 (Allen et al. 1998) throughout:
//   · Reference evapotranspiration (ET₀), Hargreaves and Samani (1985) as FAO-56
//     eq. 52, from a measured daily Tmax and Tmin, with extraterrestrial
//     radiation for the station's latitude and the date (eq. 21)
//   · Crop water requirement (ETc), single crop coefficient (ETc = Kc × ET₀)
//   · Irrigation need, a 7-day budget of crop demand against effective rain
//   · Spray suitability, wind drift + evaporation + wash-off risk windows
//
// This produces AGRONOMIC DECISION SUPPORT ONLY. It does not predict yield,
// diagnose plant disease, or replace extension-officer judgement.

import type { SituationResult } from "./types";
import type { RegionalSoilMoisture } from "./sources-external";
import { JKUAT_COORDS } from "./constants";
import { datesEnding, dayOfYear, nairobiDate } from "./nairobi-time";

export type GrowthStage = "establishment" | "vegetative" | "flowering" | "maturity";
export type IrrigationAction = "IRRIGATE_NOW" | "HOLD_RAIN_EXPECTED" | "NO_IRRIGATION";
export type WindowQuality = "GOOD" | "MARGINAL" | "AVOID";
export type Confidence = "LOW" | "MODERATE" | "HIGH";

export interface CropProfile {
  key: string;
  label_en: string;
  label_sw: string;
  /** FAO-56 single crop coefficients by stage */
  kc: Record<GrowthStage, number>;
  /** Root zone depth (m) once fully grown; see rootDepthM for the stages before */
  root_depth_m: number;
  /** Fraction of available water depleted before stress (FAO-56 p-value) */
  depletion_fraction: number;
  /** Typical rainfall (mm) needed to justify planting in a rain-fed season */
  planting_rain_mm: number;
}

// Crops common to Kiambu / Juja smallholder and institutional farms.
// Root depths and p for maize, beans, tomato and potato fall within FAO-56
// Table 22 (Allen et al. 1998); the kale, coffee and napier values do not
// come from that table.
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

export const CROP_KEYS = CROP_PROFILES.map((c) => c.key);

/** The profile for a crop key, or null for a crop the advisory does not cover. */
export function findCropProfile(key: string): CropProfile | null {
  return CROP_PROFILES.find((c) => c.key === key) ?? null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// Roots start shallow and reach the crop's full depth by flowering, the way
// FAO-56 grows the root zone through the season. Establishment takes 30 % of
// the full depth, never less than 0.2 m; the vegetative stage is halfway.
const ESTABLISHMENT_ROOT_SHARE = 0.3;
const MIN_ROOT_DEPTH_M = 0.2;

/** Effective root depth (m) at a growth stage. */
export function rootDepthM(crop: CropProfile, stage: GrowthStage): number {
  const initial = Math.max(MIN_ROOT_DEPTH_M, ESTABLISHMENT_ROOT_SHARE * crop.root_depth_m);
  const depth =
    stage === "establishment" ? initial
    : stage === "vegetative" ? (initial + crop.root_depth_m) / 2
    : crop.root_depth_m;
  return Math.round(depth * 100) / 100;
}

// Reference evapotranspiration

/** Extraterrestrial radiation Ra for a day of the year and a latitude (FAO-56
 * eqs. 21 and 23 to 25), as its evaporation equivalent in mm/day. */
export function extraterrestrialRadiationMm(doy: number, latitudeDeg: number = JKUAT_COORDS.lat): number {
  const phi = (latitudeDeg * Math.PI) / 180;
  const angle = (2 * Math.PI * doy) / 365;
  const dr = 1 + 0.033 * Math.cos(angle);
  const declination = 0.409 * Math.sin(angle - 1.39);
  const sunsetAngle = Math.acos(-Math.tan(phi) * Math.tan(declination));
  const raMj =
    ((24 * 60) / Math.PI) * 0.082 * dr *
    (sunsetAngle * Math.sin(phi) * Math.sin(declination) +
      Math.cos(phi) * Math.cos(declination) * Math.sin(sunsetAngle));
  return 0.408 * raMj;
}

/** Hargreaves reference evapotranspiration (FAO-56 eq. 52), mm/day. */
export function computeEt0(tmaxC: number, tminC: number, doy: number, latitudeDeg?: number): number {
  const tmean = (tmaxC + tminC) / 2;
  const range = Math.max(0, tmaxC - tminC);
  const et0 = 0.0023 * (tmean + 17.8) * Math.sqrt(range) * extraterrestrialRadiationMm(doy, latitudeDeg);
  return Math.max(0, Math.round(et0 * 100) / 100);
}

export interface TempSlot {
  ts: string;
  temp_sht: number;
  imputed?: string[];
}

export interface TempRange {
  tmax_c: number;
  tmin_c: number;
  /** Clock hours with at least one measured reading */
  measured_hours: number;
}

// Tmax and Tmin need most of the day: with hours missing the range shrinks,
// and ET₀ with it.
export const MIN_MEASURED_HOURS = 20;

const isMeasured = (o: TempSlot) => Number.isFinite(o.temp_sht) && !o.imputed?.includes("temp_sht");

/** Measured Tmax and Tmin over the `hours` up to `endIso`. Slots whose
 * temperature was interpolated or carried forward do not count. */
export function measuredTempRange(series: TempSlot[], endIso: string, hours = 24): TempRange | null {
  const end = Date.parse(endIso);
  const start = end - hours * 3600_000;
  let tmax = -Infinity;
  let tmin = Infinity;
  const hoursSeen = new Set<number>();
  for (const o of series) {
    const t = Date.parse(o.ts);
    if (t <= start || t > end || !isMeasured(o)) continue;
    tmax = Math.max(tmax, o.temp_sht);
    tmin = Math.min(tmin, o.temp_sht);
    hoursSeen.add(Math.ceil((t - start) / 3600_000));
  }
  if (!hoursSeen.size) return null;
  return { tmax_c: round1(tmax), tmin_c: round1(tmin), measured_hours: hoursSeen.size };
}

/** Measured Tmax and Tmin for each Nairobi calendar day in the series. */
export function measuredDailyRanges(series: TempSlot[]): Map<string, TempRange> {
  const byDay = new Map<string, { tmax: number; tmin: number; hours: Set<number> }>();
  for (const o of series) {
    if (!isMeasured(o)) continue;
    const t = Date.parse(o.ts);
    const date = nairobiDate(t);
    const day = byDay.get(date) ?? { tmax: -Infinity, tmin: Infinity, hours: new Set<number>() };
    day.tmax = Math.max(day.tmax, o.temp_sht);
    day.tmin = Math.min(day.tmin, o.temp_sht);
    day.hours.add(Math.floor(t / 3600_000));
    byDay.set(date, day);
  }
  const out = new Map<string, TempRange>();
  for (const [date, d] of byDay) {
    out.set(date, { tmax_c: round1(d.tmax), tmin_c: round1(d.tmin), measured_hours: d.hours.size });
  }
  return out;
}

export type Et0Source = "station" | "regional_forecast";

export interface Et0Estimate {
  et0_mm_day: number;
  tmax_c: number;
  tmin_c: number;
  source: Et0Source;
  /** Hours of the last 24 the station measured, whichever source was used */
  station_hours: number;
  ra_mm_day: number;
}

/** Today's ET₀ from the station's measured last 24 hours when at least 20 of
 * them were measured, otherwise from the regional forecast's Tmax and Tmin. */
export function estimateEt0(
  today: string,
  station: TempRange | null,
  regional: { tmax_c: number | null; tmin_c: number | null } | null,
): Et0Estimate | null {
  const doy = dayOfYear(today);
  const ra = Math.round(extraterrestrialRadiationMm(doy) * 100) / 100;
  const stationHours = station?.measured_hours ?? 0;
  if (station && stationHours >= MIN_MEASURED_HOURS) {
    return {
      et0_mm_day: computeEt0(station.tmax_c, station.tmin_c, doy),
      tmax_c: station.tmax_c,
      tmin_c: station.tmin_c,
      source: "station",
      station_hours: stationHours,
      ra_mm_day: ra,
    };
  }
  if (regional?.tmax_c != null && regional.tmin_c != null) {
    return {
      et0_mm_day: computeEt0(regional.tmax_c, regional.tmin_c, doy),
      tmax_c: regional.tmax_c,
      tmin_c: regional.tmin_c,
      source: "regional_forecast",
      station_hours: stationHours,
      ra_mm_day: ra,
    };
  }
  return null;
}

/** ET₀ on a day before today, and where its Tmax and Tmin came from. */
export interface DayEt0 {
  et0_mm: number;
  source: "station" | "regional_model";
}

// Rain

export type RainSource = "station_gauge" | "regional_model";

export interface RainDay {
  date: string;
  mm: number | null;
}

export interface RainRecord {
  source: RainSource;
  /** Nairobi days, oldest first; the last one is today so far */
  days: RainDay[];
}

// The station gauge is used when it reported on at least 6 of the last 7 days.
export const MIN_GAUGE_DAYS_OF_7 = 6;

export function chooseRainRecord(station: RainDay[] | null, regional: RainDay[] | null): RainRecord | null {
  const reported = station?.slice(-7).filter((d) => d.mm != null).length ?? 0;
  if (station && reported >= MIN_GAUGE_DAYS_OF_7) return { source: "station_gauge", days: station };
  if (regional?.some((d) => d.mm != null)) return { source: "regional_model", days: regional };
  return null;
}

// Effective rain by the fixed-percentage method: 80 % of a day's rain counts
// once the day passes 2 mm. Lighter showers mostly wet the leaves and the
// topsoil and evaporate before they reach the roots.
const EFFECTIVE_RAIN_SHARE = 0.8;
const EFFECTIVE_RAIN_MIN_MM = 2;

export function effectiveRainMm(dayMm: number): number {
  return dayMm > EFFECTIVE_RAIN_MIN_MM ? EFFECTIVE_RAIN_SHARE * dayMm : 0;
}

// A day under 1 mm counts as dry, the ETCCDI convention for dry and wet spells.
export const DRY_DAY_MM = 1;

/** Days in a row up to the latest day with a reading that were wet (or dry).
 * A day without a reading ends the run. */
export function spellLength(days: (number | null)[], wet: boolean): number {
  let i = days.length - 1;
  while (i >= 0 && days[i] == null) i--;
  let n = 0;
  for (; i >= 0; i--) {
    const mm = days[i];
    if (mm == null || (mm >= DRY_DAY_MM) !== wet) break;
    n++;
  }
  return n;
}

// Water balance

export interface MmRange {
  low: number;
  high: number;
}

export interface FarmInputs {
  /** Today in Nairobi, YYYY-MM-DD */
  today: string;
  et0: Et0Estimate;
  /** ET₀ on the days before today, by date */
  past_et0: Record<string, DayEt0>;
  rain: RainRecord;
  /** Open-Meteo's FAO-56 Penman-Monteith ET₀ for today, shown beside the station value */
  regional_et0_mm_day: number | null;
  /** Rain in the regional forecast for the next 48 hours */
  forecast_rain_48h_mm: number | null;
  soil: RegionalSoilMoisture | null;
}

export interface WaterBalance {
  /** Today's Hargreaves ET₀ */
  et0_mm_day: number;
  et0_source: Et0Source;
  et0_tmax_c: number;
  et0_tmin_c: number;
  et0_station_hours: number;
  ra_mm_day: number;
  regional_et0_mm_day: number | null;
  etc_mm_day: number;
  kc: number;
  root_depth_m: number;
  rain_source: RainSource;
  /** The 7 and 30 days ending today, today so far included */
  rain_7d_mm: number;
  rain_7d_days_with_data: number;
  effective_rain_7d_mm: number;
  rain_30d_mm: number;
  rain_30d_days_with_data: number;
  demand_7d_mm: number;
  /** Days of the 7 whose ET₀ came from the station's own Tmax and Tmin */
  demand_7d_station_days: number;
  /** Effective rain minus crop demand; negative is a shortfall */
  balance_7d_mm: number;
  /** Crop demand not met by effective rain, never below 0 */
  net_irrigation_7d_mm: number;
  demand_30d_mm: number;
  balance_30d_mm: number;
  forecast_rain_48h_mm: number | null;
  /** Regional soil moisture (ERA5-Land, 7 to 28 cm) as a %, context only */
  soil_moisture_pct: number | null;
  /** Where that reading sits in its own last 365 days */
  soil_percentile: number | null;
  soil_date: string | null;
  /** The 7-day shortfall as a share of what the root zone holds, if it was full a week ago */
  depletion_pct: number;
  readily_available_mm: number;
  /** Readily available water at the low and high clay available-water bounds */
  readily_available_range_mm: MmRange;
  /** Total available water the root zone holds, same bounds */
  total_available_range_mm: MmRange;
}

// Soil at the JKUAT site is taken as clay: SoilGrids gives about 43 % clay at
// 0 to 5 cm, and FAO-56 Table 19 gives clay 0.12 to 0.20 m³/m³ of available
// water. The field's own figure is unknown, so holding capacities span that range.
const CLAY_AVAILABLE_WATER = { low: 0.12, high: 0.2 };
const CLAY_AVAILABLE_WATER_MID = (CLAY_AVAILABLE_WATER.low + CLAY_AVAILABLE_WATER.high) / 2;

export function computeWaterBalance(inputs: FarmInputs, crop: CropProfile, stage: GrowthStage): WaterBalance {
  const kc = crop.kc[stage];
  const et0 = inputs.et0.et0_mm_day;
  const etc = Math.round(et0 * kc * 100) / 100;

  // A day with neither a station nor a regional reading takes today's ET₀.
  const et0On = (date: string) => (date === inputs.today ? et0 : inputs.past_et0[date]?.et0_mm ?? et0);
  const fromStation = (date: string) =>
    date === inputs.today ? inputs.et0.source === "station" : inputs.past_et0[date]?.source === "station";
  const demandOver = (dates: string[]) => round1(dates.reduce((sum, d) => sum + kc * et0On(d), 0));

  const rainByDate = new Map(inputs.rain.days.map((d) => [d.date, d.mm]));
  const rainOver = (dates: string[]) => {
    let total = 0;
    let effective = 0;
    let reported = 0;
    for (const date of dates) {
      const mm = rainByDate.get(date);
      if (mm == null) continue;
      total += mm;
      effective += effectiveRainMm(mm);
      reported++;
    }
    return { total: round1(total), effective: round1(effective), reported };
  };

  const week = datesEnding(inputs.today, 7);
  const month = datesEnding(inputs.today, 30);
  const demand7 = demandOver(week);
  const demand30 = demandOver(month);
  const rain7 = rainOver(week);
  const rain30 = rainOver(month);

  const zr = rootDepthM(crop, stage);
  const holding = (availableWater: number) => round1(availableWater * 1000 * zr);
  const taw = { low: holding(CLAY_AVAILABLE_WATER.low), high: holding(CLAY_AVAILABLE_WATER.high) };
  const tawMid = CLAY_AVAILABLE_WATER_MID * 1000 * zr;
  const readily = (total: number) => round1(total * crop.depletion_fraction);
  const net7 = round1(Math.max(0, demand7 - rain7.effective));
  const soil = inputs.soil;

  return {
    et0_mm_day: et0,
    et0_source: inputs.et0.source,
    et0_tmax_c: inputs.et0.tmax_c,
    et0_tmin_c: inputs.et0.tmin_c,
    et0_station_hours: inputs.et0.station_hours,
    ra_mm_day: inputs.et0.ra_mm_day,
    regional_et0_mm_day: inputs.regional_et0_mm_day,
    etc_mm_day: etc,
    kc,
    root_depth_m: zr,
    rain_source: inputs.rain.source,
    rain_7d_mm: rain7.total,
    rain_7d_days_with_data: rain7.reported,
    effective_rain_7d_mm: rain7.effective,
    rain_30d_mm: rain30.total,
    rain_30d_days_with_data: rain30.reported,
    demand_7d_mm: demand7,
    demand_7d_station_days: week.filter(fromStation).length,
    balance_7d_mm: round1(rain7.effective - demand7),
    net_irrigation_7d_mm: net7,
    demand_30d_mm: demand30,
    balance_30d_mm: round1(rain30.effective - demand30),
    forecast_rain_48h_mm: inputs.forecast_rain_48h_mm,
    soil_moisture_pct: soil ? round1(soil.value_m3 * 100) : null,
    soil_percentile: soil?.percentile ?? null,
    soil_date: soil?.date ?? null,
    depletion_pct: Math.min(100, Math.round((net7 / tawMid) * 1000) / 10),
    readily_available_mm: readily(tawMid),
    readily_available_range_mm: { low: readily(taw.low), high: readily(taw.high) },
    total_available_range_mm: taw,
  };
}

// Irrigation recommendation

export interface IrrigationAdvice {
  action: IrrigationAction;
  /** Lower end of depth_range_mm, for clients that read one figure (0 when no irrigation is advised) */
  depth_mm: number;
  /** Litres per m² == mm; provided for smallholder framing */
  litres_per_m2: number;
  /** Suggested depth to the nearest 5 mm, a range when the root zone cannot
   * hold the whole shortfall (null when no irrigation is advised) */
  depth_range_mm: MmRange | null;
  reason_keys: string[];
  confidence: Confidence;
}

// A shortfall under 5 mm is within the rounding of the inputs.
export const MIN_IRRIGATION_MM = 5;
// Hold off when the regional forecast has at least this much rain within 48 hours.
export const HOLD_FORECAST_RAIN_MM = 10;
const HIGH_ETC_MM = 4.5;

/** The inputs carry a regional model and a typical soil, so a depth finer
 * than 5 mm would claim more precision than they have. */
export function roundToFiveMm(mm: number): number {
  return Math.round(mm / 5) * 5;
}

/** The shortfall to the nearest 5 mm, but no more than the root zone holds at
 * either end of the clay range: water beyond that drains past the roots. */
export function irrigationDepthRange(shortfallMm: number, holding: MmRange): MmRange {
  return {
    low: roundToFiveMm(Math.min(shortfallMm, holding.low)),
    high: roundToFiveMm(Math.min(shortfallMm, holding.high)),
  };
}

/** HIGH when both the rain and every day's ET₀ come from the station, MODERATE
 * when one of them does, LOW when both come from the regional model. */
export function adviceConfidence(wb: WaterBalance): Confidence {
  const stationRain = wb.rain_source === "station_gauge";
  const stationEt0 = wb.et0_source === "station";
  if (stationRain && stationEt0 && wb.rain_7d_days_with_data === 7 && wb.demand_7d_station_days === 7) return "HIGH";
  if (stationRain || stationEt0) return "MODERATE";
  return "LOW";
}

const capAtModerate = (c: Confidence): Confidence => (c === "HIGH" ? "MODERATE" : c);

export function computeIrrigationAdvice(wb: WaterBalance): IrrigationAdvice {
  const confidence = adviceConfidence(wb);
  const none = { depth_mm: 0, litres_per_m2: 0, depth_range_mm: null };

  if (wb.net_irrigation_7d_mm < MIN_IRRIGATION_MM) {
    return {
      action: "NO_IRRIGATION",
      ...none,
      reason_keys: [
        wb.effective_rain_7d_mm >= wb.demand_7d_mm ? "farm_reason_rain_meets_demand" : "farm_reason_small_shortfall",
      ],
      confidence,
    };
  }

  // The forecast is a regional model, so a hold is never more than moderately sure.
  if (wb.forecast_rain_48h_mm != null && wb.forecast_rain_48h_mm >= HOLD_FORECAST_RAIN_MM) {
    return {
      action: "HOLD_RAIN_EXPECTED",
      ...none,
      reason_keys: ["farm_reason_demand_exceeds_rain", "farm_reason_rain_expected"],
      confidence: capAtModerate(confidence),
    };
  }

  const range = irrigationDepthRange(wb.net_irrigation_7d_mm, wb.total_available_range_mm);
  const reasons = ["farm_reason_demand_exceeds_rain"];
  if (wb.net_irrigation_7d_mm > wb.total_available_range_mm.low) reasons.push("farm_reason_root_zone_cap");
  if (wb.etc_mm_day > HIGH_ETC_MM) reasons.push("farm_reason_high_et");
  if (wb.forecast_rain_48h_mm == null) reasons.push("farm_reason_forecast_unavailable");
  return {
    action: "IRRIGATE_NOW",
    depth_mm: range.low,
    litres_per_m2: range.low,
    depth_range_mm: range,
    reason_keys: reasons,
    confidence: wb.forecast_rain_48h_mm == null ? capAtModerate(confidence) : confidence,
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

// Planting outlook (rain-fed), from the same rain record as the water balance

export interface PlantingOutlook {
  favourable: boolean;
  rain_30d_mm: number;
  rain_source: RainSource;
  /** Days of the 30 with a reading */
  rain_days_with_data: number;
  required_mm: number;
  dry_spell_days: number;
  message_key: string;
}

const LONG_DRY_SPELL_DAYS = 7;

export function evaluatePlantingOutlook(rain: RainRecord, today: string, crop: CropProfile): PlantingOutlook {
  const byDate = new Map(rain.days.map((d) => [d.date, d.mm]));
  const month = datesEnding(today, 30).map((date) => byDate.get(date) ?? null);
  const reported = month.filter((mm): mm is number => mm != null);
  const rain30 = round1(reported.reduce((a, b) => a + b, 0));
  const dry = spellLength(month, false);
  const required = crop.planting_rain_mm;

  // Rain-fed planting favours accumulated moisture plus no long dry spell
  const favourable = rain30 >= required && dry <= LONG_DRY_SPELL_DAYS;

  let key: string;
  if (favourable) key = "farm_plant_favourable";
  else if (rain30 < required && dry > LONG_DRY_SPELL_DAYS) key = "farm_plant_dry";
  else if (rain30 < required) key = "farm_plant_insufficient";
  else key = "farm_plant_dryspell";

  return {
    favourable,
    rain_30d_mm: rain30,
    rain_source: rain.source,
    rain_days_with_data: reported.length,
    required_mm: required,
    dry_spell_days: dry,
    message_key: key,
  };
}

// Crop heat stress (activity-aware, NOT a disease or yield model)

export type HeatStress = "NONE" | "MILD" | "MODERATE" | "SEVERE";

export interface CropStressSignal {
  level: HeatStress;
  /** Peak air temperature used for the assessment */
  peak_temp_c: number;
  /** The station's measured maximum over the last 24 hours, or the regional forecast maximum for today */
  peak_source: Et0Source;
  reason_keys: string[];
}

/**
 * Crop heat-stress signal from the day's peak air temperature, the same Tmax
 * the ET₀ uses. Thresholds reflect widely documented cardinal temperatures for
 * the crops listed above; they are advisory signals, not yield predictions.
 */
export function evaluateCropStress(et0: Et0Estimate, stage: GrowthStage): CropStressSignal {
  const peakTemp = et0.tmax_c;
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

  return { level, peak_temp_c: peakTemp, peak_source: et0.source, reason_keys: reasons };
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
  crop: CropProfile,
  stage: GrowthStage,
  inputs: FarmInputs,
): FarmAdvisory {
  const wb = computeWaterBalance(inputs, crop, stage);

  return {
    crop,
    stage,
    water_balance: wb,
    irrigation: computeIrrigationAdvice(wb),
    spray_window: evaluateSprayWindow(situation),
    planting: evaluatePlantingOutlook(inputs.rain, inputs.today, crop),
    stress: evaluateCropStress(inputs.et0, stage),
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
