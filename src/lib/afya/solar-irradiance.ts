// AFYA MAZINGIRA · Solar irradiance from the light sensor
// The SI1145 reports counts, not W/m², and its response is not proportional:
// against ERA5 it gives about half as many counts per W/m² at 07:00 as at
// noon, the usual sign of a cheap sensor under a housing that sees less of a
// low sun. So the infrared counts are scaled by a factor that depends on how
// high the sun is:
//
//   GHI = (IR counts - dark floor) × (a + b × (1 - μ))
//
// μ is the hour's mean cosine of the solar zenith angle. a, b and the dark
// floor were fitted by least squares against ERA5 in the Python project that
// owns the reference join; they are copied into model/solar-calibration.json
// with the window they were fitted over and their held-out skill, and are not
// refitted here.
//
// THIS IS AN ESTIMATE, NOT A MEASUREMENT. The station carries no pyranometer.
// Held out day by day the fit explains 67 % of the variance of daylight hours
// over 110 hours of 10 days, with an RMSE near 155 W/m² and a low bias near
// 41 W/m². Anything computed from it inherits that spread, and every number
// that reaches a reader has to carry it.

import calibration from "./model/solar-calibration.json";

export interface SolarCalibration {
  formula: string;
  dark_floor_counts: number;
  a: number;
  b: number;
  reference: string;
  first_day: string;
  last_day: string;
  n_days: number;
  n_hours: number;
  held_out: Record<string, { n_hours: number; rmse_wm2: number; mae_wm2: number; bias_wm2: number; r2: number }>;
}

export const SOLAR_CALIBRATION: SolarCalibration = calibration;

/**
 * Estimated global horizontal irradiance, W/m², from the hour's mean infrared
 * counts and its mean cos zenith. Zero whenever the sun is down, which needs
 * no sensor; never negative, since counts below the dark floor are noise.
 */
export function estimateGhi(
  irCounts: number,
  cosZenith: number,
  fit: SolarCalibration = SOLAR_CALIBRATION,
): number {
  if (!Number.isFinite(irCounts) || !Number.isFinite(cosZenith)) return NaN;
  if (!(cosZenith > 0)) return 0;
  const net = Math.max(irCounts - fit.dark_floor_counts, 0);
  return Math.max(net * (fit.a + fit.b * (1 - cosZenith)), 0);
}

/** The one-line uncertainty that has to travel with anything derived from `estimateGhi`. */
export function irradianceUncertaintyNote(fit: SolarCalibration = SOLAR_CALIBRATION): string {
  const daylight = fit.held_out.daylight;
  return (
    `Irradiance is estimated from the SI1145 infrared counts, not measured: held-out r² ${daylight.r2}, ` +
    `RMSE ${daylight.rmse_wm2} W/m², bias ${daylight.bias_wm2} W/m² over ${daylight.n_hours} daylight hours ` +
    `of ${fit.n_days} days (${fit.first_day} to ${fit.last_day}) against ${fit.reference}.`
  );
}
