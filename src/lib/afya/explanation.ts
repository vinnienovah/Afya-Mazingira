import { FORECAST_METHOD, horizonScores } from "./forecast-engine";
import type {
  SituationResult, ForecastPoint, Lang, RiskLevel, QualityStatus, UncertaintyCategory,
} from "./types";
import { STATES, RISK_META, getActivityProfile, wbgtToRisk } from "./constants";
import { fmtTime, fmtWindow } from "./format";
import { t } from "./i18n";
import { checkGrounding, groundingFromFacts } from "./grounding";

// Deterministic Explanation Engine
// Produces validated explanation facts. The LLM may rewrite for clarity
// but must NOT change any numbers, times, risk categories, or recommendations.

export interface ExplanationFacts {
  state_name_en: string;
  state_name_sw: string;
  state_id: number;
  /** Time of the latest station reading (ISO) */
  observed_at: string;
  current_wbgt: number;
  current_temp: number;
  current_humidity: number;
  rain_observed: boolean;
  /** The station's short-term rain signal, 0 to 1 */
  rain_probability: number;
  forecast_1h: number | null;
  forecast_3h: number | null;
  forecast_6h: number | null;
  forecast_9h: number | null;
  forecast_3h_lower: number | null;
  forecast_3h_upper: number | null;
  peak_time: string | null;
  peak_wbgt: number | null;
  thermal_risk_en: string;
  thermal_risk_sw: string;
  thermal_risk_level: RiskLevel;
  quality: QualityStatus;
  quality_status: QualityStatus;
  quality_flags: string[];
  data_age_minutes: number;
  /** Whose window the best_window fields describe: the situation's default or a plan's own */
  window_source: "situation" | "plan" | null;
  best_window_start: string | null;
  best_window_end: string | null;
  best_window_time_range: string | null;
  best_window_activity: string | null;
  best_window_duration_minutes: number | null;
  best_window_reasons: string[];
  best_window_wbgt_min: number | null;
  best_window_wbgt_max: number | null;
  /** The window's risk band for its own activity */
  best_window_risk: RiskLevel | null;
  best_window_note: "no_daylight_window" | null;
  contributors: {
    key: string;
    label_en: string;
    label_sw: string;
    direction: string;
  }[];
  uncertainty: UncertaintyCategory;
  transition_next_en: string | null;
  transition_next_sw: string | null;
  transition_probability: number | null;
  transition_typical_hours: number | null;
  // Regional and satellite context; null when the source could not be fetched.
  era5_temp_anomaly: number | null;
  era5_humidity_anomaly: number | null;
  chirps_7d_mm: number | null;
  sentinel2_ndvi: number | null;
  sentinel3_lst: number | null;
  model_3h_algorithm: string;
  model_3h_mae: number;
}

/** A plan's own window, so a "Why?" about it is answered about that window. */
export interface PlanWindow {
  start: string;
  end: string;
  activity?: string | null;
  duration_minutes?: number | null;
  reasons?: string[] | null;
}

const CONTRIBUTOR_LABELS: Record<string, { en: string; sw: string }> = {
  usual_daily_change: { en: "the usual change at this time of day", sw: "mabadiliko ya kawaida ya wakati huu wa siku" },
  departure_from_usual: { en: "a return toward the usual level", sw: "kurudi kwenye kiwango cha kawaida" },
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function windowWbgt(series: ForecastPoint[], start: string, end: string): { min: number; max: number } | null {
  const s = Date.parse(start);
  const e = Date.parse(end);
  const values = series
    .filter((p) => {
      const at = Date.parse(p.time);
      return at >= s && at < e;
    })
    .map((p) => p.value);
  if (!values.length) return null;
  return { min: round1(Math.min(...values)), max: round1(Math.max(...values)) };
}

export function buildExplanationFacts(situation: SituationResult, plan?: PlanWindow | null): ExplanationFacts {
  const f = situation;
  const byHorizon = (h: "1h" | "3h" | "6h" | "9h") => f.forecast.find((x) => x.horizon === h) ?? null;
  const f3h = byHorizon("3h");
  const bt = f.best_time;

  // A plan's window replaces the situation's default one-hour window: the
  // question is about the plan, and its times are the ones to check against.
  const window = plan
    ? {
        source: "plan" as const,
        start: plan.start,
        end: plan.end,
        activity: plan.activity ?? null,
        duration: plan.duration_minutes ?? Math.round((Date.parse(plan.end) - Date.parse(plan.start)) / 60_000),
        reasons: plan.reasons ?? [],
      }
    : bt
      ? {
          source: "situation" as const,
          start: bt.recommended.start,
          end: bt.recommended.end,
          activity: bt.activity,
          duration: bt.duration_minutes,
          reasons: bt.recommended.reasons,
        }
      : null;
  const stats = window ? windowWbgt(f.forecast_series, window.start, window.end) : null;
  const windowRisk = window && stats
    ? wbgtToRisk(stats.max, getActivityProfile(window.activity ?? "general").wbgt_caution_offset)
    : null;

  // Regional context is dropped when its source was not reached, rather than
  // passing placeholder numbers on as facts.
  const era5 = f.era5.available === false ? null : f.era5;
  const rain = f.chirps.available === false ? null : f.chirps;

  return {
    state_name_en: STATES[f.state.state_id].name,
    state_name_sw: STATES[f.state.state_id].name_sw,
    state_id: f.state.state_id,
    observed_at: f.current.time,
    current_wbgt: f.current.wbgt_c,
    current_temp: f.current.temperature_c,
    current_humidity: f.current.humidity_pct,
    rain_observed: f.current.rain_observed,
    rain_probability: f.risk.rain_probability,
    forecast_1h: finite(byHorizon("1h")?.value),
    forecast_3h: finite(f3h?.value),
    forecast_6h: finite(byHorizon("6h")?.value),
    forecast_9h: finite(byHorizon("9h")?.value),
    forecast_3h_lower: finite(f3h?.lower),
    forecast_3h_upper: finite(f3h?.upper),
    peak_time: f.expected_peak?.time ?? null,
    peak_wbgt: finite(f.expected_peak?.wbgt_c),
    thermal_risk_en: RISK_META[f.risk.thermal].en,
    thermal_risk_sw: RISK_META[f.risk.thermal].sw,
    thermal_risk_level: f.risk.thermal,
    quality: f.quality.status,
    quality_status: f.quality.status,
    quality_flags: f.quality.flags,
    data_age_minutes: f.quality.freshness_minutes,
    window_source: window?.source ?? null,
    best_window_start: window?.start ?? null,
    best_window_end: window?.end ?? null,
    best_window_time_range: window ? fmtWindow(window.start, window.end) : null,
    best_window_activity: window?.activity ?? null,
    best_window_duration_minutes: window?.duration ?? null,
    best_window_reasons: window?.reasons ?? [],
    best_window_wbgt_min: stats?.min ?? null,
    best_window_wbgt_max: stats?.max ?? null,
    best_window_risk: windowRisk,
    best_window_note: f.best_time_note ?? null,
    contributors: f.contributors.map((c) => {
      const label = CONTRIBUTOR_LABELS[c.feature] ?? {
        en: c.feature.replace(/_/g, " "),
        sw: c.feature.replace(/_/g, " "),
      };
      return { key: c.feature, label_en: label.en, label_sw: label.sw, direction: c.direction };
    }),
    uncertainty: f.risk.uncertainty,
    transition_next_en: f.state.transition_likelihood
      ? STATES[f.state.transition_likelihood.state_id].name
      : null,
    transition_next_sw: f.state.transition_likelihood
      ? STATES[f.state.transition_likelihood.state_id].name_sw
      : null,
    transition_probability: f.state.transition_likelihood?.probability ?? null,
    transition_typical_hours: finite(f.state.transition_likelihood?.typical_hours),
    era5_temp_anomaly: finite(era5?.local_temp_anomaly_c),
    era5_humidity_anomaly: finite(era5?.local_humidity_anomaly),
    chirps_7d_mm: finite(rain?.chirps_7d_mm),
    sentinel2_ndvi: f.sentinel.sentinel2_available ? finite(f.sentinel.sentinel2_ndvi_mean) : null,
    sentinel3_lst: f.sentinel.sentinel3_available ? finite(f.sentinel.sentinel3_lst_c) : null,
    model_3h_algorithm: FORECAST_METHOD,
    model_3h_mae: horizonScores("3h").mae,
  };
}

// Farm advisory facts
// A question asked on the Farm Advisory page needs the crop, stage, irrigation
// decision and spray window, which the situation facts do not carry. The
// advisory is read loosely, field by field, so a change to the farm engine's
// output adds or drops facts instead of breaking the explanation.

export interface FarmFacts {
  /** False when the rainfall and temperature records the water advice needs were not reached */
  water_available: boolean;
  crop_en: string | null;
  crop_sw: string | null;
  stage: string | null;
  irrigation: {
    action: string;
    depth_low_mm: number | null;
    depth_high_mm: number | null;
    days_until_irrigation: number | null;
    reason_keys: string[];
    confidence: string | null;
  } | null;
  spray: { quality: string; reason_keys: string[] } | null;
  stress: { level: string; peak_temp_c: number | null } | null;
  water: {
    etc_mm_day: number | null;
    weekly_requirement_mm: number | null;
    depletion_mm: number | null;
    readily_available_mm: number | null;
    rain_7d_mm: number | null;
    rain_30d_mm: number | null;
  } | null;
  planting: { favourable: boolean | null; rain_30d_mm: number | null; required_mm: number | null } | null;
  field_work_window: { start: string; end: string } | null;
  /** Flat, display-ready facts for the model */
  flat: Record<string, string | number | boolean>;
}

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
}

function asRange(value: unknown): { low: number; high: number } | null {
  const o = asObject(value);
  const low = finite(o?.low);
  const high = finite(o?.high);
  return low !== null && high !== null ? { low, high } : null;
}

/** A reason or message key in the given language; unknown keys are spelled out. */
export function reasonText(lang: Lang, key: string): string {
  const text = t(lang, key);
  if (text !== key) return text;
  return key.replace(/^(?:farm_)?reason_/, "").replace(/_/g, " ");
}

function lowerFirst(text: string): string {
  return text && /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

export function buildFarmExplanationFacts(
  advisory: unknown,
  options: { waterAvailable?: boolean; lang?: Lang } = {},
): FarmFacts {
  const lang = options.lang ?? "en";
  const waterAvailable = options.waterAvailable !== false;
  const a = asObject(advisory) ?? {};
  const crop = asObject(a.crop);
  const flat: Record<string, string | number | boolean> = {};

  // Every plain field of a section becomes a fact; reason and message keys are
  // written out, and a depth range is preferred over a single depth.
  const addSection = (prefix: string, section: Loose | null, skip: string[] = []) => {
    if (!section) return;
    const hasRange = asRange(section.depth_range_mm) !== null;
    for (const [key, value] of Object.entries(section)) {
      if (skip.includes(key)) continue;
      if (hasRange && (key === "depth_mm" || key === "litres_per_m2")) continue;
      const name = `${prefix}_${key}`;
      if (typeof value === "number" && Number.isFinite(value)) flat[name] = value;
      else if (typeof value === "boolean") flat[name] = value;
      else if (typeof value === "string" && value.trim()) {
        flat[name.replace(/_key$/, "")] = /_key$/.test(key) ? reasonText(lang, value) : value;
      } else if (Array.isArray(value) && key.endsWith("_keys")) {
        const keys = asKeys(value);
        if (keys.length) flat[name.replace(/_keys$/, "s")] = keys.map((k) => reasonText(lang, k)).join("; ");
      } else if (asRange(value)) {
        const range = asRange(value)!;
        flat[name] = range.low === range.high ? range.low : `${range.low}–${range.high}`;
      }
    }
  };

  const cropEn = asString(crop?.label_en);
  const cropSw = asString(crop?.label_sw);
  if (cropEn) flat.farm_crop = lang === "sw" && cropSw ? cropSw : cropEn;
  const stage = asString(a.stage);
  if (stage) flat.farm_growth_stage = stage;

  const irrigationIn = waterAvailable ? asObject(a.irrigation) : null;
  const waterIn = waterAvailable ? asObject(a.water_balance) : null;
  const plantingIn = waterAvailable ? asObject(a.planting) : null;
  const sprayIn = asObject(a.spray_window);
  const stressIn = asObject(a.stress);

  addSection("farm_irrigation", irrigationIn);
  addSection("farm", waterIn);
  addSection("farm_spray", sprayIn, ["operation"]);
  addSection("farm_planting", plantingIn);
  addSection("farm_heat_stress", stressIn);
  if (!waterAvailable) flat.farm_water_advice_available = false;

  const fieldWindow = asObject(a.field_work_window);
  const fwStart = asString(fieldWindow?.start);
  const fwEnd = asString(fieldWindow?.end);
  if (fwStart && fwEnd) flat.farm_field_work_window = fmtWindow(fwStart, fwEnd);

  const irrigationAction = asString(irrigationIn?.action);
  const range = asRange(irrigationIn?.depth_range_mm);
  const single = finite(irrigationIn?.depth_mm);

  return {
    water_available: waterAvailable,
    crop_en: cropEn,
    crop_sw: cropSw,
    stage,
    irrigation: irrigationAction
      ? {
          action: irrigationAction,
          depth_low_mm: range?.low ?? (single && single > 0 ? single : null),
          depth_high_mm: range && range.high !== range.low ? range.high : null,
          days_until_irrigation: finite(irrigationIn?.days_until_irrigation),
          reason_keys: asKeys(irrigationIn?.reason_keys),
          confidence: asString(irrigationIn?.confidence),
        }
      : null,
    spray: asString(sprayIn?.quality)
      ? { quality: asString(sprayIn?.quality)!, reason_keys: asKeys(sprayIn?.reason_keys) }
      : null,
    stress: asString(stressIn?.level)
      ? { level: asString(stressIn?.level)!, peak_temp_c: finite(stressIn?.peak_temp_c) }
      : null,
    water: waterIn
      ? {
          etc_mm_day: finite(waterIn.etc_mm_day),
          weekly_requirement_mm: finite(waterIn.weekly_requirement_mm),
          depletion_mm: finite(waterIn.depletion_mm),
          readily_available_mm: finite(waterIn.readily_available_mm),
          rain_7d_mm: finite(waterIn.rain_7d_mm),
          rain_30d_mm: finite(waterIn.rain_30d_mm),
        }
      : null,
    planting: plantingIn
      ? {
          favourable: typeof plantingIn.favourable === "boolean" ? plantingIn.favourable : null,
          rain_30d_mm: finite(plantingIn.rain_30d_mm),
          required_mm: finite(plantingIn.required_mm),
        }
      : null,
    field_work_window: fwStart && fwEnd ? { start: fwStart, end: fwEnd } : null,
    flat,
  };
}

// What the model sees
// Display-ready Africa/Nairobi clock times, units in the key names, and
// nothing that is unavailable. The grounding check reads the same object, so
// the model may state exactly these values and no others.

const UNCERTAINTY_EN: Record<UncertaintyCategory, string> = { LOW: "low", MODERATE: "moderate", HIGH: "high" };
const UNCERTAINTY_SW: Record<UncertaintyCategory, string> = { LOW: "mdogo", MODERATE: "wa wastani", HIGH: "mkubwa" };

export function modelFacts(
  facts: ExplanationFacts,
  lang: Lang,
  farm?: FarmFacts | null,
): Record<string, string | number | boolean> {
  const activity = facts.best_window_activity ? getActivityProfile(facts.best_window_activity) : null;
  const all: Record<string, string | number | boolean | null | undefined> = {
    location: "JKUAT, Juja: Conduit weather station",
    latest_reading_time: fmtTime(facts.observed_at),
    data_age_minutes: facts.data_age_minutes,
    environmental_state_en: facts.state_name_en,
    environmental_state_sw: facts.state_name_sw,
    current_wbgt_shade_c: facts.current_wbgt,
    current_air_temp_c: facts.current_temp,
    current_humidity_pct: facts.current_humidity,
    rain_in_latest_reading: facts.rain_observed,
    short_term_rain_signal_pct: Math.round(facts.rain_probability * 100),
    forecast_wbgt_1h_c: facts.forecast_1h,
    forecast_wbgt_3h_c: facts.forecast_3h,
    forecast_wbgt_3h_range_c:
      facts.forecast_3h_lower !== null && facts.forecast_3h_upper !== null
        ? `${facts.forecast_3h_lower}–${facts.forecast_3h_upper}`
        : null,
    forecast_wbgt_6h_c: facts.forecast_6h,
    forecast_wbgt_9h_c: facts.forecast_9h,
    forecast_uncertainty: lang === "sw" ? UNCERTAINTY_SW[facts.uncertainty] : UNCERTAINTY_EN[facts.uncertainty],
    forecast_3h_typical_error_c: Math.round(facts.model_3h_mae * 100) / 100,
    forecast_method: facts.model_3h_algorithm,
    expected_peak_wbgt_c: facts.peak_wbgt,
    expected_peak_time: facts.peak_time ? fmtTime(facts.peak_time) : null,
    thermal_risk_en: facts.thermal_risk_en,
    thermal_risk_sw: facts.thermal_risk_sw,
    data_quality: facts.quality,
    data_quality_notes: qualityNotes(facts.quality_flags, lang).join("; ") || null,
    main_signals_en: facts.contributors.map((c) => c.label_en).join("; ") || null,
    main_signals_sw: facts.contributors.map((c) => c.label_sw).join("; ") || null,
    likely_next_state_en: facts.transition_next_en,
    likely_next_state_sw: facts.transition_next_sw,
    likely_next_state_share_of_past_changes_pct:
      facts.transition_probability !== null ? Math.round(facts.transition_probability * 100) : null,
    likely_next_state_typical_hours:
      facts.transition_typical_hours !== null ? Math.max(1, Math.round(facts.transition_typical_hours)) : null,
    best_window: facts.best_window_time_range,
    best_window_belongs_to: facts.window_source === "plan" ? "the person's own plan" : null,
    best_window_activity: activity ? (lang === "sw" ? activity.label_sw : activity.label_en) : null,
    best_window_duration_minutes: facts.best_window_duration_minutes,
    best_window_wbgt_range_c:
      facts.best_window_wbgt_min !== null && facts.best_window_wbgt_max !== null
        ? `${facts.best_window_wbgt_min}–${facts.best_window_wbgt_max}`
        : null,
    best_window_risk_en:
      facts.window_source === "plan" && facts.best_window_risk ? RISK_META[facts.best_window_risk].en : null,
    best_window_reasons: facts.best_window_reasons.map((k) => reasonText(lang, k)).join("; ") || null,
    no_window_reason:
      facts.best_window_time_range ? null
        : facts.quality === "POOR" ? "data quality is POOR"
          : facts.best_window_note === "no_daylight_window" ? "no daylight window is left in the forecast"
            : null,
    era5_temp_anomaly_c: facts.era5_temp_anomaly,
    era5_humidity_anomaly_pct: facts.era5_humidity_anomaly,
    rain_last_7_days_mm: facts.chirps_7d_mm,
    sentinel2_ndvi: facts.sentinel2_ndvi,
    sentinel3_land_surface_temp_c: facts.sentinel3_lst,
    ...(farm?.flat ?? {}),
  };
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(all)) {
    if (value !== null && value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

// Question intent
// The written fallback answers the question that was asked, not a fixed overview.

export type QuestionIntent =
  | "overview" | "heat" | "best_time" | "irrigation" | "spray" | "farm" | "rain" | "reliability";

const INTENT_PATTERNS: [QuestionIntent, RegExp][] = [
  ["irrigation", /irrigat|water(?:ing)?\s+(?:my|the|our)\s+(?:crop|maize|beans|kale|tomato|potato|coffee|napier|farm|field|plants?|garden|shamba)|mwagili|umwagiliaji/i],
  ["spray", /spray|pesticide|herbicide|fungicide|nyunyiz|dawa\s+ya\s+(?:wadudu|kuua)/i],
  ["rain", /\brain|\bshowers?\b|mvua/i],
  ["reliability", /reliab|accura|trust|confiden|uncertain|data\s+quality|\bsensors?\b|how\s+sure|kuaminik|uhakika|ubora\s+wa\s+data|sensa|kifaa|makosa/i],
  ["best_time", /best\s+time|when\s+(?:should|can|is|to)|what\s+time|recommended\s+(?:time|window)|\bwindow\b|timing|wakati\s+(?:gani|mzuri|bora|unaopendekezwa)|saa\s+ngapi|\blini\b|dirisha|muda\s+(?:gani|mzuri)/i],
  ["farm", /plant(?:ing)?\b|\bcrops?\b|maize|beans|harvest|\bfarm|shamba|mazao|kupanda|mahindi|maharagwe|kuvuna/i],
  ["heat", /heat|\bhot\b|exposure|temperat|wbgt|warm|outdoor\s+work|outside|joto|kupatwa|\bjua\b|kazi\s+za\s+nje/i],
];

export function detectIntent(question?: string | null, context?: string | null): QuestionIntent {
  const q = (question ?? "").trim();
  if (q) {
    for (const [intent, re] of INTENT_PATTERNS) if (re.test(q)) return intent;
  }
  if (context === "farm") return "farm";
  if (context === "plan") return "best_time";
  return "overview";
}

// Written explanations
// Served when no model is configured, none answers in time, or every answer
// fails the grounding check. Built from the same facts, in both languages.

export type ExplanationMode = "standard" | "plain";

interface TemplateInput {
  facts: ExplanationFacts;
  farm?: FarmFacts | null;
  intent: QuestionIntent;
  mode: ExplanationMode;
}

const PEAK_AHEAD_MS = 15 * 60_000;

/** Whether the forecast peak still lies ahead of the latest reading. */
function peakAhead(f: ExplanationFacts): boolean {
  return !!f.peak_time && Date.parse(f.peak_time) - Date.parse(f.observed_at) > PEAK_AHEAD_MS;
}

function trend(f: ExplanationFacts): "rising" | "falling" | "steady" | null {
  if (f.forecast_3h === null) return null;
  if (f.forecast_3h > f.current_wbgt + 0.4) return "rising";
  if (f.forecast_3h < f.current_wbgt - 0.4) return "falling";
  return "steady";
}

/** Whether the peak falls outside the window and above anything in it. */
function windowAvoidsPeak(f: ExplanationFacts): boolean {
  if (!f.peak_time || f.peak_wbgt === null || f.best_window_wbgt_max === null || !f.best_window_start || !f.best_window_end) {
    return false;
  }
  const at = Date.parse(f.peak_time);
  return (at < Date.parse(f.best_window_start) || at >= Date.parse(f.best_window_end)) && f.peak_wbgt > f.best_window_wbgt_max;
}

const c1 = (v: number) => `${v.toFixed(1)}°C`;
const n1 = (v: number) => v.toFixed(1);

// Data-quality flags in words. Housekeeping flags are left out.
const FLAG_TEXT: Record<string, { en: string; sw: string }> = {
  no_observations: { en: "there are no recent observations", sw: "hakuna vipimo vya hivi karibuni" },
  stale_data: { en: "the latest reading is old", sw: "kipimo cha mwisho ni cha zamani" },
  observation_age_elevated: { en: "the latest reading is later than usual", sw: "kipimo cha mwisho kimechelewa" },
  missing_fields: { en: "some sensor values are missing", sw: "baadhi ya vipimo vya sensa havipo" },
  gaps_filled_recently: { en: "recent gaps in the record were filled in", sw: "mapengo ya hivi karibuni kwenye rekodi yamejazwa" },
  temp_sensor_disagreement: { en: "the station's temperature sensors disagree", sw: "vipima joto vya kituo havikubaliani" },
  humidity_out_of_range: { en: "a humidity reading is out of range", sw: "kipimo cha unyevu kiko nje ya kiwango" },
  temp_out_of_range: { en: "a temperature reading is out of range", sw: "kipimo cha joto kiko nje ya kiwango" },
  station_health_bad: { en: "a sensor group failed the station health checks", sw: "kundi la sensa limeshindwa ukaguzi wa afya ya kituo" },
  regional_context_unavailable: { en: "regional context could not be fetched", sw: "muktadha wa kikanda haukupatikana" },
  forecast_horizon_elapsed: { en: "the forecast is older than its 9-hour horizon", sw: "utabiri umepita kipindi chake cha saa 9" },
};

export function qualityNotes(flags: string[], lang: Lang): string[] {
  const notes = flags
    .map((flag) => FLAG_TEXT[flag.split(":")[0]]?.[lang])
    .filter((note): note is string => !!note);
  return [...new Set(notes)];
}

function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// English

const EN_STATE: Record<number, string> = {
  0: "Conditions are cool and humid, with little sunshine.",
  1: "Temperatures are climbing quickly as humidity falls and the sun strengthens.",
  2: "Conditions are hot, with strong sunshine.",
  3: "Temperatures are easing, humidity is recovering and the sun is fading.",
};

const EN_PLAIN_STATE: Record<number, string> = {
  0: "It is cool and damp outside right now.",
  1: "It is heating up quickly outside right now.",
  2: "It is hot outside right now and the sun is strong.",
  3: "It is starting to cool down outside now.",
};

const EN_RISK_ADVICE: Record<RiskLevel, string> = {
  LOW: "Conditions are currently favourable for most outdoor activities.",
  ELEVATED: "Prolonged or strenuous outdoor activity warrants awareness of thermal exposure.",
  HIGH: "Consider shifting prolonged outdoor activity to a lower-exposure period.",
  VERY_HIGH: "Strenuous outdoor activity should be avoided during peak thermal exposure.",
};

const EN_PLAIN_RISK: Record<RiskLevel, string> = {
  LOW: "It is a comfortable time to be outside for most people.",
  ELEVATED: "If you will be outside for a long time or working hard, take it steady and rest in the shade.",
  HIGH: "Heavy outdoor work or exercise will feel difficult. Try to move it to a cooler time if you can.",
  VERY_HIGH: "This is a hard time for heavy outdoor work. Avoid it during the hottest part of the day if you can.",
};

function templateEn({ facts: f, farm, intent, mode }: TemplateInput): string[] {
  const plain = mode === "plain";
  const risk = RISK_META[f.thermal_risk_level].en;
  const tr = trend(f);
  const range = f.best_window_time_range;
  const peakTime = f.peak_time ? fmtTime(f.peak_time) : null;
  const activity = f.best_window_activity ? getActivityProfile(f.best_window_activity).label_en.toLowerCase() : "outdoor activity";
  const crop = lowerFirst(farm?.crop_en ?? "the crop");

  const state = () => (plain ? EN_PLAIN_STATE[f.state_id] : `The JKUAT station shows ${f.state_name_en} conditions. ${EN_STATE[f.state_id]}`);

  const now = () => `WBGT in the shade is ${c1(f.current_wbgt)} now, with the air at ${c1(f.current_temp)} and humidity at ${Math.round(f.current_humidity)}%.`;

  const forecast = () => {
    if (plain) {
      if (tr === "rising") return "Over the next few hours it is expected to feel hotter.";
      if (tr === "falling") return "Over the next few hours it is expected to feel cooler.";
      if (tr === "steady") return "Conditions are expected to stay much the same for the next few hours.";
      return null;
    }
    if (f.forecast_3h === null) return "The forecast is unavailable right now.";
    const band = f.forecast_3h_lower !== null && f.forecast_3h_upper !== null
      ? ` (range ${n1(f.forecast_3h_lower)}–${c1(f.forecast_3h_upper)}, ${UNCERTAINTY_EN[f.uncertainty]} uncertainty)`
      : "";
    const later = f.forecast_9h !== null ? ` and ${c1(f.forecast_9h)} in 9 hours` : "";
    return `The forecast is ${c1(f.forecast_3h)} in 3 hours${band}${later}.`;
  };

  const heatTrend = () => {
    if (plain || f.forecast_3h === null) return forecast();
    if (tr === "rising") return `WBGT in the shade is ${c1(f.current_wbgt)} now and is forecast to rise to ${c1(f.forecast_3h)} within 3 hours.`;
    if (tr === "falling") return `WBGT in the shade is ${c1(f.current_wbgt)} now and is forecast to ease to ${c1(f.forecast_3h)} within 3 hours.`;
    return `WBGT in the shade is ${c1(f.current_wbgt)} now and should stay near ${c1(f.forecast_3h)} over the next 3 hours.`;
  };

  const peak = () => {
    if (!peakTime || f.peak_wbgt === null) return null;
    if (plain) {
      return peakAhead(f)
        ? `The hardest time to be outside should be around ${peakTime}.`
        : "Right now is about as hot as it will get over the next few hours.";
    }
    return peakAhead(f)
      ? `Exposure has not peaked yet: WBGT should reach ${c1(f.peak_wbgt)} around ${peakTime}.`
      : `Exposure is at about its highest for the next 9 hours now, with WBGT at ${c1(f.peak_wbgt)}.`;
  };

  const riskLine = () => (plain ? EN_PLAIN_RISK[f.thermal_risk_level] : `Thermal exposure risk is ${risk}. ${EN_RISK_ADVICE[f.thermal_risk_level]}`);

  const signals = () => {
    if (plain || !f.contributors.length) return null;
    return `The main signals behind this are that ${f.contributors.map((c) => c.label_en).join(" and ")}.`;
  };

  const transition = () => {
    if (plain || !f.transition_next_en || f.transition_probability === null) return null;
    const hours = f.transition_typical_hours !== null ? Math.max(1, Math.round(f.transition_typical_hours)) : null;
    const after = hours !== null ? `, usually within about ${hours} hour${hours === 1 ? "" : "s"}` : "";
    return `At this time of day this state has most often given way to ${f.transition_next_en} (${Math.round(f.transition_probability * 100)}% of past changes)${after}.`;
  };

  const noWindow = () => {
    if (f.quality === "POOR") return plain ? "No best time can be given while the station data is unreliable." : "No activity window is recommended while data quality is POOR.";
    if (f.best_window_note === "no_daylight_window") return plain ? "There is no good daylight time left in today's forecast." : "No daylight window is left in the forecast for outdoor activity today.";
    return plain ? "No best time can be given right now." : "No activity window can be recommended right now.";
  };

  const window = () => {
    if (!range) return noWindow();
    if (plain) {
      return f.window_source === "plan"
        ? `For your plan, ${range} is the best time.`
        : `If you can choose, ${range} looks like the best time today.`;
    }
    if (f.window_source === "plan") return `Your plan's recommended window is ${range}.`;
    return `The lowest-exposure ${f.best_window_duration_minutes ?? 60}-minute window for ${activity} is ${range}.`;
  };

  const windowWhy = () => {
    if (!range) return [];
    if (plain) {
      return windowAvoidsPeak(f) && peakTime
        ? [`It should feel cooler then than at the hottest time, around ${peakTime}.`]
        : [];
    }
    const lines: string[] = [];
    if (f.best_window_wbgt_min !== null && f.best_window_wbgt_max !== null) {
      const spread = f.best_window_wbgt_min === f.best_window_wbgt_max
        ? `stays at about ${c1(f.best_window_wbgt_max)}`
        : `stays between ${n1(f.best_window_wbgt_min)} and ${c1(f.best_window_wbgt_max)}`;
      const when = peakAhead(f) ? `expected around ${peakTime}` : `at ${peakTime}`;
      const vsPeak = windowAvoidsPeak(f) && peakTime ? `, below the ${c1(f.peak_wbgt!)} peak ${when}` : "";
      lines.push(`Across that window the forecast WBGT ${spread}${vsPeak}.`);
    }
    if (f.window_source === "plan" && f.best_window_risk) {
      lines.push(`For ${activity}, exposure in that window is in the ${RISK_META[f.best_window_risk].en} band.`);
    }
    if (f.best_window_reasons.length) {
      lines.push(`It was chosen because of: ${f.best_window_reasons.map((k) => lowerFirst(reasonText("en", k))).join("; ")}.`);
    }
    return lines;
  };

  const quality = (always: boolean) => {
    if (plain) {
      if (f.quality === "DEGRADED") return "Note: some readings are missing, so this is less certain than usual.";
      if (f.quality === "POOR") return "Note: the station data is not reliable right now, so treat this as a rough guide only.";
      return always ? "The weather station is working normally." : null;
    }
    if (f.quality === "DEGRADED") return "Data quality is DEGRADED, so the forecast range has been widened and recommendations carry more uncertainty.";
    if (f.quality === "POOR") return "Data quality is POOR, so treat these figures with caution.";
    return always ? "Data quality is GOOD." : null;
  };

  const reliability = () => {
    const age = f.data_age_minutes < 2 ? "just in" : `${f.data_age_minutes} minutes old`;
    const notes = qualityNotes(f.quality_flags, "en");
    const mae = f.model_3h_mae.toFixed(2);
    if (plain) {
      return [
        quality(true),
        f.data_age_minutes < 60 ? "The latest reading is recent." : "The latest reading is not recent.",
        `Forecasts a few hours ahead are usually within about ${mae} degrees of what happens.`,
      ];
    }
    return [
      `${quality(true)} The latest station reading is ${age}.`,
      notes.length ? `The checks flag that ${notes.join("; ")}.` : null,
      f.forecast_3h_lower !== null && f.forecast_3h_upper !== null
        ? `The 3-hour forecast carries ${UNCERTAINTY_EN[f.uncertainty]} uncertainty (${n1(f.forecast_3h_lower)}–${c1(f.forecast_3h_upper)}), and the model's tested error at 3 hours is ${mae}°C on average.`
        : `The model's tested error at 3 hours is ${mae}°C on average.`,
    ];
  };

  const rain = () => {
    const pct = Math.round(f.rain_probability * 100);
    const week = farm?.water?.rain_7d_mm ?? f.chirps_7d_mm;
    if (plain) {
      return [
        f.rain_observed ? "It is raining at the station right now." : "It is not raining at the station right now.",
        pct < 20 ? "The chance of rain soon looks low." : pct < 50 ? "There is some chance of rain soon." : "Rain looks likely soon.",
        week !== null ? `About ${n1(week)} mm of rain fell over the last 7 days.` : null,
      ];
    }
    const lines = [
      f.rain_observed ? "The station's latest reading shows rain falling." : "The station's latest reading shows no rain.",
      `Its short-term rain signal, from pressure and humidity, is ${pct}%.`,
      week !== null ? `Rain over the last 7 days: ${n1(week)} mm.` : "Recent rainfall totals are unavailable right now.",
    ];
    const p = farm?.planting;
    if (p && p.rain_30d_mm !== null && p.required_mm !== null) {
      lines.push(`For planting ${crop}, the last 30 days brought ${n1(p.rain_30d_mm)} mm against the ${p.required_mm} mm it needs.`);
    }
    return lines;
  };

  const irrigation = () => {
    const i = farm?.irrigation;
    if (!farm || !farm.water_available || !i) {
      return [plain
        ? "Watering advice is not available right now, because the rain and temperature records it needs could not be fetched."
        : "Irrigation advice is not available right now: the rainfall and temperature records it depends on could not be fetched."];
    }
    const depth = i.depth_low_mm !== null
      ? i.depth_high_mm !== null
        ? plain ? `: about ${i.depth_low_mm} to ${i.depth_high_mm} litres for each square metre` : `, about ${i.depth_low_mm}–${i.depth_high_mm} mm (litres per square metre)`
        : plain ? `: about ${i.depth_low_mm} litres for each square metre` : `, about ${i.depth_low_mm} mm`
      : "";
    const action: Record<string, string> = plain
      ? {
          IRRIGATE_NOW: `Water your ${crop} now${depth}.`,
          HOLD_RAIN_EXPECTED: "Wait before watering: the rain on the way covers most of what the soil needs.",
          NO_IRRIGATION: `Your ${crop} does not need watering now.`,
          DATA_TOO_THIN: "There is not enough rain data to say how dry the soil is. Feel the soil before you water.",
        }
      : {
          IRRIGATE_NOW: `Irrigate ${crop} now${depth}.`,
          HOLD_RAIN_EXPECTED: `Hold off irrigating ${crop}: rain forecast within 48 hours covers most of the refill.`,
          NO_IRRIGATION: `${capitalise(crop)} does not need irrigation now.`,
          DATA_TOO_THIN: `The rain record is too thin to carry a root-zone balance for ${crop}.`,
        };
    const lines = [action[i.action] ?? `The irrigation advice for ${crop} is ${i.action}.`];
    const days = i.days_until_irrigation;
    if (days !== null && i.action === "NO_IRRIGATION") {
      lines.push(plain
        ? days === 1 ? "It should need water tomorrow." : `At today's use it should need water in about ${days} days.`
        : days === 1
          ? "At today's demand the root zone reaches the refill point tomorrow."
          : `At today's demand the root zone reaches the refill point in about ${days} days.`);
    }
    if (!plain) {
      if (i.reason_keys.length) lines.push(`Why: ${i.reason_keys.map((k) => lowerFirst(reasonText("en", k))).join("; ")}.`);
      const w = farm.water;
      if (w && w.depletion_mm !== null && w.readily_available_mm !== null) {
        lines.push(
          `The root zone is ${w.depletion_mm} mm short of full, against a refill point of ${w.readily_available_mm} mm. ` +
            "The balance counts rain, so subtract any water you have already applied.",
        );
      }
      if (w && w.etc_mm_day !== null && w.weekly_requirement_mm !== null && w.rain_7d_mm !== null) {
        lines.push(
          `The crop uses about ${w.etc_mm_day} mm a day, ${w.weekly_requirement_mm} mm over a week, ` +
            `against ${n1(w.rain_7d_mm)} mm of rain in the last 7 days.`,
        );
      }
      if (i.confidence) lines.push(`Confidence: ${i.confidence.toLowerCase()}.`);
    }
    return lines;
  };

  const spray = () => {
    const s = farm?.spray;
    const lines: string[] = [];
    if (s) {
      const reasons = s.reason_keys.map((k) => lowerFirst(reasonText("en", k))).join("; ");
      if (plain) {
        lines.push(s.quality === "GOOD" ? "It is a good time to spray." : s.quality === "AVOID" ? "Do not spray now." : "You can spray, but it is not the best time.");
      } else {
        const verdict = s.quality === "GOOD" ? "good" : s.quality === "AVOID" ? "poor, so avoid spraying now" : "marginal";
        lines.push(`Spraying conditions right now are ${verdict}${reasons ? ` (${reasons})` : ""}.`);
      }
    } else {
      lines.push(plain ? "Spraying advice is not available right now." : "Spray advice is not available right now.");
    }
    if (farm?.field_work_window) {
      const w = fmtWindow(farm.field_work_window.start, farm.field_work_window.end);
      lines.push(plain ? `The best time for field work is ${w}.` : `For field work, the lowest-exposure window is ${w}.`);
    }
    return lines;
  };

  const cropStress = () => {
    const s = farm?.stress;
    if (!s || plain) return null;
    const level: Record<string, string> = { NONE: "none", MILD: "mild", MODERATE: "moderate", SEVERE: "severe" };
    const temp = s.peak_temp_c !== null ? ` (peak air temperature about ${c1(s.peak_temp_c)})` : "";
    return `Crop heat stress: ${level[s.level] ?? s.level.toLowerCase()}${temp}.`;
  };

  switch (intent) {
    case "heat":
      return plain
        ? [state(), forecast(), peak(), riskLine(), range ? window() : null, quality(false)].filter(isText)
        : [heatTrend(), peak(), signals(), riskLine(), range ? window() : null, quality(false)].filter(isText);
    case "best_time":
      return [window(), ...windowWhy(), plain || windowAvoidsPeak(f) ? null : peak(), riskLine(), quality(false)].filter(isText);
    case "irrigation":
      return [...irrigation(), quality(false)].filter(isText);
    case "spray":
      return [...spray(), quality(false)].filter(isText);
    case "farm":
      return [...irrigation(), ...spray(), cropStress(), quality(false)].filter(isText);
    case "rain":
      return rain().filter(isText);
    case "reliability":
      return reliability().filter(isText);
    default:
      return plain
        ? [state(), forecast(), peak(), riskLine(), window(), quality(false)].filter(isText)
        : [state(), now(), forecast(), peak(), riskLine(), transition(), window(), quality(false)].filter(isText);
  }
}

// Kiswahili

const SW_STATE: Record<number, string> = {
  0: "Hali ni ya baridi na unyevu mwingi, na jua ni hafifu.",
  1: "Joto linapanda haraka huku unyevu ukipungua na jua likizidi kuwa kali.",
  2: "Hali ni ya joto, na jua ni kali.",
  3: "Joto linapungua, unyevu unarudi na jua linapungua nguvu.",
};

const SW_PLAIN_STATE: Record<number, string> = {
  0: "Kwa sasa kuna baridi na unyevu nje.",
  1: "Kwa sasa joto linapanda haraka nje.",
  2: "Kwa sasa kuna joto kali nje na jua ni kali.",
  3: "Kwa sasa hali inaanza kupoa nje.",
};

const SW_RISK_ADVICE: Record<RiskLevel, string> = {
  LOW: "Hali inafaa kwa shughuli nyingi za nje.",
  ELEVATED: "Shughuli ndefu au ngumu za nje zinahitaji tahadhari dhidi ya joto.",
  HIGH: "Fikiria kuhamisha shughuli ndefu za nje hadi wakati wenye joto kidogo.",
  VERY_HIGH: "Epuka shughuli ngumu za nje wakati wa kilele cha joto.",
};

const SW_PLAIN_RISK: Record<RiskLevel, string> = {
  LOW: "Ni wakati mzuri wa kuwa nje kwa watu wengi.",
  ELEVATED: "Ukiwa nje kwa muda mrefu au ukifanya kazi ngumu, nenda taratibu na pumzika kivulini.",
  HIGH: "Kazi nzito au mazoezi ya nje yatakuwa magumu. Jaribu kuyahamishia wakati wa baridi zaidi ukiweza.",
  VERY_HIGH: "Huu ni wakati mgumu kwa kazi nzito za nje. Epuka wakati wa joto kali zaidi ukiweza.",
};

const SW_QUALITY: Record<QualityStatus, string> = { GOOD: "NZURI", DEGRADED: "IMEDHOOFIKA", POOR: "MBAYA" };

function templateSw({ facts: f, farm, intent, mode }: TemplateInput): string[] {
  const plain = mode === "plain";
  const risk = RISK_META[f.thermal_risk_level].sw;
  const tr = trend(f);
  const range = f.best_window_time_range;
  const peakTime = f.peak_time ? fmtTime(f.peak_time) : null;
  const activity = f.best_window_activity ? getActivityProfile(f.best_window_activity).label_sw.toLowerCase() : "shughuli za nje";
  const crop = (farm?.crop_sw ?? "zao").toLowerCase();

  const state = () => (plain ? SW_PLAIN_STATE[f.state_id] : `Kituo cha JKUAT kinaonyesha hali ya ${f.state_name_sw}. ${SW_STATE[f.state_id]}`);

  const now = () => `WBGT kivulini ni ${c1(f.current_wbgt)} sasa, joto la hewa ni ${c1(f.current_temp)} na unyevu ni ${Math.round(f.current_humidity)}%.`;

  const forecast = () => {
    if (plain) {
      if (tr === "rising") return "Katika saa chache zijazo, inatarajiwa kuhisi joto zaidi.";
      if (tr === "falling") return "Katika saa chache zijazo, inatarajiwa kuhisi baridi zaidi.";
      if (tr === "steady") return "Hali inatarajiwa kubaki hivyo hivyo kwa saa chache zijazo.";
      return null;
    }
    if (f.forecast_3h === null) return "Utabiri haupatikani kwa sasa.";
    const band = f.forecast_3h_lower !== null && f.forecast_3h_upper !== null
      ? ` (kati ya ${n1(f.forecast_3h_lower)} na ${c1(f.forecast_3h_upper)}, utata ${UNCERTAINTY_SW[f.uncertainty]})`
      : "";
    const later = f.forecast_9h !== null ? ` na ${c1(f.forecast_9h)} baada ya saa 9` : "";
    return `Utabiri ni ${c1(f.forecast_3h)} baada ya saa 3${band}${later}.`;
  };

  const heatTrend = () => {
    if (plain || f.forecast_3h === null) return forecast();
    if (tr === "rising") return `WBGT kivulini ni ${c1(f.current_wbgt)} sasa na inatarajiwa kupanda hadi ${c1(f.forecast_3h)} ndani ya saa 3.`;
    if (tr === "falling") return `WBGT kivulini ni ${c1(f.current_wbgt)} sasa na inatarajiwa kushuka hadi ${c1(f.forecast_3h)} ndani ya saa 3.`;
    return `WBGT kivulini ni ${c1(f.current_wbgt)} sasa na inatarajiwa kubaki karibu ${c1(f.forecast_3h)} kwa saa 3 zijazo.`;
  };

  const peak = () => {
    if (!peakTime || f.peak_wbgt === null) return null;
    if (plain) {
      return peakAhead(f)
        ? `Wakati mgumu zaidi wa kuwa nje unatarajiwa kuwa karibu saa ${peakTime}.`
        : "Kwa sasa joto liko karibu na kiwango chake cha juu zaidi kwa saa chache zijazo.";
    }
    return peakAhead(f)
      ? `Kupatwa na joto bado hakujafika kilele: WBGT inatarajiwa kufika ${c1(f.peak_wbgt)} karibu saa ${peakTime}.`
      : `Kupatwa na joto kuko karibu na kiwango chake cha juu zaidi cha saa 9 zijazo sasa, WBGT ikiwa ${c1(f.peak_wbgt)}.`;
  };

  const riskLine = () => (plain ? SW_PLAIN_RISK[f.thermal_risk_level] : `Hatari ya kupatwa na joto ni ${risk}. ${SW_RISK_ADVICE[f.thermal_risk_level]}`);

  const signals = () => {
    if (plain || !f.contributors.length) return null;
    return `Ishara kuu ni kwamba ${f.contributors.map((c) => c.label_sw).join(" na ")}.`;
  };

  const transition = () => {
    if (plain || !f.transition_next_sw || f.transition_probability === null) return null;
    const hours = f.transition_typical_hours !== null ? Math.max(1, Math.round(f.transition_typical_hours)) : null;
    const after = hours !== null ? `, kwa kawaida ndani ya takriban saa ${hours}` : "";
    return `Wakati huu wa siku, hali hii mara nyingi imefuatiwa na ${f.transition_next_sw} (${Math.round(f.transition_probability * 100)}% ya mabadiliko yaliyopita)${after}.`;
  };

  const noWindow = () => {
    if (f.quality === "POOR") return plain ? "Hatuwezi kutoa wakati bora wakati data ya kituo si ya kuaminika." : "Hakuna dirisha linalopendekezwa wakati ubora wa data ni MBAYA.";
    if (f.best_window_note === "no_daylight_window") return plain ? "Hakuna wakati mzuri wa mchana uliobaki katika utabiri wa leo." : "Hakuna dirisha la mchana lililobaki katika utabiri kwa shughuli za nje leo.";
    return plain ? "Hatuwezi kutoa wakati bora kwa sasa." : "Hakuna dirisha linaloweza kupendekezwa kwa sasa.";
  };

  const window = () => {
    if (!range) return noWindow();
    if (plain) {
      return f.window_source === "plan"
        ? `Kwa mpango wako, ${range} ndio wakati mzuri zaidi.`
        : `Ukiwa na uchaguzi, ${range} inaonekana ndio wakati mzuri zaidi leo.`;
    }
    if (f.window_source === "plan") return `Dirisha linalopendekezwa kwa mpango wako ni ${range}.`;
    return `Dirisha la dakika ${f.best_window_duration_minutes ?? 60} lenye kupatwa na joto kidogo zaidi kwa ${activity} ni ${range}.`;
  };

  const windowWhy = () => {
    if (!range) return [];
    if (plain) {
      return windowAvoidsPeak(f) && peakTime
        ? [`Wakati huo kunatarajiwa kuwa na joto kidogo kuliko wakati wa joto kali zaidi, karibu saa ${peakTime}.`]
        : [];
    }
    const lines: string[] = [];
    if (f.best_window_wbgt_min !== null && f.best_window_wbgt_max !== null) {
      const spread = f.best_window_wbgt_min === f.best_window_wbgt_max
        ? `unabaki karibu ${c1(f.best_window_wbgt_max)}`
        : `unabaki kati ya ${n1(f.best_window_wbgt_min)} na ${c1(f.best_window_wbgt_max)}`;
      const when = peakAhead(f) ? `kinachotarajiwa karibu saa ${peakTime}` : `cha saa ${peakTime}`;
      const vsPeak = windowAvoidsPeak(f) && peakTime ? `, chini ya kilele cha ${c1(f.peak_wbgt!)} ${when}` : "";
      lines.push(`Katika dirisha hilo, utabiri wa WBGT ${spread}${vsPeak}.`);
    }
    if (f.window_source === "plan" && f.best_window_risk) {
      lines.push(`Kwa ${activity}, kupatwa na joto katika dirisha hilo kuko katika kiwango cha ${RISK_META[f.best_window_risk].sw}.`);
    }
    if (f.best_window_reasons.length) {
      lines.push(`Limechaguliwa kwa sababu: ${f.best_window_reasons.map((k) => lowerFirst(reasonText("sw", k))).join("; ")}.`);
    }
    return lines;
  };

  const quality = (always: boolean) => {
    if (plain) {
      if (f.quality === "DEGRADED") return "Kumbuka: baadhi ya vipimo havipo, hivyo hii si ya uhakika kama kawaida.";
      if (f.quality === "POOR") return "Kumbuka: data ya kituo si ya kuaminika sasa hivi, hivyo chukua hii kama mwongozo wa jumla tu.";
      return always ? "Kituo cha hali ya hewa kinafanya kazi vizuri." : null;
    }
    if (f.quality === "DEGRADED") return `Ubora wa data: ${SW_QUALITY.DEGRADED}. Kipindi cha utabiri kimepanuliwa, hivyo mapendekezo si ya uhakika sana.`;
    if (f.quality === "POOR") return `Ubora wa data: ${SW_QUALITY.POOR}. Tumia takwimu hizi kwa tahadhari.`;
    return always ? `Ubora wa data: ${SW_QUALITY.GOOD}.` : null;
  };

  const reliability = () => {
    const age = f.data_age_minutes < 2 ? "Kipimo cha mwisho cha kituo ni cha sasa hivi." : `Kipimo cha mwisho cha kituo kina umri wa dakika ${f.data_age_minutes}.`;
    const notes = qualityNotes(f.quality_flags, "sw");
    const mae = f.model_3h_mae.toFixed(2);
    if (plain) {
      return [
        quality(true),
        f.data_age_minutes < 60 ? "Kipimo cha mwisho ni cha hivi karibuni." : "Kipimo cha mwisho si cha hivi karibuni.",
        `Utabiri wa saa chache mbele kwa kawaida hukosea kwa takriban nyuzi ${mae} tu.`,
      ];
    }
    return [
      `${quality(true)} ${age}`,
      notes.length ? `Ukaguzi umebaini kwamba ${notes.join("; ")}.` : null,
      f.forecast_3h_lower !== null && f.forecast_3h_upper !== null
        ? `Utabiri wa saa 3 una utata ${UNCERTAINTY_SW[f.uncertainty]} (kati ya ${n1(f.forecast_3h_lower)} na ${c1(f.forecast_3h_upper)}), na kosa la wastani la mfumo lililopimwa kwa saa 3 ni ${mae}°C.`
        : `Kosa la wastani la mfumo lililopimwa kwa saa 3 ni ${mae}°C.`,
    ];
  };

  const rain = () => {
    const pct = Math.round(f.rain_probability * 100);
    const week = farm?.water?.rain_7d_mm ?? f.chirps_7d_mm;
    if (plain) {
      return [
        f.rain_observed ? "Mvua inanyesha kwenye kituo kwa sasa." : "Hakuna mvua kwenye kituo kwa sasa.",
        pct < 20 ? "Uwezekano wa mvua hivi karibuni ni mdogo." : pct < 50 ? "Kuna uwezekano wa wastani wa mvua hivi karibuni." : "Kuna uwezekano mkubwa wa mvua hivi karibuni.",
        week !== null ? `Takriban milimita ${n1(week)} za mvua zilinyesha katika siku 7 zilizopita.` : null,
      ];
    }
    const lines = [
      f.rain_observed ? "Kipimo cha mwisho cha kituo kinaonyesha mvua ikinyesha." : "Kipimo cha mwisho cha kituo hakionyeshi mvua.",
      `Ishara ya mvua ya muda mfupi, kutokana na shinikizo la hewa na unyevu, ni ${pct}%.`,
      week !== null ? `Mvua ya siku 7 zilizopita: milimita ${n1(week)}.` : "Takwimu za mvua ya hivi karibuni hazipatikani kwa sasa.",
    ];
    const p = farm?.planting;
    if (p && p.rain_30d_mm !== null && p.required_mm !== null) {
      lines.push(`Kwa kupanda ${crop}, siku 30 zilizopita zilileta milimita ${n1(p.rain_30d_mm)} dhidi ya milimita ${p.required_mm} zinazohitajika.`);
    }
    return lines;
  };

  const irrigation = () => {
    const i = farm?.irrigation;
    if (!farm || !farm.water_available || !i) {
      return [plain
        ? "Ushauri wa kumwagilia haupatikani kwa sasa, kwa sababu rekodi za mvua na joto zinazohitajika hazikupatikana."
        : "Ushauri wa umwagiliaji haupatikani kwa sasa: rekodi za mvua na joto unazotegemea hazikupatikana."];
    }
    const depth = i.depth_low_mm !== null
      ? i.depth_high_mm !== null
        ? plain ? `: takriban lita ${i.depth_low_mm} hadi ${i.depth_high_mm} kwa kila mita ya mraba` : `, takriban milimita ${i.depth_low_mm}–${i.depth_high_mm} (lita kwa kila mita ya mraba)`
        : plain ? `: takriban lita ${i.depth_low_mm} kwa kila mita ya mraba` : `, takriban milimita ${i.depth_low_mm}`
      : "";
    const action: Record<string, string> = plain
      ? {
          IRRIGATE_NOW: `Mwagilia ${crop} sasa${depth}.`,
          HOLD_RAIN_EXPECTED: "Subiri kwanza kabla ya kumwagilia: mvua inayokuja inafunika sehemu kubwa ya maji yanayohitajika.",
          NO_IRRIGATION: `Hakuna haja ya kumwagilia ${crop} kwa sasa.`,
          DATA_TOO_THIN: "Takwimu za mvua hazitoshi kujua ukavu wa udongo. Gusa udongo kwanza kabla ya kumwagilia.",
        }
      : {
          IRRIGATE_NOW: `Mwagilia ${crop} sasa${depth}.`,
          HOLD_RAIN_EXPECTED: `Subiri kabla ya kumwagilia ${crop}: mvua inayotabiriwa ndani ya saa 48 inafunika sehemu kubwa ya maji yanayohitajika.`,
          NO_IRRIGATION: `Hakuna haja ya kumwagilia ${crop} kwa sasa.`,
          DATA_TOO_THIN: `Rekodi ya mvua haitoshi kuendesha mizani ya eneo la mizizi kwa ${crop}.`,
        };
    const lines = [action[i.action] ?? `Ushauri wa umwagiliaji kwa ${crop} ni ${i.action}.`];
    const days = i.days_until_irrigation;
    if (days !== null && i.action === "NO_IRRIGATION") {
      lines.push(days === 1
        ? "Kwa mahitaji ya leo, eneo la mizizi litafikia kiwango cha kumwagilia kesho."
        : `Kwa mahitaji ya leo, eneo la mizizi litafikia kiwango cha kumwagilia baada ya takriban siku ${days}.`);
    }
    if (!plain) {
      if (i.reason_keys.length) lines.push(`Sababu: ${i.reason_keys.map((k) => lowerFirst(reasonText("sw", k))).join("; ")}.`);
      const w = farm.water;
      if (w && w.depletion_mm !== null && w.readily_available_mm !== null) {
        lines.push(
          `Eneo la mizizi lina upungufu wa milimita ${w.depletion_mm} dhidi ya kiwango cha kumwagilia cha milimita ${w.readily_available_mm}. ` +
            "Mizani inahesabu mvua, hivyo toa maji uliyoweka tayari.",
        );
      }
      if (w && w.etc_mm_day !== null && w.weekly_requirement_mm !== null && w.rain_7d_mm !== null) {
        lines.push(
          `Zao linatumia takriban milimita ${w.etc_mm_day} kwa siku, milimita ${w.weekly_requirement_mm} kwa wiki, ` +
            `dhidi ya milimita ${n1(w.rain_7d_mm)} za mvua katika siku 7 zilizopita.`,
        );
      }
      const confidence: Record<string, string> = { LOW: "mdogo", MODERATE: "wa wastani", HIGH: "mkubwa" };
      if (i.confidence) lines.push(`Uhakika: ${confidence[i.confidence] ?? i.confidence.toLowerCase()}.`);
    }
    return lines;
  };

  const spray = () => {
    const s = farm?.spray;
    const lines: string[] = [];
    if (s) {
      const reasons = s.reason_keys.map((k) => lowerFirst(reasonText("sw", k))).join("; ");
      if (plain) {
        lines.push(s.quality === "GOOD" ? "Ni wakati mzuri wa kunyunyizia dawa." : s.quality === "AVOID" ? "Usinyunyizie dawa sasa." : "Unaweza kunyunyizia dawa, lakini si wakati bora.");
      } else {
        const verdict = s.quality === "GOOD" ? "nzuri" : s.quality === "AVOID" ? "mbaya, hivyo usinyunyizie sasa" : "ya wastani";
        lines.push(`Hali ya kunyunyizia dawa kwa sasa ni ${verdict}${reasons ? ` (${reasons})` : ""}.`);
      }
    } else {
      lines.push("Ushauri wa kunyunyizia dawa haupatikani kwa sasa.");
    }
    if (farm?.field_work_window) {
      const w = fmtWindow(farm.field_work_window.start, farm.field_work_window.end);
      lines.push(plain ? `Wakati mzuri wa kazi za shambani ni ${w}.` : `Kwa kazi za shambani, dirisha lenye kupatwa na joto kidogo zaidi ni ${w}.`);
    }
    return lines;
  };

  const cropStress = () => {
    const s = farm?.stress;
    if (!s || plain) return null;
    const level: Record<string, string> = { NONE: "hakuna", MILD: "mdogo", MODERATE: "wa wastani", SEVERE: "mkubwa" };
    const temp = s.peak_temp_c !== null ? ` (joto la juu la hewa takriban ${c1(s.peak_temp_c)})` : "";
    return `Msongo wa joto kwa zao: ${level[s.level] ?? s.level.toLowerCase()}${temp}.`;
  };

  switch (intent) {
    case "heat":
      return plain
        ? [state(), forecast(), peak(), riskLine(), range ? window() : null, quality(false)].filter(isText)
        : [heatTrend(), peak(), signals(), riskLine(), range ? window() : null, quality(false)].filter(isText);
    case "best_time":
      return [window(), ...windowWhy(), plain || windowAvoidsPeak(f) ? null : peak(), riskLine(), quality(false)].filter(isText);
    case "irrigation":
      return [...irrigation(), quality(false)].filter(isText);
    case "spray":
      return [...spray(), quality(false)].filter(isText);
    case "farm":
      return [...irrigation(), ...spray(), cropStress(), quality(false)].filter(isText);
    case "rain":
      return rain().filter(isText);
    case "reliability":
      return reliability().filter(isText);
    default:
      return plain
        ? [state(), forecast(), peak(), riskLine(), window(), quality(false)].filter(isText)
        : [state(), now(), forecast(), peak(), riskLine(), transition(), window(), quality(false)].filter(isText);
  }
}

function isText(line: string | null | undefined): line is string {
  return !!line;
}

export function templateExplanation(input: TemplateInput & { lang: Lang }): string {
  return (input.lang === "sw" ? templateSw(input) : templateEn(input)).join(" ");
}

export function deterministicExplanationEn(facts: ExplanationFacts): string {
  return templateExplanation({ facts, intent: "overview", mode: "standard", lang: "en" });
}

export function deterministicExplanationSw(facts: ExplanationFacts): string {
  return templateExplanation({ facts, intent: "overview", mode: "standard", lang: "sw" });
}

export function plainExplanationEn(facts: ExplanationFacts): string {
  return templateExplanation({ facts, intent: "overview", mode: "plain", lang: "en" });
}

export function plainExplanationSw(facts: ExplanationFacts): string {
  return templateExplanation({ facts, intent: "overview", mode: "plain", lang: "sw" });
}

// LLM Communication Layer

const LLM_SYSTEM_PROMPT_EN = `You are the AFYA MAZINGIRA communication layer. Your ONLY job is to explain validated environmental intelligence results in plain, natural language. You must NEVER invent sensor values, forecast values, risk levels, thresholds, causes, or medical advice. You may ONLY use the structured facts provided in the JSON input. Preserve every number, time, risk category, and recommendation exactly as given. Do not add weather forecasts of your own. Do not diagnose illness. If the structured facts show data quality is POOR, acknowledge limitations. Write in clear, helpful English suitable for a general audience.`;

// Plain-language prompts
// Same validated facts, same grounding rules, only the reading level changes.
// Intended for farmers, outdoor workers, vendors, students and the general public.

const PLAIN_SYSTEM_PROMPT_EN = `You are the AFYA MAZINGIRA communication layer, writing for someone with no scientific or technical background, for example a farmer, a construction worker, a market vendor or a student.

Rules for how you write:
- Use short, everyday sentences. Aim for about 60-90 words total.
- Do NOT use technical words such as WBGT, forecast horizon, uncertainty interval, model contributor, radiation, humidity percentage, or data quality. Say things like "how hot it feels", "we expect", "we are less sure", or "the sensor is working normally" instead.
- Do not show numbers with units unless they are helpful. Prefer plain descriptions such as "hotter than now" or "cooler in the evening".
- Speak directly to the reader using "you".
- Lead with what is happening, then what it means for being outside, then the best time to do outdoor work or exercise.

Rules you must never break:
- Use ONLY the supplied structured facts. Never invent readings, times, categories or advice.
- If you state a time, copy it exactly as supplied.
- Never give medical advice and never diagnose illness.
- If data quality is not good, say plainly that the information is less reliable right now.`;

const PLAIN_SYSTEM_PROMPT_SW = `Wewe ni safu ya mawasiliano ya AFYA MAZINGIRA, unaandika kwa mtu asiye na elimu ya kisayansi au kiufundi, kwa mfano mkulima, mfanyakazi wa ujenzi, muuzaji sokoni au mwanafunzi.

Kanuni za jinsi ya kuandika:
- Tumia sentensi fupi za kila siku. Lenga maneno 60-90 kwa jumla.
- USITUMIE maneno ya kiufundi kama WBGT, kipindi cha utabiri, kipimo cha utata, kichangiaji cha mfumo, mionzi, au asilimia ya unyevu. Badala yake sema "jinsi joto linavyohisi", "tunatarajia", "hatuna uhakika sana", au "kifaa kinafanya kazi vizuri".
- Usionyeshe namba zenye vipimo isipokuwa zinasaidia kweli. Tumia maelezo rahisi kama "joto zaidi kuliko sasa" au "baridi jioni".
- Ongea na msomaji moja kwa moja ukitumia "wewe".
- Anza na kinachotokea, kisha maana yake kwa kuwa nje, kisha wakati mzuri wa kufanya kazi za nje au mazoezi.

Kanuni usizovunja kamwe:
- Tumia TU ukweli uliowekwa. Usibuni vipimo, nyakati, viwango au ushauri.
- Ukitaja wakati, nakili kama ulivyopewa hasa.
- Usitoe ushauri wa matibabu wala kutambua ugonjwa.
- Ikiwa ubora wa data si mzuri, sema wazi kwamba taarifa si za kuaminika sana kwa sasa.`;

const LLM_SYSTEM_PROMPT_SW = `Wewe ni safu ya mawasiliano ya AFYA MAZINGIRA. Kazi yako PEKEE ni kueleza matokeo ya ujasusi wa mazingira yaliyothibitishwa kwa lugha rahisi na ya asili. HAUPASWI kamwe kubuni thamani za sensa, thamani za utabiri, viwango vya hatari, viwango vya kiwango, sababu, au ushauri wa matibabu. Unaweza TU kutumia ukweli uliowekwa katika ingizo la JSON. Hifadhi kila namba, wakati, kiwango cha hatari, na mapendekezo kama ilivyopewa. Usiongeze utabiri wa hali ya hewa wako mwenyewe. Usiugue ugonjwa. Ikiwa ukweli uliowekwa unaonyesha ubora wa data ni MBAYA, tambua mapungufu. Andika kwa Kiswahili safi kinachofaa hadhira ya jumla.`;

const PLAIN_PROMPT_TEMPLATE = (factsJson: string, userQuestion: string | null, lang: Lang) =>
  `Validated AFYA MAZINGIRA facts (for your reference only, do not repeat the field names):\n${factsJson}\n\n` +
  (userQuestion
    ? `The person asked: "${userQuestion}"\n\n` +
      `Answer THAT specific question first and directly. Pull in only the facts that are actually relevant to it, ` +
      `do not recite every field in the JSON if they weren't asked about it. ` +
      `If the question asks about a change (e.g. "what changed since morning"), compare the relevant before/after facts you were given rather than just restating the current state. ` +
      `If the facts don't contain what's needed to answer, say so briefly instead of padding with unrelated facts.\n\n`
    : `Give a brief overview of the current situation.\n\n`) +
  `Explain this ${lang === "sw" ? "in simple Kiswahili" : "in simple English"} for someone with no technical background. ` +
  `Maximum 90 words. Short everyday sentences. No technical terms and no field names. ` +
  `If you mention a clock time, copy it exactly as supplied, in 24-hour HH:MM form. ` +
  `If a best window exists, tell them plainly when it is. ` +
  `Do not mention that you are an AI.`;

const STRUCTURED_PROMPT_TEMPLATE = (factsJson: string, userQuestion: string | null, lang: Lang) =>
  `Structured AFYA MAZINGIRA validated facts:\n${factsJson}\n\n` +
  (userQuestion
    ? `User question: "${userQuestion}"\n\n` +
      `Answer THAT specific question first and directly, in your own words. Select only the facts relevant to what was asked, ` +
      `do not dump every field in the JSON regardless of relevance; that produces a repetitive, unhelpful answer. ` +
      `If the question is about change over time (e.g. "what changed", "what's different now"), reason about the trend/trajectory facts you were given (current vs. forecast horizons, likely next state) rather than just listing the current snapshot again. ` +
      `If the supplied facts don't actually contain an answer to the question, say so briefly rather than substituting an unrelated fact dump.\n\n`
    : `Give a concise overview of the current situation.\n\n`) +
  `Respond ${lang === "sw" ? "in Kiswahili" : "in English"}. Be concise (max 150 words). ` +
  `Reference only the supplied facts. Do not invent numbers. ` +
  `When using a numeric fact, copy it exactly with the supplied decimal precision; never round, derive, or convert it. ` +
  `If you cannot copy a number exactly, omit that number and explain the qualitative signal instead. ` +
  `Write clock times exactly as supplied, in 24-hour HH:MM form. ` +
  `Use plain language. Only mention best_window if the question is about timing/best-time or no question was asked. ` +
  `Do not add disclaimers about being an AI.`;

export type ExplanationProvider = "gemini" | "groq" | "openai" | "anthropic" | "deterministic";
export type LlmProvider = Exclude<ExplanationProvider, "deterministic">;

/** One model behind the explanation: returns the reply text, honouring the abort signal. */
export interface ProviderSpec {
  name: LlmProvider;
  run: (systemPrompt: string, userPrompt: string, signal: AbortSignal) => Promise<string>;
}

/** The providers with credentials, in the order they are tried. */
export function configuredProviders(): ProviderSpec[] {
  const all: (ProviderSpec | false)[] = [
    !!process.env.GEMINI_API_KEY && { name: "gemini", run: generateWithGemini },
    !!process.env.GROQ_API_KEY && { name: "groq", run: generateWithGroq },
    !!process.env.OPENAI_API_KEY && { name: "openai", run: generateWithOpenAI },
    !!process.env.LLM_API_KEY && { name: "anthropic", run: generateWithAnthropic },
  ];
  return all.filter((p): p is ProviderSpec => !!p);
}

// One slow provider must not use up the whole answer: each gets at most
// PROVIDER_TIMEOUT_MS, and none is started once the budget is nearly spent.
export const PROVIDER_TIMEOUT_MS = 4_500;
export const EXPLANATION_BUDGET_MS = 8_000;
const MIN_ATTEMPT_MS = 1_000;

export interface ExplanationRequest {
  situation: SituationResult;
  lang: Lang;
  question?: string | null;
  mode?: ExplanationMode;
  context?: string | null;
  forceFallback?: boolean;
  farm?: FarmFacts | null;
  plan?: PlanWindow | null;
  providers?: ProviderSpec[];
  budgetMs?: number;
  providerTimeoutMs?: number;
}

export interface ExplanationResult {
  text: string;
  source: "llm" | "deterministic";
  provider: ExplanationProvider;
  mode: ExplanationMode;
  intent: QuestionIntent;
  facts: ExplanationFacts;
}

/**
 * Call the configured communication providers in order:
 * Gemini → Groq (free-tier) → OpenAI → legacy Anthropic → deterministic template.
 * This is the ONLY code path that interfaces with a generative model.
 * Scientific outputs have already been calculated and validated upstream.
 */
export async function generateExplanation(req: ExplanationRequest): Promise<ExplanationResult> {
  const mode = req.mode ?? "standard";
  const facts = buildExplanationFacts(req.situation, req.plan);
  const intent = detectIntent(req.question, req.context);
  const fallback: ExplanationResult = {
    text: templateExplanation({ facts, farm: req.farm, intent, mode, lang: req.lang }),
    source: "deterministic",
    provider: "deterministic",
    mode,
    intent,
    facts,
  };
  if (req.forceFallback) return fallback;

  const shown = modelFacts(facts, req.lang, req.farm);
  const risks = [facts.thermal_risk_level];
  if (facts.window_source === "plan" && facts.best_window_risk) risks.push(facts.best_window_risk);
  const grounding = groundingFromFacts(shown, risks, facts.quality, req.question);
  const factsJson = JSON.stringify(shown, null, 2);
  const systemPrompt = mode === "plain"
    ? (req.lang === "sw" ? PLAIN_SYSTEM_PROMPT_SW : PLAIN_SYSTEM_PROMPT_EN)
    : (req.lang === "sw" ? LLM_SYSTEM_PROMPT_SW : LLM_SYSTEM_PROMPT_EN);
  const userPrompt = mode === "plain"
    ? PLAIN_PROMPT_TEMPLATE(factsJson, req.question ?? null, req.lang)
    : STRUCTURED_PROMPT_TEMPLATE(factsJson, req.question ?? null, req.lang);

  const deadline = Date.now() + (req.budgetMs ?? EXPLANATION_BUDGET_MS);
  const perProvider = req.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;

  for (const provider of req.providers ?? configuredProviders()) {
    const remaining = deadline - Date.now();
    if (remaining < Math.min(MIN_ATTEMPT_MS, perProvider)) break;
    const timeoutMs = Math.min(perProvider, remaining);
    try {
      const text = (await withTimeout(
        provider.run(systemPrompt, userPrompt, AbortSignal.timeout(timeoutMs)),
        timeoutMs,
      )).trim();
      const verdict = checkGrounding(text, grounding);
      if (verdict.ok) return { ...fallback, text, source: "llm", provider: provider.name };
      // Only the reason is logged, never the prompt or the reply.
      console.warn(`[afya-ai] ${provider.name} reply rejected: ${verdict.reason}`);
    } catch (error) {
      // Provider failure is non-fatal and must never block deterministic science.
      // Log only provider + status/message; credentials and prompts are never logged.
      console.warn(
        `[afya-ai] ${provider.name} unavailable:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  return fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface StructuredExplanation {
  explanation: string;
}

const EXPLANATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    explanation: {
      type: "string",
      description: "A concise explanation using only the supplied validated AFYA MAZINGIRA facts.",
    },
  },
  required: ["explanation"],
} as const;

async function generateWithGemini(systemPrompt: string, userPrompt: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 420,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { explanation: { type: "STRING" } },
            required: ["explanation"],
          },
        },
      }),
      signal,
    },
  );

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseStructuredExplanation(raw);
}

async function generateWithGroq(systemPrompt: string, userPrompt: string, signal: AbortSignal): Promise<string> {
  // Free-tier fallback: Groq-hosted open-weight model, OpenAI-compatible API.
  // It is a reasoning model and its reasoning counts against max_tokens, so
  // reasoning is kept short and the limit leaves room for the answer.
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY!}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
      max_tokens: 900,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${systemPrompt}\nRespond with JSON only: {"explanation": "..."}.`,
        },
        { role: "user", content: userPrompt },
      ],
    }),
    signal,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseStructuredExplanation(data.choices?.[0]?.message?.content);
}

async function generateWithOpenAI(systemPrompt: string, userPrompt: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: 420,
      temperature: 0.1,
      text: {
        format: {
          type: "json_schema",
          name: "afya_hewa_explanation",
          strict: true,
          schema: EXPLANATION_SCHEMA,
        },
      },
    }),
    signal,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as {
    output_text?: string;
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };
  const raw =
    data.output_text ??
    data.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")
      ?.text;
  return parseStructuredExplanation(raw);
}

async function generateWithAnthropic(systemPrompt: string, userPrompt: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.LLM_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 420,
      temperature: 0.1,
      system: `${systemPrompt}\nReturn JSON only with one string field named explanation.`,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  return parseStructuredExplanation(data.content?.find((p) => p.type === "text")?.text);
}

function parseStructuredExplanation(raw: string | undefined): string {
  if (!raw) throw new Error("empty response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid structured response");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("explanation" in parsed) ||
    typeof (parsed as StructuredExplanation).explanation !== "string" ||
    (parsed as StructuredExplanation).explanation.trim().length < 10
  ) {
    throw new Error("structured response failed validation");
  }
  return (parsed as StructuredExplanation).explanation.trim();
}
