// Demo / synthetic Conduit observation generator
// Produces realistic deterministic observations for the JKUAT/Juja environment.
// These are clearly labeled DEMO data, never presented as live station data.
// Uses a fixed seed so the demo is reproducible across server restarts.

import { shadeWbgt, stullWetBulb } from "./constants";

export interface DemoObservation {
  ts: string; // ISO UTC
  rg1: number;
  rg2: number;
  rg1tt: number;
  rg2tt: number;
  temp_bmx: number;
  press_bmx: number;
  temp_mcp: number;
  temp_sht: number;
  humidity_sht: number;
  si1145_vis: number;
  si1145_ir: number;
  si1145_uv: number;
  wind_spd: number;
  wind_dir: number;
  wind_gust: number;
  heat_idx: number;
  wet_bulb_temp: number;
  wet_bulb_globe_temp: number;
  // The station firmware's own WBGT column, kept for reference only. It reads
  // below the wet bulb most of the time, which a real WBGT cannot do.
  firmware_wbgt?: number | null;
  // Fields in this slot that were carried forward or defaulted rather than
  // measured. Absent or empty when every value was observed.
  imputed?: string[];
}

// Seeded pseudo-random for reproducibility
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gaussian noise (deterministic)
function gaussian(rand: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Atmospheric model
// Simulates the JKUAT/Juja Conduit environment in September (warm season).
// Kenya is in EAT (UTC+3). We simulate in EAT local hours.

function simulateAtTime(eatHours: number, doy: number, rand: () => number): Omit<DemoObservation, "ts"> {
  const g = gaussian(rand);
  const g2 = gaussian(rand);
  const g3 = gaussian(rand);
  const g4 = gaussian(rand);
  const g5 = gaussian(rand);
  const g6 = gaussian(rand);
  const g7 = gaussian(rand);

  // Solar radiation model (Kenya equatorial, September)
  // Sun rises ~06:00 EAT, sets ~18:30 EAT in September
  const sunrise = 6.0;
  const sunset = 18.5;
  const solar_day_frac = Math.max(0, Math.min(1, (eatHours - sunrise) / (sunset - sunrise)));
  // Peak radiation at ~13:00 EAT
  const peak_hours = 13.0;
  const solar_width = 4.5;
  const solar_elevation = Math.exp(-Math.pow(eatHours - peak_hours, 2) / (2 * solar_width * solar_width));
  const is_day = eatHours >= sunrise && eatHours <= sunset;

  // Cloud randomization reduces max solar
  const cloud_factor = 0.55 + 0.45 * Math.abs(Math.sin(doy * 3.7 + eatHours * 0.8));
  const si1145_ir_base = is_day ? solar_elevation * 5200 * cloud_factor : 0;
  const si1145_ir = Math.max(0, si1145_ir_base + g3 * 150 * (is_day ? 1 : 0));
  const si1145_vis_base = is_day ? solar_elevation * 900 * cloud_factor : 0;
  const si1145_vis = Math.max(0, si1145_vis_base + g4 * 30 * (is_day ? 1 : 0));

  // Temperature (°C), lags radiation by ~1.5h
  const temp_peak_hour = 14.5;
  const temp_width = 5.0;
  const temp_base = 14.2; // overnight minimum around 06:30
  const temp_amplitude = 11.5; // peak ~25.7
  const hour_offset = ((eatHours - temp_peak_hour + 24) % 24);
  const temp_day_profile = Math.exp(-Math.pow(Math.min(hour_offset, 24 - hour_offset), 2) / (2 * temp_width * temp_width));
  const temp_sht = Math.round((temp_base + temp_amplitude * temp_day_profile + g * 0.35 * (is_day ? 1 : 0.4)) * 10) / 10;

  // Secondary sensors (cross-sensor consistency)
  const temp_bmx = Math.round((temp_sht + g5 * 0.15) * 10) / 10;
  const temp_mcp = Math.round((temp_sht + g6 * 0.12) * 10) / 10;

  // Relative humidity (%RH), inverse of temperature
  const rh_base = 82.0; // overnight high
  const rh_min = 32.0; // afternoon minimum
  const rh_range = rh_base - rh_min;
  const rh_lag = 1.5; // hours behind temp
  const rh_peak_hour = temp_peak_hour + rh_lag; // morning high follows cool
  const rh_hour_offset = ((eatHours - (24 - rh_peak_hour) + 24) % 24);
  const rh_profile = Math.exp(-Math.pow(Math.min(rh_hour_offset, 24 - rh_hour_offset), 2) / (2 * 5.5 * 5.5));
  const humidity_sht = Math.max(rh_min, Math.min(98, Math.round((rh_min + rh_range * (1 - rh_profile) + g2 * 1.2) * 10) / 10));

  // Pressure (hPa, station level)
  // Nairobi/Juja altitude ~1600m, station pressure ~848 hPa with semidiurnal tides
  const semidiurnal = Math.sin(((eatHours - 10) / 12) * 2 * Math.PI) * 0.8;
  const press_bmx = Math.round((848.5 + semidiurnal + g7 * 0.15) * 10) / 10;

  // Wind
  // Light overnight, picks up with thermal contrast midday
  const wind_day_boost = is_day ? solar_elevation * 0.9 : 0.0;
  const wind_spd = Math.max(0.1, Math.round((0.8 + wind_day_boost + gaussian(rand) * 0.25) * 10) / 10);
  // ESE trade direction dominates
  const wind_dir = Math.round(((110 + g * 25) % 360) / 1) * 1;
  const wind_gust = Math.round((wind_spd * (1.5 + rand() * 0.4)) * 10) / 10;

  // Wet bulb and WBGT the same way the station series gets them
  const wet_bulb_temp = Math.round(stullWetBulb(temp_sht, humidity_sht) * 10) / 10;
  const wet_bulb_globe_temp = Math.round(shadeWbgt(temp_sht, wet_bulb_temp) * 10) / 10;

  // Heat index
  // Simplified Rothfusz regression (valid T≥27°C, RH≥40%)
  let heat_idx: number;
  if (temp_sht >= 27 && humidity_sht >= 40) {
    const Tf = (temp_sht * 9) / 5 + 32;
    heat_idx = Math.round((
      -42.379 + 2.04901523 * Tf + 10.14333127 * humidity_sht -
      0.22475541 * Tf * humidity_sht - 0.00683783 * Tf * Tf -
      0.05481717 * humidity_sht * humidity_sht +
      0.00122874 * Tf * Tf * humidity_sht +
      0.00085282 * Tf * humidity_sht * humidity_sht -
      0.00000199 * Tf * Tf * humidity_sht * humidity_sht
    - 32) * (5 / 9) * 10) / 10;
  } else {
    heat_idx = Math.round((temp_sht + 0.35) * 10) / 10;
  }

  // Rain (very rare in the dry September for this demo)
  // Occasionally a brief light shower event (probability ~2% per timestep, ~every 2 days)
  const rain_event = rand() < 0.018;
  const rg1 = rain_event ? Math.round(rand() * 2.5 * 10) / 10 : 0;
  const rg2 = rain_event ? Math.round(rg1 * (0.9 + rand() * 0.2) * 10) / 10 : 0;

  return {
    rg1, rg2,
    rg1tt: rg1, rg2tt: rg2,
    temp_bmx, press_bmx, temp_mcp, temp_sht,
    humidity_sht,
    si1145_vis: Math.round(si1145_vis),
    si1145_ir: Math.round(si1145_ir),
    si1145_uv: 0, // mostly zero per spec finding
    wind_spd, wind_dir, wind_gust,
    heat_idx, wet_bulb_temp, wet_bulb_globe_temp,
  };
}

// Generate a series of observations

/**
 * Generate 15-min grid observations around `anchor` going back `lookbackHours`.
 * @param anchor  ISO timestamp for the "now" point (or historical anchor for replay)
 * @param lookbackHours  how far back to generate (default 30 hours)
 * @param seed  default seed for reproducibility; varies by date for replay
 */
export function generateDemoSeries(
  anchor: string,
  lookbackHours = 30,
  seed?: number,
): DemoObservation[] {
  const anchorDate = new Date(anchor);
  const baseSeed = seed ?? (anchorDate.getUTCFullYear() * 10000 +
    (anchorDate.getUTCMonth() + 1) * 100 + anchorDate.getUTCDate());
  const rand = mulberry32(baseSeed);

  const observations: DemoObservation[] = [];
  const steps = Math.floor(lookbackHours * 4); // 4 per hour

  for (let i = steps - 1; i >= 0; i--) {
    const ts = new Date(anchorDate.getTime() - i * 15 * 60 * 1000);
    // Convert to EAT for simulation
    const eatOffset = 3 * 60; // minutes
    const eatMs = ts.getTime() + eatOffset * 60 * 1000;
    const eatDate = new Date(eatMs);
    const eatHours = eatDate.getUTCHours() + eatDate.getUTCMinutes() / 60;
    const doy = Math.floor(
      (ts.getTime() - Date.UTC(ts.getUTCFullYear(), 0, 1)) / 86400000,
    ) + 1;

    const fields = simulateAtTime(eatHours, doy, rand);
    observations.push({ ts: ts.toISOString(), ...fields });
  }

  return observations;
}

/**
 * Generate the historical observations for a specific replay day.
 * Generates a full 24h series ending at endHour EAT on the given date.
 */
export function generateReplayDay(
  dateStr: string, // "YYYY-MM-DD"
  endHourEAT: number, // hours EAT to generate up to
): DemoObservation[] {
  const isoAnchor = `${dateStr}T${String(endHourEAT - 3).padStart(2, "0")}:00:00Z`;
  return generateDemoSeries(isoAnchor, 26, 20260901);
}

// Context generators (ERA5, CHIRPS, Sentinel)

export function generateEra5Context(anchor: string, currentTemp: number, currentHum: number): {
  available: boolean;
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
} {
  const rand = mulberry32(42);
  const d = new Date(anchor);
  const eatMs = d.getTime() + 3 * 3600 * 1000;
  const eatDate = new Date(eatMs);
  const eatHours = eatDate.getUTCHours() + eatDate.getUTCMinutes() / 60;

  // ERA5-Land has ~9km resolution; it smooths local peaks
  const solar = Math.max(0, Math.exp(-Math.pow(eatHours - 13, 2) / (2 * 4.5 * 4.5)));
  const era5_temp_c = Math.round((23.5 - 5 * (1 - solar) + rand() * 0.4) * 10) / 10;
  const era5_dewpoint_c = Math.round((era5_temp_c - (100 - 55) / 5) * 10) / 10;
  const era5_rh = Math.max(20, Math.min(95, Math.round((55 + (1 - solar) * 20 + rand() * 3) * 10) / 10));
  const era5_pressure_hpa = Math.round(850.5 * 10) / 10;
  const era5_wind_speed_ms = Math.round((1.5 + rand() * 0.5) * 10) / 10;
  const era5_wind_dir_deg = Math.round(115 + rand() * 20);
  const era5_solar_wm2 = Math.round(solar * 850);

  return {
    available: false,
    era5_temp_c,
    era5_dewpoint_c,
    era5_relative_humidity: era5_rh,
    era5_pressure_hpa,
    era5_wind_speed_ms,
    era5_wind_dir_deg,
    era5_solar_wm2,
    era5_precip_hourly_mm: 0.0,
    era5_soil_moisture: 0.18,
    local_temp_anomaly_c: Math.round((currentTemp - era5_temp_c) * 10) / 10,
    local_humidity_anomaly: Math.round((currentHum - era5_rh) * 10) / 10,
    valid_time: anchor,
  };
}

export function generateChirpsContext(anchor: string): {
  available: boolean;
  chirps_mm: number;
  chirps_7d_mm: number;
  chirps_30d_mm: number;
  chirps_percentile: number;
  chirps_dry_spell_days: number;
  chirps_wet_spell_days: number;
  valid_date: string;
} {
  // September in Juja is relatively dry; use typical values
  const d = new Date(anchor);
  const validDate = d.toISOString().slice(0, 10);
  return {
    available: false,
    chirps_mm: 1.8,
    chirps_7d_mm: 14.7,
    chirps_30d_mm: 48.2,
    chirps_percentile: 62,
    chirps_dry_spell_days: 4,
    chirps_wet_spell_days: 1,
    valid_date: validDate,
  };
}

export function generateSentinelContext(): {
  sentinel2_available: boolean;
  sentinel2_acquired: string | null;
  sentinel2_ndvi_mean: number | null;
  sentinel3_available: boolean;
  sentinel3_acquired: string | null;
  sentinel3_lst_c: number | null;
} {
  // Without a real catalogue answer there is nothing to show; no stand-in values.
  return {
    sentinel2_available: false,
    sentinel2_acquired: null,
    sentinel2_ndvi_mean: null,
    sentinel3_available: false,
    sentinel3_acquired: null,
    sentinel3_lst_c: null,
  };
}
