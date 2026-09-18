import type { DataQuality, QualityStatus } from "./types";
import type { DemoObservation } from "./demo-observations";

// ─── Data Quality Engine ──────────────────────────────────────────────────────
// Evaluates observation freshness, sensor agreement, and known field issues.
// Spec §18 defines the GOOD / DEGRADED / POOR behaviour; the absolute age
// thresholds below are calibrated to the station's observed upload cadence
// (the Conduit endpoint currently publishes in daily batches) rather than
// assuming a continuous 15-minute stream. The age itself is always displayed.

const EXPECTED_INTERVAL_MINUTES = 15;
const GOOD_MAX_AGE_MINUTES = 90;            // fresh intraday data
const DEGRADED_MAX_AGE_MINUTES = 18 * 60;   // overnight batch delay tolerated
const POOR_MAX_AGE_MINUTES = 30 * 60;       // station genuinely unavailable

const CRITICAL_FIELDS: (keyof DemoObservation)[] = [
  "temp_sht", "humidity_sht", "wet_bulb_globe_temp", "si1145_ir", "wind_spd",
];

/**
 * Evaluate data quality from a series of observations.
 * @param series  Full observation series (most recent last)
 * @param referenceNow  The clock to measure freshness against — the real clock
 *                      for live data (honest age), the simulated anchor for
 *                      demo/replay mode.
 */
export function evaluateQuality(series: DemoObservation[], referenceNow?: string): DataQuality {
  const flags: string[] = [];
  const now = referenceNow ? new Date(referenceNow).getTime() : Date.now();

  if (!series.length) {
    return {
      status: "POOR",
      freshness_minutes: 999,
      flags: ["no_observations"],
      updated_at: new Date(now).toISOString(),
    };
  }

  const latest = series[series.length - 1];
  const latestMs = new Date(latest.ts).getTime();
  const freshnessMinutes = Math.round((now - latestMs) / 60000);

  // ── Freshness check ─────────────────────────────────────────────────────
  if (freshnessMinutes > DEGRADED_MAX_AGE_MINUTES) {
    flags.push("stale_data");
  } else if (freshnessMinutes > GOOD_MAX_AGE_MINUTES) {
    flags.push("observation_age_elevated");
  }

  // ── Missing critical fields in latest ────────────────────────────────────
  const missing: string[] = [];
  for (const f of CRITICAL_FIELDS) {
    const v = latest[f];
    if (v === null || v === undefined || isNaN(v as number)) missing.push(f);
  }
  if (missing.length > 0) flags.push(`missing_fields:${missing.join(",")}`);

  // ── Temperature sensor spread (cross-sensor consistency) ─────────────────
  const tempSpread =
    Math.max(latest.temp_sht, latest.temp_bmx, latest.temp_mcp) -
    Math.min(latest.temp_sht, latest.temp_bmx, latest.temp_mcp);
  if (tempSpread > 2.0) flags.push("temp_sensor_disagreement");

  // ── Impossible ranges (scientific sanity, spec §55) ──────────────────────
  if (latest.humidity_sht < 0 || latest.humidity_sht > 100) flags.push("humidity_out_of_range");
  if (latest.temp_sht < -10 || latest.temp_sht > 50) flags.push("temp_out_of_range");
  if (latest.wet_bulb_globe_temp < 5 || latest.wet_bulb_globe_temp > 45) flags.push("wbgt_out_of_range");

  // ── UV channel (low trust per spec §15.3) ─────────────────────────────────
  if (latest.si1145_uv > 0) flags.push("uv_signal_unusual");

  // ── Determine status ─────────────────────────────────────────────────────
  let status: QualityStatus;
  if (
    freshnessMinutes > POOR_MAX_AGE_MINUTES ||
    tempSpread > 3.0 ||
    missing.length >= 3 ||
    flags.some((f) => f === "no_observations")
  ) {
    status = "POOR";
  } else if (
    freshnessMinutes > GOOD_MAX_AGE_MINUTES ||
    tempSpread > 2.0 ||
    missing.length >= 1
  ) {
    status = "DEGRADED";
  } else {
    status = "GOOD";
  }

  return {
    status,
    freshness_minutes: Math.max(0, freshnessMinutes),
    flags,
    updated_at: latest.ts,
  };
}
