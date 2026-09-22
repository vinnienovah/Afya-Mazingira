import type { SituationResult } from "../src/lib/afya/types";

// The live situation of 22 Sep 2026, 11:45 EAT, as the AI explain calls saw it:
// WBGT 19.5 °C and rising to a 20.1 °C peak at 13:45, best hour 17:53–18:53.
const SERIES = [
  19.5, 19.6, 19.7, 19.8, 19.9, 19.9, 20, 20, 20.1, 20.1, 20.1, 20.1, 20, 19.9, 19.9, 19.8, 19.7, 19.6, 19.4,
  19.3, 19.1, 18.9, 18.7, 18.6, 18.4, 18.2, 18.1, 17.9, 17.8, 17.7, 17.6, 17.5, 17.4, 17.3, 17.2, 17.2, 17.1,
];
const START = Date.UTC(2026, 8, 22, 8, 45);

export function liveSituation(overrides: Partial<SituationResult> = {}): SituationResult {
  return {
    generated_at: "2026-09-22T08:45:00.000Z",
    location: "JKUAT/Juja Conduit station",
    demo_mode: false,
    data_source: "CONDUIT_LIVE",
    data_feed: "chords",
    quality: { status: "GOOD", freshness_minutes: 31, flags: [], updated_at: "2026-09-22T08:45:00.000Z" },
    current: {
      time: "2026-09-22T08:45:00.000Z", temperature_c: 23.9, humidity_pct: 54, pressure_hpa: 851.7,
      wind_speed_ms: 0.4, wind_direction_deg: 183, wind_gust_ms: 1, visible_signal: 549.4, infrared_signal: 3281.4,
      wet_bulb_c: 17.6, wbgt_c: 19.5, rain_observed: false,
    },
    state: {
      state_id: 2, since: "2026-09-22T08:30:00.000Z", previous_state_id: 1,
      transition_likelihood: { state_id: 1, probability: 0.61 },
    },
    forecast: [
      { horizon: "1h", value: 19.9, lower: 19.2, upper: 20.6, model: "Ridge regression", model_version: "2026-09-08" },
      { horizon: "3h", value: 20, lower: 18.8, upper: 21.2, model: "Ridge regression", model_version: "2026-09-08" },
      { horizon: "6h", value: 18.4, lower: 17.1, upper: 19.7, model: "Ridge regression", model_version: "2026-09-08" },
      { horizon: "9h", value: 17.1, lower: 15.6, upper: 18.6, model: "Ridge regression", model_version: "2026-09-08" },
    ],
    forecast_series: SERIES.map((value, i) => ({
      time: new Date(START + i * 900_000).toISOString(),
      value, lower: value - 1.2, upper: value + 1.2, horizon_minutes: i * 15,
    })),
    risk: { thermal: "ELEVATED", rain_probability: 0.25, uncertainty: "MODERATE", data_quality: "GOOD" },
    best_time: {
      recommended: {
        start: "2026-09-22T14:53:21.205Z",
        end: "2026-09-22T15:53:21.205Z",
        reasons: ["reason_lower_exposure", "reason_radiation_declining", "reason_low_rain", "reason_quality_good"],
      },
      alternative: null,
      activity: "general",
      duration_minutes: 60,
    },
    best_time_note: null,
    expected_peak: { time: "2026-09-22T10:45:00.000Z", wbgt_c: 20.1 },
    state_history_24h: [],
    contributors: [
      { feature: "usual_daily_change", direction: "increasing", contribution_c: 0.6 },
      { feature: "departure_from_usual", direction: "decreasing", contribution_c: -0.2 },
    ],
    era5: {
      available: true, era5_temp_c: 14.6, era5_dewpoint_c: 11.2, era5_relative_humidity: 80, era5_pressure_hpa: 852.9,
      era5_wind_speed_ms: 1.3, era5_wind_dir_deg: 37, era5_solar_wm2: 0, era5_precip_hourly_mm: 0,
      era5_soil_moisture: 0.18, local_temp_anomaly_c: 9.3, local_humidity_anomaly: -26, valid_time: "2026-09-17T23:00Z",
    },
    chirps: {
      available: true, source: "open-meteo-forecast", chirps_mm: 0.1, chirps_7d_mm: 14.9, chirps_30d_mm: 24.1,
      chirps_percentile: 47, chirps_dry_spell_days: 0, chirps_wet_spell_days: 10, valid_date: "2026-09-22",
      window_7d_start: "2026-09-16", window_30d_start: "2026-08-24", through: "2026-09-22T08:00:00.000Z",
    },
    sentinel: {
      sentinel2_available: true, sentinel2_acquired: "2026-09-19", sentinel2_ndvi_mean: null,
      sentinel3_available: true, sentinel3_acquired: "2026-09-21", sentinel3_lst_c: null,
    },
    regional_outlook: [],
    ...overrides,
  };
}

// The Farm page's advisory for flowering maize from the same morning.
export const LIVE_MAIZE_ADVISORY = {
  crop: { key: "maize", label_en: "Maize", label_sw: "Mahindi" },
  stage: "flowering",
  water_balance: {
    et0_mm_day: 2.41, etc_mm_day: 2.89, kc: 1.2, rain_7d_mm: 14.9, rain_30d_mm: 24.1, demand_7d_mm: 20.2,
    balance_7d_mm: -5.3, weekly_requirement_mm: 20.2, soil_moisture_pct: 18, depletion_mm: 110,
    depletion_pct: 100, taw_mm: 110, readily_available_mm: 77, depletion_fraction_adjusted: 0.7,
    balance_days: 60, balance_days_with_rain: 60, balance_available: true,
  },
  irrigation: {
    action: "IRRIGATE_NOW", depth_mm: 110, litres_per_m2: 110, days_until_irrigation: null,
    reason_keys: ["farm_reason_zone_at_raw", "farm_reason_high_et"],
    confidence: "HIGH",
  },
  spray_window: { operation: "spraying", quality: "MARGINAL", reason_keys: ["farm_reason_wind_suitable", "farm_reason_rain_possible"] },
  planting: { favourable: false, rain_30d_mm: 24.1, required_mm: 40, wetting_mm: 9.6, wetting_required_mm: 20, dry_spell_days: 0, percentile: 47, message_key: "farm_plant_insufficient" },
  stress: { level: "NONE", peak_temp_c: 24.5, mild_threshold_c: 29, reason_keys: ["farm_reason_no_heat_stress"] },
  field_work_window: { start: "2026-09-22T13:48:16.335Z", end: "2026-09-22T15:48:16.335Z", reasons: ["reason_lower_exposure"] },
  generated_at: "2026-09-22T08:45:00.000Z",
  data_quality: "GOOD",
};
