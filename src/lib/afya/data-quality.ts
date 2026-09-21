import type { DataQuality, QualityStatus } from "./types";
import type { DemoObservation } from "./demo-observations";

// GOOD, DEGRADED or POOR for the latest observations. POOR suppresses strong
// recommendations. The station records about every 15 minutes, so an hour
// without a new observation is already worth saying, and advice stops after
// three hours: the forecast is only as good as the reading it starts from.

export const QUALITY_LIMITS = {
  good_max_age_minutes: 60,
  degraded_max_age_minutes: 3 * 60,
  // Share of the last six hours carried forward rather than measured before
  // the gaps are worth a warning.
  max_filled_share: 0.25,
  // Spread between the station's three thermometers.
  degraded_temp_spread_c: 2.0,
  poor_temp_spread_c: 3.0,
};

const RECENT_SLOTS = 24; // six hours of 15-minute slots

const CRITICAL_FIELDS = ["temp_sht", "humidity_sht", "wet_bulb_temp", "si1145_ir", "wind_spd"];

/**
 * Evaluate data quality from a series of observations.
 * @param series  Full observation series (most recent last)
 * @param referenceNow  The clock to measure freshness against: the real clock
 *                      for live data, the anchor for a replay or the synthetic series.
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
  const freshnessMinutes = Math.round((now - new Date(latest.ts).getTime()) / 60000);

  if (freshnessMinutes > QUALITY_LIMITS.degraded_max_age_minutes) {
    flags.push("stale_data");
  } else if (freshnessMinutes > QUALITY_LIMITS.good_max_age_minutes) {
    flags.push("observation_age_elevated");
  }

  // Critical fields in the latest slot that were not actually measured.
  const missing = CRITICAL_FIELDS.filter((f) => latest.imputed?.includes(f));
  if (missing.length > 0) flags.push(`missing_fields:${missing.join(",")}`);

  // How much of the last six hours was filled in rather than measured.
  const recent = series.slice(-RECENT_SLOTS);
  const filled = recent.filter((o) => CRITICAL_FIELDS.some((f) => o.imputed?.includes(f))).length;
  const filledShare = filled / recent.length;
  if (filledShare > QUALITY_LIMITS.max_filled_share) flags.push(`gaps_filled_recently:${filled}`);

  const tempSpread =
    Math.max(latest.temp_sht, latest.temp_bmx, latest.temp_mcp) -
    Math.min(latest.temp_sht, latest.temp_bmx, latest.temp_mcp);
  if (tempSpread > QUALITY_LIMITS.degraded_temp_spread_c) flags.push("temp_sensor_disagreement");

  if (latest.humidity_sht < 0 || latest.humidity_sht > 100) flags.push("humidity_out_of_range");
  if (latest.temp_sht < -10 || latest.temp_sht > 50) flags.push("temp_out_of_range");

  // The firmware's own WBGT is not used, but when it reads below the wet bulb
  // (physically impossible) the page says so.
  if (typeof latest.firmware_wbgt === "number" && latest.firmware_wbgt < latest.wet_bulb_temp) {
    flags.push("firmware_wbgt_below_wet_bulb");
  }

  let status: QualityStatus;
  if (
    freshnessMinutes > QUALITY_LIMITS.degraded_max_age_minutes ||
    tempSpread > QUALITY_LIMITS.poor_temp_spread_c ||
    missing.length >= 3
  ) {
    status = "POOR";
  } else if (
    freshnessMinutes > QUALITY_LIMITS.good_max_age_minutes ||
    tempSpread > QUALITY_LIMITS.degraded_temp_spread_c ||
    missing.length >= 1 ||
    filledShare > QUALITY_LIMITS.max_filled_share
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
