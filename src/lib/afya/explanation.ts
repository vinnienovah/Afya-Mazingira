import type { SituationResult, RiskAssessment, Lang } from "./types";
import { STATES, RISK_META } from "./constants";
import { fmtTime, fmtWindow } from "./format";

// ─── Deterministic Explanation Engine ─────────────────────────────────────────
// Produces validated explanation facts. The LLM may rewrite for clarity
// but must NOT change any numbers, times, risk categories, or recommendations.

export interface ExplanationFacts {
  state_name_en: string;
  state_name_sw: string;
  state_id: number;
  current_wbgt: number;
  current_temp: number;
  current_humidity: number;
  forecast_1h: number;
  forecast_3h: number;
  forecast_6h: number;
  forecast_9h: number;
  forecast_3h_lower: number;
  forecast_3h_upper: number;
  peak_time: string | null;
  peak_wbgt: number | null;
  thermal_risk_en: string;
  thermal_risk_sw: string;
  thermal_risk_level: string;
  quality: string;
  best_window_start: string | null;
  best_window_end: string | null;
  best_window_time_range: string | null;
  contributors: {
    key: string;
    label_en: string;
    label_sw: string;
    direction: string;
  }[];
  quality_status: string;
  uncertainty: string;
  transition_next_en: string | null;
  transition_next_sw: string | null;
  transition_probability: number | null;
  era5_temp_anomaly: number;
  era5_humidity_anomaly: number;
  chirps_7d_mm: number;
  sentinel2_ndvi: number | null;
  sentinel3_lst: number | null;
  model_3h_algorithm: string;
  model_3h_mae: number;
}

export function buildExplanationFacts(situation: SituationResult): ExplanationFacts {
  const f = situation;
  const f3h = f.forecast.find((x) => x.horizon === "3h") ?? f.forecast[1];
  const bt = f.best_time;

  return {
    state_name_en: STATES[f.state.state_id].name,
    state_name_sw: STATES[f.state.state_id].name_sw,
    state_id: f.state.state_id,
    current_wbgt: f.current.wbgt_c,
    current_temp: f.current.temperature_c,
    current_humidity: f.current.humidity_pct,
    forecast_1h: f.forecast[0]?.value ?? 0,
    forecast_3h: f3h?.value ?? 0,
    forecast_6h: f.forecast[2]?.value ?? 0,
    forecast_9h: f.forecast[3]?.value ?? 0,
    forecast_3h_lower: f3h?.lower ?? 0,
    forecast_3h_upper: f3h?.upper ?? 0,
    peak_time: f.expected_peak?.time ?? null,
    peak_wbgt: f.expected_peak?.wbgt_c ?? null,
    thermal_risk_en: f.risk.thermal,
    thermal_risk_sw: RISK_META[f.risk.thermal].sw,
    thermal_risk_level: f.risk.thermal,
    quality: f.quality.status,
    best_window_start: bt?.recommended.start ?? null,
    best_window_end: bt?.recommended.end ?? null,
    best_window_time_range: bt ? fmtWindow(bt.recommended.start, bt.recommended.end) : null,
    contributors: f.contributors.map((c) => {
      const labels: Record<string, { en: string; sw: string }> = {
        temp_rising: { en: "air temperature is rising", sw: "joto la hewa linaongezeka" },
        temp_falling: { en: "air temperature is falling", sw: "joto la hewa linapungua" },
        high_radiation: { en: "solar radiation remains high", sw: "mionzi ya jua bado ni mikali" },
        low_ventilation: { en: "ventilation is relatively weak", sw: "uingizaji hewa ni mdogo" },
        humidity_falling: { en: "relative humidity is falling", sw: "unyevu wa hewa unapungua" },
        peak_radiation: { en: "the environment is near its peak-radiation period", sw: "mazingira yako karibu na kipindi cha mionzi ya juu" },
      };
      const label = labels[c.feature] ?? {
        en: c.feature.replace(/_/g, " "),
        sw: c.feature.replace(/_/g, " "),
      };
      return {
        key: c.feature,
        label_en: label.en,
        label_sw: label.sw,
        direction: c.direction,
      };
    }),
    quality_status: f.quality.status,
    uncertainty: f.risk.uncertainty,
    transition_next_en: f.state.transition_likelihood
      ? STATES[f.state.transition_likelihood.state_id].name
      : null,
    transition_next_sw: f.state.transition_likelihood
      ? STATES[f.state.transition_likelihood.state_id].name_sw
      : null,
    transition_probability: f.state.transition_likelihood?.probability ?? null,
    era5_temp_anomaly: f.era5.local_temp_anomaly_c,
    era5_humidity_anomaly: f.era5.local_humidity_anomaly,
    chirps_7d_mm: f.chirps.chirps_7d_mm,
    sentinel2_ndvi: f.sentinel.sentinel2_ndvi_mean ?? null,
    sentinel3_lst: f.sentinel.sentinel3_lst_c ?? null,
    model_3h_algorithm: MODEL_VERSIONS_META["3h"].algorithm,
    model_3h_mae: MODEL_VERSIONS_META["3h"].mae,
  };
}

// ─── Farm advisory context facts ──────────────────────────────────────────────
// The base ExplanationFacts above cover the general Situation/Forecast pages
// only — they have no notion of a crop, growth stage, irrigation decision or
// spray window. Without this, a question asked on the Farm Advisory page
// (e.g. "should I irrigate today?") has genuinely no relevant fact to answer
// from, and the AI correctly (if unhelpfully) says so. This gives it the
// real, already-computed farm advisory facts to draw on instead.
const FARM_REASON_EN: Record<string, string> = {
  farm_reason_rain_expected: "rain is expected soon, so irrigating now would waste water",
  farm_reason_deficit_but_rain: "there is a soil water deficit, but expected rain should cover it",
  farm_reason_high_depletion: "root-zone water is substantially depleted",
  farm_reason_demand_exceeds_rain: "crop water demand has exceeded recent rainfall",
  farm_reason_high_et: "evaporative demand is high today",
  farm_reason_moderate_depletion: "root-zone water is moderately depleted",
  farm_reason_low_recent_rain: "little rainfall in the past 7 days",
  farm_reason_low_soil_moisture: "the real ERA5-Land soil moisture reading is low for this root zone",
  farm_reason_adequate_moisture: "soil moisture is adequate for this stage",
  farm_reason_rain_meets_demand: "recent rainfall meets crop water demand",
  farm_reason_buffered_by_rootzone: "rainfall is below demand, but the root zone still holds enough reserve",
  farm_reason_wind_drift: "wind is too strong, risking spray drift",
  farm_reason_wind_too_calm: "wind is very light, giving poor spray deposition",
  farm_reason_wind_suitable: "wind speed is suitable for spraying",
  farm_reason_washoff: "rain is likely, which may wash off applied product",
  farm_reason_rain_possible: "some rain is possible within the spray window",
  farm_reason_low_rain_risk: "rain risk during application is low",
  farm_reason_evaporation: "high temperature will make droplets evaporate quickly",
  farm_reason_data_limited: "station data is limited, so confidence is reduced",
  farm_reason_severe_heat: "forecast temperature is well above the crop's comfortable range",
  farm_reason_moderate_heat: "forecast temperature is above the crop's comfortable range",
  farm_reason_mild_heat: "forecast temperature is at the edge of the comfortable range",
  farm_reason_no_heat_stress: "temperatures stay within the crop's comfortable range",
  farm_reason_flowering_sensitive: "flowering is the most heat-sensitive stage",
  farm_reason_dry_soil_compounds: "dry soil makes heat stress worse",
};

/** Import shape kept loose (not the full FarmAdvisory type) so this stays
 * decoupled from farm-engine.ts and easy to call with whatever advisory
 * object the route already built. */
export function buildFarmExplanationFacts(advisory: {
  crop: { label_en: string };
  stage: string;
  water_balance: {
    et0_mm_day: number; etc_mm_day: number; rain_7d_mm: number; rain_30d_mm: number;
    balance_7d_mm: number; balance_30d_mm: number; soil_moisture_pct: number; depletion_pct: number;
  };
  irrigation: { action: string; depth_mm: number; reason_keys: string[] };
  spray_window: { quality: string; reason_keys: string[] };
  planting: { favourable: boolean; message_key: string; rain_30d_mm: number; required_mm: number };
  stress: { level: string; peak_temp_c: number };
}): Record<string, unknown> {
  const reasonText = (keys: string[]) => keys.map((k) => FARM_REASON_EN[k] ?? k).join("; ");
  return {
    farm_crop: advisory.crop.label_en,
    farm_growth_stage: advisory.stage,
    farm_irrigation_action: advisory.irrigation.action,
    farm_irrigation_depth_mm: advisory.irrigation.depth_mm,
    farm_irrigation_reasons: reasonText(advisory.irrigation.reason_keys),
    farm_soil_moisture_pct: advisory.water_balance.soil_moisture_pct,
    farm_root_zone_depletion_pct: advisory.water_balance.depletion_pct,
    farm_rain_7d_mm: advisory.water_balance.rain_7d_mm,
    farm_rain_30d_mm: advisory.water_balance.rain_30d_mm,
    farm_water_balance_7d_mm: advisory.water_balance.balance_7d_mm,
    farm_water_balance_30d_mm: advisory.water_balance.balance_30d_mm,
    farm_daily_water_demand_mm: advisory.water_balance.etc_mm_day,
    farm_spray_window_quality: advisory.spray_window.quality,
    farm_spray_window_reasons: reasonText(advisory.spray_window.reason_keys),
    farm_planting_outlook: advisory.planting.favourable ? "favourable" : "unfavourable",
    farm_planting_rain_30d_mm: advisory.planting.rain_30d_mm,
    farm_planting_required_mm: advisory.planting.required_mm,
    farm_heat_stress_level: advisory.stress.level,
    farm_peak_crop_temp_c: advisory.stress.peak_temp_c,
  };
}

const MODEL_VERSIONS_META: Record<string, { algorithm: string; mae: number }> = {
  "1h": { algorithm: "ExtraTrees", mae: 0.57 },
  "3h": { algorithm: "CatBoost", mae: 0.93 },
  "6h": { algorithm: "ExtraTrees", mae: 1.23 },
};

// ─── Deterministic English template ───────────────────────────────────────────

export function deterministicExplanationEn(facts: ExplanationFacts): string {
  const stateDesc = getStateDescriptionEn(facts.state_id);
  const riskDesc = getRiskDescriptionEn(facts.thermal_risk_level);
  const transitionPart = facts.transition_next_en
    ? ` The environment is likely to transition to ${facts.transition_next_en} within the next few hours.`
    : "";
  const peakPart = facts.peak_time && facts.peak_wbgt
    ? ` The expected peak exposure is ${facts.peak_wbgt.toFixed(1)}°C at around ${fmtTime(facts.peak_time)}.`
    : "";
  const windowPart = facts.best_window_time_range
    ? ` For a 60-minute outdoor activity, the recommended window is ${facts.best_window_time_range}.`
    : "";
  const qualityPart =
    facts.quality !== "GOOD"
      ? ` Data quality is ${facts.quality} — recommendations carry higher uncertainty.`
      : "";

  return [
    `The JKUAT area is currently in a ${facts.state_name_en} environmental state.`,
    stateDesc,
    `Current WBGT-like exposure is ${facts.current_wbgt.toFixed(1)}°C.`,
    `The +3 hour forecast is ${facts.forecast_3h.toFixed(1)}°C ` +
      `(interval: ${facts.forecast_3h_lower.toFixed(1)}–${facts.forecast_3h_upper.toFixed(1)}°C, ${facts.uncertainty.toLowerCase()} uncertainty), ` +
      `reaching ${facts.forecast_9h.toFixed(1)}°C by +9 hours.`,
    `Thermal exposure risk is ${facts.thermal_risk_en}. ${riskDesc}`,
    transitionPart,
    peakPart,
    windowPart,
    qualityPart,
  ]
    .filter(Boolean)
    .join(" ");
}

// ─── Deterministic Kiswahili template ─────────────────────────────────────────

export function deterministicExplanationSw(facts: ExplanationFacts): string {
  const stateDesc = getStateDescriptionSw(facts.state_id);
  const transitionPart = facts.transition_next_sw
    ? ` Mazingira yana uwezekano wa kubadilika kuwa ${facts.transition_next_sw} ndani ya masaa machache yanayokuja.`
    : "";
  const peakPart = facts.peak_time && facts.peak_wbgt
    ? ` Kilele cha kupatwa kinatarajiwa kuwa ${facts.peak_wbgt.toFixed(1)}°C katika karibu ${fmtTime(facts.peak_time)}.`
    : "";
  const windowPart = facts.best_window_time_range
    ? ` Kwa shughuli ya dakika 60 ya nje, dirisha linalopendekezwa ni ${facts.best_window_time_range}.`
    : "";
  const qualityPart =
    facts.quality !== "GOOD"
      ? ` Ubora wa data ni ${facts.quality} — mapendekezo yana utata mkubwa zaidi.`
      : "";

  return [
    `Eneo la JKUAT liko katika hali ya ${facts.state_name_sw}.`,
    stateDesc,
    `Kupatwa na WBGT kwa sasa ni ${facts.current_wbgt.toFixed(1)}°C.`,
    `Utabiri wa +saa 3 ni ${facts.forecast_3h.toFixed(1)}°C ` +
      `(kipindi: ${facts.forecast_3h_lower.toFixed(1)}–${facts.forecast_3h_upper.toFixed(1)}°C, utata ${facts.uncertainty.toLowerCase()}), ` +
      `ikifika ${facts.forecast_9h.toFixed(1)}°C kwa +saa 9.`,
    `Hatari ya kupatwa na joto ni ${facts.thermal_risk_sw}.`,
    transitionPart,
    peakPart,
    windowPart,
    qualityPart,
  ]
    .filter(Boolean)
    .join(" ");
}

function getStateDescriptionEn(stateId: number): string {
  switch (stateId) {
    case 0:
      return "Conditions are cool with high humidity and low solar radiation.";
    case 1:
      return "Temperature is rising rapidly while humidity falls and radiation increases.";
    case 2:
      return "The environment is at its thermal peak with high radiation and elevated WBGT.";
    case 3:
      return "Temperature is declining, humidity is recovering, and radiation is falling.";
    default:
      return "";
  }
}

function getStateDescriptionSw(stateId: number): string {
  switch (stateId) {
    case 0:
      return "Hali ni baridi yenye unyevu mkubwa na mionzi midogo ya jua.";
    case 1:
      return "Joto linaongezeka haraka wakati unyevu unapungua na mionzi inaongezeka.";
    case 2:
      return "Mazingira yako kwenye kilele cha joto chenye mionzi mikali na WBGT iliyoinuliwa.";
    case 3:
      return "Joto linapungua, unyevu unarejea, na mionzi inapungua.";
    default:
      return "";
  }
}

function getRiskDescriptionEn(risk: string): string {
  switch (risk) {
    case "LOW":
      return "Conditions are currently favourable for most outdoor activities.";
    case "ELEVATED":
      return "Prolonged or strenuous outdoor activity warrants awareness of thermal exposure.";
    case "HIGH":
      return "Consider shifting prolonged outdoor activity to a lower-exposure period.";
    case "VERY_HIGH":
      return "Strenuous outdoor activity should be avoided during peak thermal exposure.";
    default:
      return "";
  }
}

// ─── LLM Communication Layer ─────────────────────────────────────────────────

const LLM_SYSTEM_PROMPT_EN = `You are the AFYA MAZINGIRA communication layer. Your ONLY job is to explain validated environmental intelligence results in plain, natural language. You must NEVER invent sensor values, forecast values, risk levels, thresholds, causes, or medical advice. You may ONLY use the structured facts provided in the JSON input. Preserve every number, time, risk category, and recommendation exactly as given. Do not add weather forecasts of your own. Do not diagnose illness. If the structured facts show data quality is POOR, acknowledge limitations. Write in clear, helpful English suitable for a general audience.`;

// ─── Plain-language prompts ──────────────────────────────────────────────────
// Same validated facts, same grounding rules — only the reading level changes.
// Intended for farmers, outdoor workers, vendors, students and the general public.

const PLAIN_SYSTEM_PROMPT_EN = `You are the AFYA MAZINGIRA communication layer, writing for someone with no scientific or technical background — for example a farmer, a construction worker, a market vendor or a student.

Rules for how you write:
- Use short, everyday sentences. Aim for about 60-90 words total.
- Do NOT use technical words such as WBGT, forecast horizon, uncertainty interval, model contributor, radiation, humidity percentage, or data quality. Say things like "how hot it feels", "we expect", "we are less sure", or "the sensor is working normally" instead.
- Do not show numbers with units unless they are genuinely helpful. Prefer plain descriptions such as "hotter than now" or "cooler in the evening".
- Speak directly to the reader using "you".
- Lead with what is happening, then what it means for being outside, then the best time to do outdoor work or exercise.

Rules you must never break:
- Use ONLY the supplied structured facts. Never invent readings, times, categories or advice.
- If you state a time, copy it exactly as supplied.
- Never give medical advice and never diagnose illness.
- If data quality is not good, say plainly that the information is less reliable right now.`;

const PLAIN_SYSTEM_PROMPT_SW = `Wewe ni safu ya mawasiliano ya AFYA MAZINGIRA, unaandika kwa mtu asiye na elimu ya kisayansi au kiufundi — kwa mfano mkulima, mfanyakazi wa ujenzi, muuzaji sokoni au mwanafunzi.

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
  `Validated AFYA MAZINGIRA facts (for your reference only — do not repeat the field names):\n${factsJson}\n\n` +
  (userQuestion
    ? `The person asked: "${userQuestion}"\n\n` +
      `Answer THAT specific question first and directly. Pull in only the facts that are actually relevant to it — ` +
      `do not recite every field in the JSON if they weren't asked about it. ` +
      `If the question asks about a change (e.g. "what changed since morning"), compare the relevant before/after facts you were given rather than just restating the current state. ` +
      `If the facts genuinely don't contain what's needed to answer, say so briefly instead of padding with unrelated facts.\n\n`
    : `Give a brief overview of the current situation.\n\n`) +
  `Explain this ${lang === "sw" ? "in simple Kiswahili" : "in simple English"} for someone with no technical background. ` +
  `Maximum 90 words. Short everyday sentences. No technical terms and no field names. ` +
  `If you mention a clock time, copy it exactly as supplied. ` +
  `If a best window exists, tell them plainly when it is. ` +
  `Do not mention that you are an AI.`;

const STRUCTURED_PROMPT_TEMPLATE = (factsJson: string, userQuestion: string | null, lang: Lang) =>
  `Structured AFYA MAZINGIRA validated facts:\n${factsJson}\n\n` +
  (userQuestion
    ? `User question: "${userQuestion}"\n\n` +
      `Answer THAT specific question first and directly, in your own words. Select only the facts relevant to what was asked — ` +
      `do not dump every field in the JSON regardless of relevance; that produces a repetitive, unhelpful answer. ` +
      `If the question is about change over time (e.g. "what changed", "what's different now"), reason about the trend/trajectory facts you were given (current vs. forecast horizons, transition likelihood) rather than just listing the current snapshot again. ` +
      `If the supplied facts don't actually contain an answer to the question, say so briefly rather than substituting an unrelated fact dump.\n\n`
    : `Give a concise overview of the current situation.\n\n`) +
  `Respond ${lang === "sw" ? "in Kiswahili" : "in English"}. Be concise (max 150 words). ` +
  `Reference only the supplied facts. Do not invent numbers. ` +
  `When using a numeric fact, copy it exactly with the supplied decimal precision; never round, derive, or convert it. ` +
  `If you cannot copy a number exactly, omit that number and explain the qualitative signal instead. ` +
  `Use plain language. Only mention best_window_time_range if the question is about timing/best-time or no question was asked. ` +
  `Do not add disclaimers about being an AI.`;

export type ExplanationProvider = "gemini" | "groq" | "openai" | "anthropic" | "deterministic";
export type ExplanationMode = "standard" | "plain";

// ─── Deterministic plain-language templates ──────────────────────────────────
// Served when no provider is available. Same validated facts, simple wording.

function plainStateFeelEn(stateId: number): string {
  switch (stateId) {
    case 0: return "It is cool and damp outside right now.";
    case 1: return "It is heating up quickly outside right now.";
    case 2: return "It is hot outside right now and the sun is strong.";
    case 3: return "It is starting to cool down outside now.";
    default: return "";
  }
}

function plainStateFeelSw(stateId: number): string {
  switch (stateId) {
    case 0: return "Kwa sasa kuna baridi na unyevu nje.";
    case 1: return "Kwa sasa joto linapanda haraka nje.";
    case 2: return "Kwa sasa kuna joto kali nje na jua ni kali.";
    case 3: return "Kwa sasa hali inaanza kupoa nje.";
    default: return "";
  }
}

function plainRiskEn(risk: string): string {
  switch (risk) {
    case "LOW": return "It is a comfortable time to be outside for most people.";
    case "ELEVATED": return "If you will be outside for a long time or working hard, take it steady and rest in the shade.";
    case "HIGH": return "Heavy outdoor work or exercise will feel difficult. Try to move it to a cooler time if you can.";
    case "VERY_HIGH": return "This is a hard time for heavy outdoor work. Avoid it during the hottest part of the day if you can.";
    default: return "";
  }
}

function plainRiskSw(risk: string): string {
  switch (risk) {
    case "LOW": return "Ni wakati mzuri wa kuwa nje kwa watu wengi.";
    case "ELEVATED": return "Ukiwa nje kwa muda mrefu au ukifanya kazi ngumu, nenda taratibu na pumzika kivulini.";
    case "HIGH": return "Kazi nzito au mazoezi ya nje yatakuwa magumu. Jaribu kuyahamishia wakati wa baridi zaidi ukiweza.";
    case "VERY_HIGH": return "Huu ni wakati mgumu kwa kazi nzito za nje. Epuka wakati wa joto kali zaidi ukiweza.";
    default: return "";
  }
}

export function plainExplanationEn(facts: ExplanationFacts): string {
  const parts = [plainStateFeelEn(facts.state_id)];

  if (facts.forecast_3h > facts.current_wbgt + 0.4) {
    parts.push("Over the next few hours it is expected to feel hotter.");
  } else if (facts.forecast_3h < facts.current_wbgt - 0.4) {
    parts.push("Over the next few hours it is expected to feel cooler.");
  } else {
    parts.push("Conditions are expected to stay much the same for the next few hours.");
  }

  if (facts.peak_time) {
    parts.push(`The hardest time to be outside should be around ${fmtTime(facts.peak_time)}.`);
  }

  parts.push(plainRiskEn(facts.thermal_risk_level));

  if (facts.best_window_time_range) {
    parts.push(`If you can choose, ${facts.best_window_time_range} looks like the best time today.`);
  }

  if (facts.quality_status === "DEGRADED") {
    parts.push("Note: some readings are missing, so this is less certain than usual.");
  } else if (facts.quality_status === "POOR") {
    parts.push("Note: the station data is not reliable right now, so treat this as a rough guide only.");
  }

  return parts.filter(Boolean).join(" ");
}

export function plainExplanationSw(facts: ExplanationFacts): string {
  const parts = [plainStateFeelSw(facts.state_id)];

  if (facts.forecast_3h > facts.current_wbgt + 0.4) {
    parts.push("Katika masaa machache yanayokuja, inatarajiwa kuhisi joto zaidi.");
  } else if (facts.forecast_3h < facts.current_wbgt - 0.4) {
    parts.push("Katika masaa machache yanayokuja, inatarajiwa kuhisi baridi zaidi.");
  } else {
    parts.push("Hali inatarajiwa kubaki hivyo hivyo kwa masaa machache yanayokuja.");
  }

  if (facts.peak_time) {
    parts.push(`Wakati mgumu zaidi wa kuwa nje unatarajiwa kuwa karibu saa ${fmtTime(facts.peak_time)}.`);
  }

  parts.push(plainRiskSw(facts.thermal_risk_level));

  if (facts.best_window_time_range) {
    parts.push(`Ukiwa na uchaguzi, ${facts.best_window_time_range} inaonekana ndio wakati mzuri zaidi leo.`);
  }

  if (facts.quality_status === "DEGRADED") {
    parts.push("Kumbuka: baadhi ya vipimo havipo, hivyo hii si ya uhakika kama kawaida.");
  } else if (facts.quality_status === "POOR") {
    parts.push("Kumbuka: data ya kituo si ya kuaminika sasa hivi, hivyo chukua hii kama mwongozo wa jumla tu.");
  }

  return parts.filter(Boolean).join(" ");
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

/**
 * Call the configured communication providers in order:
 * Gemini → Groq (free-tier) → OpenAI → legacy Anthropic → deterministic template.
 * This is the ONLY code path that interfaces with a generative model.
 * Scientific outputs have already been calculated and validated upstream.
 */
export async function generateExplanation(
  situation: SituationResult,
  lang: Lang,
  userQuestion?: string,
  forceFallback = false,
  mode: ExplanationMode = "standard",
  extraFacts?: Record<string, unknown>,
): Promise<{
  text: string;
  source: "llm" | "deterministic";
  provider: ExplanationProvider;
  mode: ExplanationMode;
}> {
  const facts = buildExplanationFacts(situation);
  const fallback = mode === "plain"
    ? (lang === "sw" ? plainExplanationSw(facts) : plainExplanationEn(facts))
    : (lang === "sw" ? deterministicExplanationSw(facts) : deterministicExplanationEn(facts));

  if (forceFallback) {
    return { text: fallback, source: "deterministic", provider: "deterministic", mode };
  }

  // The model receives display-ready Africa/Nairobi clock times, not raw UTC
  // timestamps. This prevents the communication layer from showing a correct
  // instant in the wrong timezone while leaving all calculations unchanged.
  const communicationFacts = {
    ...facts,
    peak_time: facts.peak_time ? fmtTime(facts.peak_time) : null,
    best_window_start: facts.best_window_start ? fmtTime(facts.best_window_start) : null,
    best_window_end: facts.best_window_end ? fmtTime(facts.best_window_end) : null,
    ...extraFacts,
  };
  const factsJson = JSON.stringify(communicationFacts, null, 2);
  // Extra numeric facts (e.g. a farm advisory's peak crop temperature) are
  // real, validated values too — the grounding check must accept them, not
  // just the base situation facts, or the LLM's correct answer gets rejected
  // as an unrecognized number and silently replaced by the generic fallback.
  const extraAllowedNumbers = extraFacts
    ? Object.values(extraFacts).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : [];
  const systemPrompt = mode === "plain"
    ? (lang === "sw" ? PLAIN_SYSTEM_PROMPT_SW : PLAIN_SYSTEM_PROMPT_EN)
    : (lang === "sw" ? LLM_SYSTEM_PROMPT_SW : LLM_SYSTEM_PROMPT_EN);
  const userPrompt = mode === "plain"
    ? PLAIN_PROMPT_TEMPLATE(factsJson, userQuestion ?? null, lang)
    : STRUCTURED_PROMPT_TEMPLATE(factsJson, userQuestion ?? null, lang);

  const providers: {
    name: Exclude<ExplanationProvider, "deterministic">;
    configured: boolean;
    run: () => Promise<string>;
  }[] = [
    {
      name: "gemini",
      configured: !!process.env.GEMINI_API_KEY,
      run: () => generateWithGemini(systemPrompt, userPrompt),
    },
    {
      name: "groq",
      configured: !!process.env.GROQ_API_KEY,
      run: () => generateWithGroq(systemPrompt, userPrompt),
    },
    {
      name: "openai",
      configured: !!process.env.OPENAI_API_KEY,
      run: () => generateWithOpenAI(systemPrompt, userPrompt),
    },
    {
      name: "anthropic",
      configured: !!process.env.LLM_API_KEY,
      run: () => generateWithAnthropic(systemPrompt, userPrompt),
    },
  ];

  for (const provider of providers) {
    if (!provider.configured) continue;
    try {
      const text = (await provider.run()).trim();
      if (!text || !isExplanationGrounded(text, facts, extraAllowedNumbers)) continue;
      return { text, source: "llm", provider: provider.name, mode };
    } catch (error) {
      // Provider failure is non-fatal and must never block deterministic science.
      // Log only provider + status/message; credentials and prompts are never logged.
      console.warn(
        `[afya-ai] ${provider.name} unavailable:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  return { text: fallback, source: "deterministic", provider: "deterministic", mode };
}

async function generateWithGemini(systemPrompt: string, userPrompt: string): Promise<string> {
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
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseStructuredExplanation(raw);
}

async function generateWithGroq(systemPrompt: string, userPrompt: string): Promise<string> {
  // Free-tier fallback: Groq-hosted open-weight model, OpenAI-compatible API.
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY!}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
      max_tokens: 420,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${systemPrompt}\nRespond with JSON only: {"explanation": "..."}.`,
        },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseStructuredExplanation(data.choices?.[0]?.message?.content);
}

async function generateWithOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
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
    signal: AbortSignal.timeout(12_000),
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

async function generateWithAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
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
    signal: AbortSignal.timeout(12_000),
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

/**
 * Post-generation grounding validation. Structured output controls shape;
 * this validator controls scientific fidelity. Any mismatch falls through to
 * the next provider or the deterministic template.
 */
function isExplanationGrounded(text: string, facts: ExplanationFacts, extraAllowedNumbers: number[] = []): boolean {
  // Never permit medical diagnosis or unsupported disease claims.
  const medical = /\b(diagnos|malaria|cholera|asthma attack|clinical diagnosis|hospital)\b/i;
  if (medical.test(text)) return false;

  // If the model declares a risk category, it must be the validated one.
  // Category words elsewhere (for example "high radiation" or "low wind")
  // are environmental descriptors, not risk-tier declarations.
  const sentences = text.split(/(?<=[.!?])\s+/);
  const riskSentences = sentences.filter((sentence) =>
    /thermal\s+(?:exposure\s+)?risk|risk\s+(?:tier|level|category)|hatari\s+(?:ya\s+)?(?:kupatwa\s+na\s+)?joto/i.test(sentence),
  );
  for (const sentence of riskSentences) {
    const mentions = sentence.match(/\b(VERY HIGH|ELEVATED|HIGH|LOW)\b/gi) ?? [];
    for (const mention of mentions) {
      if (mention.toUpperCase().replace(/\s+/g, "_") !== facts.thermal_risk_level) return false;
    }
  }

  // Quality words are checked only when stated as a data-quality category;
  // "good window" and "poor ventilation" must not be misclassified.
  const qualitySentences = sentences.filter((sentence) => /data\s+quality|ubora\s+wa\s+data/i.test(sentence));
  for (const sentence of qualitySentences) {
    const mentions = sentence.match(/\b(GOOD|DEGRADED|POOR)\b/gi) ?? [];
    for (const mention of mentions) {
      if (mention.toUpperCase() !== facts.quality_status) return false;
    }
  }

  // Every temperature explicitly presented as °C must be one of the validated
  // facts. This catches invented readings while allowing natural paraphrasing.
  const allowedTemperatures = [
    facts.current_wbgt,
    facts.current_temp,
    facts.forecast_1h,
    facts.forecast_3h,
    facts.forecast_6h,
    facts.forecast_9h,
    facts.forecast_3h_lower,
    facts.forecast_3h_upper,
    facts.peak_wbgt,
    facts.era5_temp_anomaly,
    facts.sentinel3_lst,
    ...extraAllowedNumbers,
  ].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const temperatures = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*°\s*C/gi)].map((m) => Number(m[1]));
  for (const value of temperatures) {
    if (!allowedTemperatures.some((allowed) => Math.abs(value - allowed) < 0.06)) return false;
  }

  // Any clock time must be a validated peak or Best-Time boundary.
  const allowedTimes = [
    facts.peak_time ? fmtTime(facts.peak_time) : null,
    facts.best_window_start ? fmtTime(facts.best_window_start) : null,
    facts.best_window_end ? fmtTime(facts.best_window_end) : null,
  ].filter((time): time is string => !!time);
  const mentionedTimes = text.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g) ?? [];
  for (const time of mentionedTimes) {
    if (!allowedTimes.includes(time)) return false;
  }

  return true;
}
