import type { RiskLevel, StateId } from "./types";

// ─── Climate Reflex environmental states ─────────────────────────────────────
export const STATES: Record<
  StateId,
  { name: string; name_sw: string; color: string; bg: string; light: string; text: string }
> = {
  0: {
    name: "Cool & Humid Stable",
    name_sw: "Hali Baridi na Unyevu Imara",
    color: "#247B78",
    bg: "bg-[#247B78]",
    light: "bg-[#247B78]/10 text-[#247B78]",
    text: "text-[#247B78]",
  },
  1: {
    name: "Rapid Warming",
    name_sw: "Kuongezeka Haraka kwa Joto",
    color: "#F2B705",
    bg: "bg-[#F2B705]",
    light: "bg-[#F2B705]/15 text-[#8a6d00]",
    text: "text-[#8a6d00]",
  },
  2: {
    name: "Hot / High-Radiation Exposure",
    name_sw: "Joto / Mionzi Mikali",
    color: "#E27832",
    bg: "bg-[#E27832]",
    light: "bg-[#E27832]/10 text-[#E27832]",
    text: "text-[#E27832]",
  },
  3: {
    name: "Cooling / Recovery",
    name_sw: "Kupoa / Kupona",
    color: "#6B8F71",
    bg: "bg-[#6B8F71]",
    light: "bg-[#6B8F71]/15 text-[#4a6b50]",
    text: "text-[#4a6b50]",
  },
};

export const STATE_CYCLE: StateId[] = [0, 1, 2, 3, 0];

// Next-state transition probabilities derived from the state machine
export function nextState(current: StateId): { state_id: StateId; probability: number } {
  const next = STATE_CYCLE[(STATE_CYCLE.indexOf(current) + 1) % 4] as StateId;
  const prob: Record<StateId, number> = { 0: 0.82, 1: 0.76, 2: 0.84, 3: 0.79 };
  return { state_id: next, probability: prob[current] };
}

// ─── Risk levels ──────────────────────────────────────────────────────────────
export const RISK_ORDER: RiskLevel[] = ["LOW", "ELEVATED", "HIGH", "VERY_HIGH"];

export const RISK_META: Record<
  RiskLevel,
  { en: string; sw: string; color: string; bg: string; light: string; rank: number }
> = {
  LOW: { en: "LOW", sw: "CHINI", color: "#006B3C", bg: "bg-[#006B3C]", light: "bg-[#006B3C]/10 text-[#006B3C]", rank: 0 },
  ELEVATED: { en: "ELEVATED", sw: "IMEINUKA", color: "#F2B705", bg: "bg-[#F2B705]", light: "bg-[#F2B705]/15 text-[#7a5c00]", rank: 1 },
  HIGH: { en: "HIGH", sw: "JUU", color: "#E27832", bg: "bg-[#E27832]", light: "bg-[#E27832]/10 text-[#E27832]", rank: 2 },
  VERY_HIGH: { en: "VERY HIGH", sw: "JUU SANA", color: "#C62828", bg: "bg-[#C62828]", light: "bg-[#C62828]/10 text-[#C62828]", rank: 3 },
};

export function riskRank(level: RiskLevel): number {
  return RISK_META[level].rank;
}

// ─── Activity profiles ────────────────────────────────────────────────────────
export interface ActivityProfile {
  key: string;
  label_en: string;
  label_sw: string;
  intensity: "light" | "moderate" | "high";
  wbgt_caution_offset: number; // added to base threshold interpretation
}

export const ACTIVITY_PROFILES: ActivityProfile[] = [
  { key: "walking", label_en: "Walking / commuting", label_sw: "Kutembea / kusafiri", intensity: "light", wbgt_caution_offset: 2 },
  { key: "sports", label_en: "Sports / exercise", label_sw: "Michezo / mazoezi", intensity: "high", wbgt_caution_offset: -1.5 },
  { key: "outdoor_work", label_en: "Outdoor work", label_sw: "Kazi za nje", intensity: "moderate", wbgt_caution_offset: 0 },
  { key: "construction", label_en: "Construction", label_sw: "Ujenzi", intensity: "high", wbgt_caution_offset: -1.5 },
  { key: "outdoor_event", label_en: "Outdoor event", label_sw: "Tukio la nje", intensity: "moderate", wbgt_caution_offset: 0.5 },
  { key: "field_work", label_en: "Field / agricultural work", label_sw: "Kazi za shambani", intensity: "moderate", wbgt_caution_offset: 0 },
  { key: "general", label_en: "General outdoor activity", label_sw: "Shughuli za nje", intensity: "light", wbgt_caution_offset: 1 },
];

export function getActivityProfile(key: string): ActivityProfile {
  return ACTIVITY_PROFILES.find((p) => p.key === key) ?? ACTIVITY_PROFILES[6];
}

// ─── WBGT → Risk thresholds (activity-aware, NOT medical) ───────────────────
// These are activity-adjusted environmental exposure tiers.
// They are not medical or clinical thresholds.
export function wbgtToRisk(wbgt: number, activityOffset = 0): RiskLevel {
  const t = wbgt + activityOffset; // positive offset → more tolerant (lower effective exposure)
  // For high-intensity activities (sports, construction) offset is negative,
  // meaning the same WBGT produces a higher risk tier.
  if (t < 18) return "LOW";
  if (t < 21) return "ELEVATED";
  if (t < 24) return "HIGH";
  return "VERY_HIGH";
}

// ─── Model versions ───────────────────────────────────────────────────────────
export const MODEL_VERSIONS = {
  "1h": { algorithm: "ExtraTrees", version: "1.0.0", mae: 0.57 },
  "3h": { algorithm: "CatBoost", version: "1.0.0", mae: 0.93 },
  "6h": { algorithm: "ExtraTrees", version: "1.0.0", mae: 1.23 },
  "9h": { algorithm: "CatBoost", version: "1.0.0", mae: 1.58 },
};

// ─── Provenance labels ────────────────────────────────────────────────────────
export const PROVENANCE_LABELS: Record<string, { en: string; sw: string; icon: string }> = {
  MEASURED: { en: "MEASURED", sw: "ILIPIMEWA", icon: "●" },
  PREDICTED: { en: "PREDICTED", sw: "ILITABIRIWA", icon: "◇" },
  SATELLITE_DERIVED: { en: "SATELLITE-DERIVED", sw: "KUTOKA SAYETI", icon: "■" },
  REGIONAL_MODEL: { en: "REGIONAL MODEL", sw: "MFUMO WA KIKANDA", icon: "▧" },
  HISTORICAL: { en: "HISTORICAL", sw: "KIHISTORIA", icon: "▨" },
  DERIVED: { en: "AFYA MAZINGIRA DERIVED", sw: "IMECHAKATWA NA AFYA MAZINGIRA", icon: "◇" },
};

// ─── Demo Conduit coordinates ────────────────────────────────────────────────
export const JKUAT_COORDS = { lat: -1.0931, lng: 37.0149 };
export const JKUAT_NAME = "JKUAT / Juja Conduit Station";

// ─── Climate History dashboard locations ─────────────────────────────────────
// JKUAT (real Conduit station) plus the same 11 counties the regional outlook
// map covers (centroids — see public/geo/counties.geojson) — used to pick a
// location for the ERA5-Land historical series, since ERA5 works anywhere.
export const CLIMATE_LOCATIONS: { key: string; name: string; name_sw: string; lat: number; lng: number }[] = [
  { key: "jkuat", name: "JKUAT / Juja", name_sw: "JKUAT / Juja", lat: -1.0931, lng: 37.0149 },
  { key: "embu", name: "Embu", name_sw: "Embu", lat: -0.6785, lng: 37.6297 },
  { key: "kajiado", name: "Kajiado", name_sw: "Kajiado", lat: -1.9599, lng: 36.9701 },
  { key: "kiambu", name: "Kiambu", name_sw: "Kiambu", lat: -1.0721, lng: 36.9059 },
  { key: "kirinyaga", name: "Kirinyaga", name_sw: "Kirinyaga", lat: -0.6186, lng: 37.3120 },
  { key: "kitui", name: "Kitui", name_sw: "Kitui", lat: -1.6904, lng: 38.1698 },
  { key: "machakos", name: "Machakos", name_sw: "Machakos", lat: -1.2355, lng: 37.4374 },
  { key: "makueni", name: "Makueni", name_sw: "Makueni", lat: -2.1161, lng: 37.8014 },
  { key: "muranga", name: "Murang'a", name_sw: "Murang'a", lat: -0.8529, lng: 37.1005 },
  { key: "nairobi", name: "Nairobi", name_sw: "Nairobi", lat: -1.2861, lng: 36.8994 },
  { key: "nyandarua", name: "Nyandarua", name_sw: "Nyandarua", lat: -0.3722, lng: 36.4830 },
  { key: "nyeri", name: "Nyeri", name_sw: "Nyeri", lat: -0.3488, lng: 36.9114 },
];

// ─── Demo account (public, documented credential — always auto-verified) ─────
export const DEMO_EMAIL = "demo@afyahewa.dev";
export const DEMO_PASSWORD = "afyahewa2026";
