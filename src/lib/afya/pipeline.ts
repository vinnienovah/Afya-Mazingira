import type {
  SituationResult, CurrentObservation, StateId, DataQuality,
  RiskAssessment, Contributor, BestTimeResult,
} from "./types";
import type { DemoObservation } from "./demo-observations";
import { getObservationSeries } from "./sources";
import { getEra5ContextLive, getSentinelContextLive, getRainfallContext } from "./sources-external";
import { computeFeatures } from "./feature-engine";
import { classifyState, buildStateHistory, stateSince, getNextTransition } from "./state-engine";
import { predictHorizon, buildForecastSeries, findExpectedPeak } from "./forecast-engine";
import { computeThermalRisk, computeRainProbability, computeUncertainty } from "./risk-engine";
import { findBestWindowFromNow } from "./best-time-engine";
import { evaluateQuality } from "./data-quality";
import { MODEL_VERSIONS } from "./constants";

// ─── AFYA MAZINGIRA Intelligence Pipeline ─────────────────────────────────────────
// CONDUIT → QC → FEATURES → STATE → FORECAST → RISK → BEST-TIME → EXPLANATION
// Fully deterministic and source-agnostic: live Conduit observations when
// credentials exist, the seeded demo series otherwise (spec §36). External
// context (ERA5 / Sentinel) is live-with-fallback and never blocks the
// scientific pipeline (spec §40).

export interface PipelineOptions {
  anchorIso?: string;         // replay anchor; defaults to now
  lookbackHours?: number;
  activityKey?: string;       // default activity for best-time
  durationMinutes?: number;
}

export async function runPipeline(options: PipelineOptions = {}): Promise<SituationResult> {
  const {
    anchorIso = new Date().toISOString(),
    lookbackHours = 30,
    activityKey = "general",
    durationMinutes = 60,
  } = options;

  // ── Step 1: Data ingestion (live → CSV archive → synthetic demo) ─────────
  const bundle = getObservationSeries(anchorIso, lookbackHours);
  const series: DemoObservation[] = bundle.series;
  const isDemo = bundle.source === "demo";
  const anchor = bundle.anchorIso || anchorIso;
  // For anything standing in for "now" (live, or the CSV archive's latest
  // available row) the effective "now" is the real clock so observation age
  // is reported honestly; for a deliberate historical replay or synthetic
  // demo it is the (possibly simulated) anchor itself.
  const effectiveNow = bundle.realtime ? new Date().toISOString() : anchor;

  // ── Step 2: Quality control ────────────────────────────────────────────────
  const quality: DataQuality = evaluateQuality(series, effectiveNow);
  // If the +6h forecast horizon has fully elapsed, the situation is too stale
  // to act on → suppress strong recommendations (spec §52: never present
  // stale data as actionable).
  const horizonEndMs = new Date(anchor).getTime() + 6 * 3600 * 1000;
  if (
    bundle.realtime &&
    horizonEndMs <= new Date(effectiveNow).getTime() &&
    quality.status !== "POOR"
  ) {
    quality.status = "POOR";
    quality.flags = [...quality.flags, "forecast_horizon_elapsed"];
  }

  // ── Step 3: Feature engineering ───────────────────────────────────────────
  const latestIdx = series.length - 1;
  const fv = computeFeatures(series, latestIdx);
  if (!fv) throw new Error("Insufficient history for feature computation");
  const currentObs = series[latestIdx];

  // ── Step 4: Environmental state ───────────────────────────────────────────
  const stateId: StateId = classifyState(fv);
  const featureSeries = series.map((_, i) => computeFeatures(series, i));
  const timestamps = series.map((o) => o.ts);
  const allSegments = buildStateHistory(featureSeries, timestamps);
  const cutoffMs = new Date(anchor).getTime() - 24 * 3600 * 1000;
  const state_history_24h = allSegments.filter(
    (s) => new Date(s.end).getTime() >= cutoffMs,
  );
  const since = stateSince(allSegments, stateId);
  const prevState = allSegments.length >= 2
    ? allSegments[allSegments.length - 2].state_id
    : null;
  const transition = getNextTransition(stateId);

  // ── Step 5: Forecast (+ uncertainty widening when degraded) ───────────────
  const raw1h = predictHorizon(fv, "1h", stateId);
  const raw3h = predictHorizon(fv, "3h", stateId);
  const raw6h = predictHorizon(fv, "6h", stateId);
  let forecast_series = buildForecastSeries(fv, stateId, anchor);

  const degraded = quality.status === "DEGRADED";
  const widen = (v: number, lo: number, hi: number) => ({
    lower: Math.round((v - (v - lo) * 1.5) * 10) / 10,
    upper: Math.round((v + (hi - v) * 1.5) * 10) / 10,
  });
  if (degraded) {
    // Degraded data quality → widen prediction intervals (spec §18)
    forecast_series = forecast_series.map((p) => ({ ...p, ...widen(p.value, p.lower, p.upper) }));
  }
  const forecast = degraded
    ? [raw1h, raw3h, raw6h].map((f) => ({ ...f, ...widen(f.value, f.lower, f.upper) }))
    : [raw1h, raw3h, raw6h];
  const f3h = forecast[1];
  const expected_peak = findExpectedPeak(forecast_series);

  // ── Step 6: Rain probability ───────────────────────────────────────────────
  const rainProbability = computeRainProbability(
    currentObs.rg1 > 0 || currentObs.rg2 > 0,
    fv.pressure_delta_1h,
    fv.humidity_sht,
  );

  // ── Step 7: Context (live adapters with graceful fallback) ─────────────────
  // Skip the real fetch entirely for a genuine historical replay anchor — a
  // fresh ERA5/Sentinel read is only meaningful for "now" (spec §40).
  const [era5, sentinel, chirps] = await Promise.all([
    getEra5ContextLive(anchor, currentObs.temp_sht, currentObs.humidity_sht, bundle.realtime),
    getSentinelContextLive(bundle.realtime),
    getRainfallContext(anchor, bundle.realtime),
  ]);

  // ── Step 8: Risk / exposure ────────────────────────────────────────────────
  const thermalRisk = computeThermalRisk(f3h.value, 0);
  const uncertainty = computeUncertainty(f3h.lower, f3h.upper);
  const risk: RiskAssessment = {
    thermal: thermalRisk,
    rain_probability: rainProbability,
    uncertainty,
    data_quality: quality.status,
  };

  // ── Step 9: Best-Time (start clamped to the effective now so a stale
  // forecast never recommends an already-elapsed window) ────────────────────
  const best_time: BestTimeResult | null = findBestWindowFromNow(
    forecast_series,
    activityKey,
    durationMinutes,
    10, // 10-hour look-ahead window
    quality,
    effectiveNow,
  );

  // ── Step 10: Contributors (deterministic feature importance proxy) ─────────
  const contributors: Contributor[] = buildContributors(fv, stateId);

  // ── Build output ───────────────────────────────────────────────────────────
  const current: CurrentObservation = {
    time: currentObs.ts,
    temperature_c: currentObs.temp_sht,
    humidity_pct: currentObs.humidity_sht,
    pressure_hpa: currentObs.press_bmx,
    wind_speed_ms: currentObs.wind_spd,
    wind_direction_deg: currentObs.wind_dir,
    wind_gust_ms: currentObs.wind_gust,
    visible_signal: currentObs.si1145_vis,
    infrared_signal: currentObs.si1145_ir,
    wet_bulb_c: currentObs.wet_bulb_temp,
    wbgt_c: currentObs.wet_bulb_globe_temp,
    rain_observed: currentObs.rg1 > 0 || currentObs.rg2 > 0,
  };

  return {
    generated_at: anchor,
    location: "JKUAT/Juja Conduit station",
    demo_mode: isDemo,
    data_source: bundle.source === "live" ? "CONDUIT_LIVE" : bundle.source === "csv" ? "CONDUIT_ARCHIVE" : "DEMO",
    quality,
    current,
    state: {
      state_id: stateId,
      since,
      previous_state_id: prevState,
      transition_likelihood: transition,
    },
    forecast,
    forecast_series,
    risk,
    best_time,
    expected_peak,
    state_history_24h,
    contributors,
    era5,
    chirps,
    sentinel,
  };
}

function buildContributors(fv: {
  temp_delta_1h: number; si1145_ir: number; wind_spd: number;
  humidity_delta_1h: number; hour_cos: number;
}, stateId: StateId): Contributor[] {
  const contribs: Contributor[] = [];
  if (fv.temp_delta_1h > 0.3) contribs.push({ feature: "temp_rising", direction: "increasing" });
  if (fv.temp_delta_1h < -0.3) contribs.push({ feature: "temp_falling", direction: "low" });
  if (fv.si1145_ir > 3500) contribs.push({ feature: "high_radiation", direction: "high" });
  if (fv.wind_spd < 1.0) contribs.push({ feature: "low_ventilation", direction: "low" });
  if (fv.humidity_delta_1h < -2) contribs.push({ feature: "humidity_falling", direction: "low" });
  if (stateId === 2) contribs.push({ feature: "peak_radiation", direction: "high" });
  return contribs.slice(0, 4);
}

// ─── Historical Replay Pipeline ───────────────────────────────────────────────
// Replay anchors are historical → the source selector serves the seeded
// historical demo series for that day (live fetch is skipped for old anchors),
// and the freshness clock equals the simulated time so replay behaves exactly
// like a live session at that hour.

export interface ReplayStep {
  sim_time: string;
  situation: SituationResult;
}

export async function runHistoricalReplay(dateStr: string): Promise<ReplayStep[]> {
  // Simulate 06:00 through 18:00 EAT on the given day. A genuinely historical
  // anchor is never "realtime" (see runPipeline), so each of these resolves
  // without any real network fetch — sequential awaiting stays fast.
  const steps: ReplayStep[] = [];
  for (let eatHour = 6; eatHour <= 18; eatHour++) {
    const utcHour = eatHour - 3;
    const anchorIso = `${dateStr}T${String(Math.max(0, utcHour)).padStart(2, "0")}:00:00Z`;
    const situation = await runPipeline({ anchorIso });
    steps.push({ sim_time: anchorIso, situation });
  }
  return steps;
}

// ─── Model metadata ────────────────────────────────────────────────────────────

export function getModelRegistry() {
  return [
    {
      name: "wbgt_forecast_1h",
      version: MODEL_VERSIONS["1h"].version,
      algorithm: MODEL_VERSIONS["1h"].algorithm,
      target: "wet_bulb_globe_temp",
      horizon_minutes: 60,
      mae: MODEL_VERSIONS["1h"].mae,
      training_start: "2025-06-01",
      training_end: "2026-08-01",
    },
    {
      name: "wbgt_forecast_3h",
      version: MODEL_VERSIONS["3h"].version,
      algorithm: MODEL_VERSIONS["3h"].algorithm,
      target: "wet_bulb_globe_temp",
      horizon_minutes: 180,
      mae: MODEL_VERSIONS["3h"].mae,
      training_start: "2025-06-01",
      training_end: "2026-08-01",
    },
    {
      name: "wbgt_forecast_6h",
      version: MODEL_VERSIONS["6h"].version,
      algorithm: MODEL_VERSIONS["6h"].algorithm,
      target: "wet_bulb_globe_temp",
      horizon_minutes: 360,
      mae: MODEL_VERSIONS["6h"].mae,
      training_start: "2025-06-01",
      training_end: "2026-08-01",
    },
  ];
}
