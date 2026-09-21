// AFYA MAZINGIRA shared domain types
// Language-neutral. No UI strings here, only scientific values and categories.

export type QualityStatus = "GOOD" | "DEGRADED" | "POOR";
export type RiskLevel = "LOW" | "ELEVATED" | "HIGH" | "VERY_HIGH";
export type StateId = 0 | 1 | 2 | 3;
export type UncertaintyCategory = "LOW" | "MODERATE" | "HIGH";
export type Lang = "en" | "sw";
export type Provenance =
  | "MEASURED"
  | "PREDICTED"
  | "SATELLITE_DERIVED"
  | "REGIONAL_MODEL"
  | "HISTORICAL"
  | "DERIVED";

export interface IsoTime {
  iso: string;
}

export interface ForecastPoint {
  time: string; // ISO
  value: number; // WBGT-like °C
  lower: number;
  upper: number;
  horizon_minutes: number; // 0 for now point
}

export interface HorizonForecast {
  horizon: "1h" | "3h" | "6h" | "9h";
  value: number;
  lower: number;
  upper: number;
  model: string;
  model_version: string;
}

export interface CurrentObservation {
  time: string;
  temperature_c: number;
  humidity_pct: number;
  pressure_hpa: number;
  wind_speed_ms: number;
  wind_direction_deg: number;
  wind_gust_ms: number;
  visible_signal: number;
  infrared_signal: number;
  wet_bulb_c: number;
  wbgt_c: number;
  rain_observed: boolean;
}

export interface EnvironmentalState {
  state_id: StateId;
  since: string;
  previous_state_id: StateId | null;
  transition_likelihood: { state_id: StateId; probability: number } | null;
}

export interface StateSegment {
  state_id: StateId;
  start: string;
  end: string;
}

export interface DataQuality {
  status: QualityStatus;
  freshness_minutes: number;
  flags: string[];
  updated_at: string;
}

export interface RiskAssessment {
  thermal: RiskLevel;
  rain_probability: number; // 0–1
  uncertainty: UncertaintyCategory;
  data_quality: QualityStatus;
}

export interface BestWindow {
  start: string;
  end: string;
  reasons: string[]; // reason keys, i18n resolved on client
}

export interface AlternativeWindow {
  start: string;
  end: string;
}

export interface BestTimeResult {
  recommended: BestWindow;
  alternative: AlternativeWindow | null;
  activity: string;
  duration_minutes: number;
}

export interface Era5Context {
  // False when ERA5-Land could not be fetched and the values are placeholders.
  available?: boolean;
  era5_temp_c: number;
  era5_dewpoint_c: number;
  era5_relative_humidity: number;
  era5_pressure_hpa: number;
  era5_wind_speed_ms: number;
  era5_wind_dir_deg: number;
  era5_solar_wm2: number;
  era5_precip_hourly_mm: number;
  era5_soil_moisture: number;
  local_temp_anomaly_c: number;
  local_humidity_anomaly: number;
  valid_time: string;
}

export interface ChirpsContext {
  // False when the rainfall could not be fetched and the values are placeholders.
  available?: boolean;
  chirps_mm: number;
  chirps_7d_mm: number;
  chirps_30d_mm: number;
  chirps_percentile: number;
  chirps_dry_spell_days: number;
  chirps_wet_spell_days: number;
  valid_date: string;
}

export interface SentinelContext {
  sentinel2_available: boolean;
  sentinel2_acquired: string | null;
  sentinel2_ndvi_mean: number | null;
  sentinel3_available: boolean;
  sentinel3_acquired: string | null;
  sentinel3_lst_c: number | null;
}

export interface Contributor {
  feature: string; // feature key (i18n on client)
  direction: "increasing" | "high" | "low" | "stable";
}

export interface SituationResult {
  generated_at: string;
  location: string;
  demo_mode: boolean;
  data_source: "CONDUIT_LIVE" | "CONDUIT_ARCHIVE" | "DEMO";
  // Which live feed served the station data: JHUB's Conduit API or the CHORDS portal.
  data_feed?: "jhub" | "chords" | null;
  quality: DataQuality;
  current: CurrentObservation;
  state: EnvironmentalState;
  forecast: HorizonForecast[];
  forecast_series: ForecastPoint[];
  risk: RiskAssessment;
  best_time: BestTimeResult | null;
  expected_peak: { time: string; wbgt_c: number } | null;
  state_history_24h: StateSegment[];
  contributors: Contributor[];
  era5: Era5Context;
  chirps: ChirpsContext;
  sentinel: SentinelContext;
  // Real Open-Meteo forecast (not the ERA5 archive), independent of the
  // Conduit station's freshness, the only channel that still supports
  // planning once the ground-truth forecast has aged past its own horizon.
  regional_outlook: { time: string; wbgt_like: number }[];
}

// Candidate window for the Best-Time engine
export interface CandidateWindow {
  start: string; // ISO
  end: string;
  risk_rank: number;
  peak_exposure: number;
  rain_probability: number;
  uncertainty_width: number;
  mean_exposure: number;
  reasons: string[];
}
