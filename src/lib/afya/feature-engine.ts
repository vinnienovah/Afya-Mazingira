import type { DemoObservation } from "./demo-observations";

// Feature vector for the forecast and state engines.
export interface FeatureVector {
  temp_sht: number;
  humidity_sht: number;
  press_bmx: number;
  wind_spd: number;
  wind_gust: number;
  si1145_vis: number;
  si1145_ir: number;
  wet_bulb_temp: number;
  wet_bulb_globe_temp: number;
  // Lags (1h = 4 steps on 15-min grid)
  temp_lag_1h: number;
  humidity_lag_1h: number;
  wbgt_lag_1h: number;
  // Deltas (1h)
  temp_delta_1h: number;
  humidity_delta_1h: number;
  pressure_delta_1h: number;
  radiation_delta_1h: number;
  // Rolling 1h statistics
  temp_mean_1h: number;
  temp_std_1h: number;
  wbgt_mean_1h: number;
  wbgt_std_1h: number;
  humidity_mean_1h: number;
  // Cyclic
  hour_sin: number;
  hour_cos: number;
  doy_sin: number;
  doy_cos: number;
}

/** Inputs to the WBGT forecast, in the order its coefficients are stored. */
export const FORECAST_FEATURES: (keyof FeatureVector)[] = [
  "temp_sht", "humidity_sht", "press_bmx", "wind_spd", "wind_gust",
  "si1145_vis", "si1145_ir", "wet_bulb_temp", "wet_bulb_globe_temp",
  "temp_lag_1h", "humidity_lag_1h", "wbgt_lag_1h",
  "temp_delta_1h", "humidity_delta_1h", "pressure_delta_1h", "radiation_delta_1h",
  "temp_mean_1h", "temp_std_1h", "wbgt_mean_1h", "wbgt_std_1h",
  "humidity_mean_1h", "hour_sin", "hour_cos", "doy_sin", "doy_cos",
];

/** Inputs to the environmental state clustering. */
export const STATE_FEATURES: (keyof FeatureVector)[] = [
  "temp_sht", "humidity_sht", "si1145_vis", "si1145_ir",
  "wind_spd", "wet_bulb_globe_temp", "wet_bulb_temp",
  "temp_delta_1h", "humidity_delta_1h", "radiation_delta_1h",
  "temp_mean_1h", "wbgt_mean_1h", "temp_std_1h",
  "hour_sin", "hour_cos",
];

/** Station fields the features are built from. A slot where any of them was
 * filled in rather than measured is left out when the models are fitted. */
export const FEATURE_SOURCE_FIELDS = [
  "temp_sht", "humidity_sht", "press_bmx", "wind_spd", "si1145_vis", "si1145_ir", "wet_bulb_temp",
];

/** Compute a full feature vector from an observation series ending at `atIndex`. */
export function computeFeatures(
  series: DemoObservation[],
  atIndex: number,
): FeatureVector | null {
  if (atIndex < 4) return null; // need at least 1h of history for lags

  const obs = (i: number) => series[atIndex - i];
  const cur = obs(0);
  const lag4 = obs(4);

  const rolling = (field: keyof DemoObservation, steps: number) => {
    const slice = series.slice(Math.max(0, atIndex - steps + 1), atIndex + 1);
    const vals = slice.map((o) => o[field] as number).filter((v) => !isNaN(v));
    if (!vals.length) return { mean: 0, std: 0 };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std =
      vals.length > 1
        ? Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (vals.length - 1))
        : 0;
    return { mean, std };
  };

  const ts = new Date(cur.ts);
  const eatMs = ts.getTime() + 3 * 3600 * 1000;
  const eatDate = new Date(eatMs);
  const hour = eatDate.getUTCHours() + eatDate.getUTCMinutes() / 60;
  const doy =
    Math.floor(
      (ts.getTime() - new Date(ts.getUTCFullYear(), 0, 1).getTime()) / 86400000,
    ) + 1;

  const tempR = rolling("temp_sht", 4);
  const wbgtR = rolling("wet_bulb_globe_temp", 4);
  const humR = rolling("humidity_sht", 4);

  return {
    temp_sht: cur.temp_sht,
    humidity_sht: cur.humidity_sht,
    press_bmx: cur.press_bmx,
    wind_spd: cur.wind_spd,
    wind_gust: cur.wind_gust,
    si1145_vis: cur.si1145_vis,
    si1145_ir: cur.si1145_ir,
    wet_bulb_temp: cur.wet_bulb_temp,
    wet_bulb_globe_temp: cur.wet_bulb_globe_temp,
    temp_lag_1h: lag4.temp_sht,
    humidity_lag_1h: lag4.humidity_sht,
    wbgt_lag_1h: lag4.wet_bulb_globe_temp,
    temp_delta_1h: cur.temp_sht - lag4.temp_sht,
    humidity_delta_1h: cur.humidity_sht - lag4.humidity_sht,
    pressure_delta_1h: cur.press_bmx - lag4.press_bmx,
    radiation_delta_1h: cur.si1145_ir - lag4.si1145_ir,
    temp_mean_1h: tempR.mean,
    temp_std_1h: tempR.std,
    wbgt_mean_1h: wbgtR.mean,
    wbgt_std_1h: wbgtR.std,
    humidity_mean_1h: humR.mean,
    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    doy_sin: Math.sin((2 * Math.PI * doy) / 365.25),
    doy_cos: Math.cos((2 * Math.PI * doy) / 365.25),
  };
}

/** Build all feature vectors for a full observation series. */
export function buildFeatureSeries(series: DemoObservation[]): (FeatureVector | null)[] {
  return series.map((_, i) => computeFeatures(series, i));
}
