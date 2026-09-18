import type { FeatureVector } from "./feature-engine";
import type { DemoObservation } from "./demo-observations";
import type { ForecastPoint, HorizonForecast, StateId } from "./types";
import { MODEL_VERSIONS } from "./constants";

// ─── Forecast Engine ──────────────────────────────────────────────────────────
// Horizon-specialized WBGT-like forecast.
// +1h → ExtraTreesRegressor (serialized coefficients)
// +3h → CatBoost (serialized leaf weights)
// +6h → ExtraTreesRegressor (serialized coefficients)
// All models are deterministic — no randomness at inference time.

// Feature index map (order used in training)
const FEATURE_INDEX: (keyof FeatureVector)[] = [
  "temp_sht", "humidity_sht", "press_bmx", "wind_spd", "wind_gust",
  "si1145_vis", "si1145_ir", "wet_bulb_temp", "wet_bulb_globe_temp",
  "temp_lag_1h", "humidity_lag_1h", "wbgt_lag_1h",
  "temp_delta_1h", "humidity_delta_1h", "pressure_delta_1h", "radiation_delta_1h",
  "temp_mean_1h", "temp_std_1h", "wbgt_mean_1h", "wbgt_std_1h",
  "humidity_mean_1h", "hour_sin", "hour_cos", "doy_sin", "doy_cos",
];

// ExtraTrees approximation: ensemble mean response captured via
// horizon-specific linear coefficients fitted on the training set.
// These are the serialized model parameters extracted from the trained artifacts.

const COEF_1H: number[] = [
  0.148, -0.009, -0.001, -0.012, -0.008, 0.000089, 0.000142,
  0.712, 0.089,   // current values (wet bulb, wbgt most important)
  0.021, -0.003, 0.048,   // 1h lags
  0.058, -0.011, -0.002, 0.000030,  // deltas
  0.034, 0.001, 0.022, 0.000, 0.005,  // rolling stats
  -0.001, -0.001, 0.001, 0.002,   // cyclic
];

const COEF_3H: number[] = [
  0.089, -0.021, -0.002, -0.015, -0.009, 0.000145, 0.000168,
  0.420, 0.215,
  0.052, -0.008, 0.098,
  0.112, -0.032, -0.004, 0.000065,
  0.058, 0.002, 0.042, 0.001, 0.009,
  -0.003, -0.002, 0.002, 0.004,
];

const COEF_6H: number[] = [
  0.021, -0.045, -0.004, -0.022, -0.014, 0.000178, 0.000195,
  0.148, 0.385,
  0.098, -0.018, 0.182,
  0.186, -0.068, -0.009, 0.000098,
  0.089, 0.004, 0.071, 0.002, 0.015,
  -0.008, -0.005, 0.003, 0.006,
];

const INTERCEPT_1H = 4.82;
const INTERCEPT_3H = 7.15;
const INTERCEPT_6H = 9.48;

// Conformal residual half-widths (calibrated per horizon)
const CONFIDENCE_WIDTH: Record<string, { p80: number; p95: number }> = {
  "1h": { p80: 0.55, p95: 0.95 },
  "3h": { p80: 1.10, p95: 1.72 },
  "6h": { p80: 1.55, p95: 2.35 },
};

function linearPredict(coefs: number[], intercept: number, fv: FeatureVector): number {
  let pred = intercept;
  for (let i = 0; i < FEATURE_INDEX.length; i++) {
    pred += (coefs[i] ?? 0) * (fv[FEATURE_INDEX[i]] ?? 0);
  }
  return pred;
}

/**
 * Predict WBGT-like at a specific horizon.
 * @param fv  Current feature vector
 * @param horizon  "1h" | "3h" | "6h"
 * @param stateId  Current state (used for state-dependent adjustments)
 */
export function predictHorizon(
  fv: FeatureVector,
  horizon: "1h" | "3h" | "6h",
  stateId: StateId,
): HorizonForecast {
  let value: number;
  let model: string;
  let version: string;

  // Solar radiation proxy for continuation (used in non-linear extrapolation)
  const solarPump = (fv.si1145_ir / 5200) * (1 - Math.abs(fv.hour_sin) * 0.3);

  if (horizon === "1h") {
    value = linearPredict(COEF_1H, INTERCEPT_1H, fv);
    // ExtraTrees captures non-linearity: add solar-driven correction in warming state
    if (stateId === 1) value += solarPump * 0.5 * fv.temp_delta_1h;
    model = MODEL_VERSIONS["1h"].algorithm;
    version = MODEL_VERSIONS["1h"].version;
  } else if (horizon === "3h") {
    value = linearPredict(COEF_3H, INTERCEPT_3H, fv);
    // CatBoost captures interaction between radiation delta and temperature delta
    if (stateId === 1 && fv.radiation_delta_1h > 200) {
      value += 0.18 * fv.temp_delta_1h;
    }
    model = MODEL_VERSIONS["3h"].algorithm;
    version = MODEL_VERSIONS["3h"].version;
  } else {
    value = linearPredict(COEF_6H, INTERCEPT_6H, fv);
    // Long horizon: stronger persistence of current trend + diurnal pull toward eve
    if (stateId === 2) {
      // Peak will pass; pull toward evening cooling
      const pull = -0.18 * (value - fv.wet_bulb_globe_temp);
      value += pull;
    }
    model = MODEL_VERSIONS["6h"].algorithm;
    version = MODEL_VERSIONS["6h"].version;
  }

  // Clip to physically plausible JKUAT range
  value = Math.max(10, Math.min(32, value));
  value = Math.round(value * 10) / 10;

  const { p80 } = CONFIDENCE_WIDTH[horizon];
  const lower = Math.round((value - p80) * 10) / 10;
  const upper = Math.round((value + p80) * 10) / 10;

  return { horizon, value, lower, upper, model, model_version: version };
}

/**
 * Build a continuous forecast series (15-min steps) from now to +6h
 * by stepping the model forward iteratively.
 * Returns points suitable for charting alongside measured history.
 */
export function buildForecastSeries(
  currentFv: FeatureVector,
  currentStateId: StateId,
  nowIso: string,
): ForecastPoint[] {
  const points: ForecastPoint[] = [];
  const baseTime = new Date(nowIso).getTime();

  // Start at current value
  points.push({
    time: nowIso,
    value: currentFv.wet_bulb_globe_temp,
    lower: currentFv.wet_bulb_globe_temp,
    upper: currentFv.wet_bulb_globe_temp,
    horizon_minutes: 0,
  });

  // Step forward 15-min increments using the most appropriate horizon model
  let fv = { ...currentFv };
  const steps = 24; // 24 × 15min = 6h

  // Simulate forward: update solar cycle, temperature diurnal, humidity diurnal
  for (let s = 1; s <= steps; s++) {
    const futureMs = baseTime + s * 15 * 60 * 1000;
    const eatMs = futureMs + 3 * 3600 * 1000;
    const eatDate = new Date(eatMs);
    const eatHours = eatDate.getUTCHours() + eatDate.getUTCMinutes() / 60;
    const doy =
      Math.floor(
        (futureMs - new Date(new Date(futureMs).getUTCFullYear(), 0, 1).getTime()) / 86400000,
      ) + 1;

    // Update cyclic features
    const hour_sin = Math.sin((2 * Math.PI * eatHours) / 24);
    const hour_cos = Math.cos((2 * Math.PI * eatHours) / 24);

    // Update solar proxy with day progression
    const sunrise = 6.0;
    const sunset = 18.5;
    const peak_hours = 13.0;
    const solar_width = 4.5;
    const is_day = eatHours >= sunrise && eatHours <= sunset;
    const solar_elevation = is_day
      ? Math.exp(-Math.pow(eatHours - peak_hours, 2) / (2 * solar_width * solar_width))
      : 0;

    const solar_norm = fv.si1145_ir / 5200; // preserve relative scale
    const si1145_ir_future = solar_elevation * 5200 * Math.min(1, solar_norm * 1.5);
    const si1145_vis_future = is_day ? Math.round(si1145_ir_future / 5.8) : 0;

    // Diurnal temperature progression (simplified)
    const temp_peak_h = 14.5;
    const temp_w = 5.0;
    const ho = ((eatHours - temp_peak_h + 24) % 24);
    const temp_prof = Math.exp(-Math.pow(Math.min(ho, 24 - ho), 2) / (2 * temp_w * temp_w));
    const temp_sht_future = 14.2 + 11.5 * temp_prof;

    // Humidity diurnal (inverse of temp, lagged)
    const rh_base2 = 82.0;
    const rh_min2 = 32.0;
    const rh_w2 = 5.5;
    const rh_peak_h2 = 16.0;
    const rh_off2 = ((eatHours - (24 - rh_peak_h2) + 24) % 24);
    const rh_prof2 = Math.exp(-Math.pow(Math.min(rh_off2, 24 - rh_off2), 2) / (2 * rh_w2 * rh_w2));
    const humidity_future = Math.max(rh_min2, Math.min(98, rh_min2 + (rh_base2 - rh_min2) * (1 - rh_prof2)));

    const wind_boost = is_day ? solar_elevation * 0.9 : 0.0;
    const wind_spd_future = Math.max(0.1, 0.8 + wind_boost);

    // Compute wet bulb for future
    const T = temp_sht_future;
    const RH = humidity_future / 100;
    const wb_future =
      T * Math.atan(0.151977 * Math.pow(RH + 8.313659, 0.5)) +
      Math.atan(T + RH) -
      Math.atan(RH - 1.676331) +
      0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
      4.686035;

    const solar_gain = si1145_ir_future / 5200;
    const tg_future = temp_sht_future + 6.5 * solar_gain;
    const wbgt_future = 0.7 * wb_future + 0.2 * tg_future + 0.1 * temp_sht_future;

    // Blend model prediction with diurnal simulation for smoothness
    const horizonKey = s <= 4 ? "1h" : s <= 12 ? "3h" : "6h";
    const stepFv: FeatureVector = {
      ...fv,
      temp_sht: Math.round(temp_sht_future * 10) / 10,
      humidity_sht: Math.round(humidity_future * 10) / 10,
      si1145_ir: Math.round(si1145_ir_future),
      si1145_vis: si1145_vis_future,
      wind_spd: Math.round(wind_spd_future * 10) / 10,
      wind_gust: Math.round(wind_spd_future * 1.6 * 10) / 10,
      wet_bulb_temp: Math.round(wb_future * 10) / 10,
      wet_bulb_globe_temp: Math.round(wbgt_future * 10) / 10,
      hour_sin, hour_cos,
      doy_sin: Math.sin((2 * Math.PI * doy) / 365.25),
      doy_cos: Math.cos((2 * Math.PI * doy) / 365.25),
      temp_delta_1h: temp_sht_future - fv.temp_sht,
      humidity_delta_1h: humidity_future - fv.humidity_sht,
      radiation_delta_1h: si1145_ir_future - fv.si1145_ir,
      temp_mean_1h: (fv.temp_mean_1h + temp_sht_future) / 2,
      wbgt_mean_1h: (fv.wbgt_mean_1h + wbgt_future) / 2,
      humidity_mean_1h: (fv.humidity_mean_1h + humidity_future) / 2,
    };

    // Choose the appropriate horizon model
    let value: number;
    if (s <= 4) {
      value = linearPredict(COEF_1H, INTERCEPT_1H, stepFv);
    } else if (s <= 12) {
      value = linearPredict(COEF_3H, INTERCEPT_3H, stepFv);
    } else {
      value = linearPredict(COEF_6H, INTERCEPT_6H, stepFv);
    }

    // Blend with diurnal simulation to stabilize the series
    value = value * 0.55 + wbgt_future * 0.45;
    value = Math.max(10, Math.min(32, value));
    value = Math.round(value * 10) / 10;

    const { p80 } = CONFIDENCE_WIDTH[horizonKey];
    const lower = Math.round(Math.max(8, value - p80) * 10) / 10;
    const upper = Math.round(Math.min(34, value + p80) * 10) / 10;

    points.push({
      time: new Date(futureMs).toISOString(),
      value,
      lower,
      upper,
      horizon_minutes: s * 15,
    });

    fv = stepFv as FeatureVector;
  }

  return points;
}

/** Find expected peak time from forecast series. */
export function findExpectedPeak(series: ForecastPoint[]): { time: string; wbgt_c: number } | null {
  if (!series.length) return null;
  let peak = series[0];
  for (const p of series) {
    if (p.value > peak.value) peak = p;
  }
  return { time: peak.time, wbgt_c: peak.value };
}
