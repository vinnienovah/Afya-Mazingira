// AFYA MAZINGIRA · Standards-grade WBGT (Liljegren et al. 2008)
//
//   WBGT = 0.7 × natural wet bulb + 0.2 × globe temperature + 0.1 × air temperature
//
// A weather station measures neither the natural wet bulb (a wet wick in the
// open air, warmed by the sun and cooled by evaporation) nor the globe
// temperature (a black sphere in the sun). Both are modelled here from air
// temperature, humidity, pressure, wind speed and solar irradiance: each is
// the temperature at which the heat the globe or the wick gains from sunlight
// and the sky balances the heat it loses to the air.
//
// Reference: Liljegren, J. C., Carhart, R. A., Lawday, P., Tschopp, S. and
// Sharp, R. (2008). Modeling the wet bulb globe temperature using standard
// meteorological measurements. Journal of Occupational and Environmental
// Hygiene 5(10), 645-655. https://doi.org/10.1080/15459620802310770
//
// The heat-balance equations, constants and property correlations below follow
// WBGT version 1.1 by James C. Liljegren, distributed under this notice:
//
//     Copyright © 2008, UChicago Argonne, LLC
//     All Rights Reserved
//
//     WBGT, Version 1.1
//
//     James C. Liljegren
//     Decision & Information Sciences Division
//
//     OPEN SOURCE LICENSE
//
//     Redistribution and use in source and binary forms, with or without
//     modification, are permitted provided that the following conditions are met:
//
//     1. Redistributions of source code must retain the above copyright notice,
//        this list of conditions and the following disclaimer. Software changes,
//        modifications, or derivative works, should be noted with comments and
//        the author and organization's name.
//     2. Redistributions in binary form must reproduce the above copyright
//        notice, this list of conditions and the following disclaimer in the
//        documentation and/or other materials provided with the distribution.
//     3. Neither the names of UChicago Argonne, LLC or the Department of Energy
//        nor the names of its contributors may be used to endorse or promote
//        products derived from this software without specific prior written
//        permission.
//     4. The software and the end-user documentation included with the
//        redistribution, if any, must include the following acknowledgment:
//
//        "This product includes software produced by UChicago Argonne, LLC under
//        Contract No. DE-AC02-06CH11357 with the Department of Energy."
//
//     DISCLAIMER
//
//     THE SOFTWARE IS SUPPLIED "AS IS" WITHOUT WARRANTY OF ANY KIND.
//
//     NEITHER THE UNITED STATES GOVERNMENT, NOR THE UNITED STATES DEPARTMENT OF
//     ENERGY, NOR UCHICAGO ARGONNE, LLC, NOR ANY OF THEIR EMPLOYEES, MAKES ANY
//     WARRANTY, EXPRESS OR IMPLIED, OR ASSUMES ANY LEGAL LIABILITY OR
//     RESPONSIBILITY FOR THE ACCURACY, COMPLETENESS, OR USEFULNESS OF ANY
//     INFORMATION, DATA, APPARATUS, PRODUCT, OR PROCESS DISCLOSED, OR REPRESENTS
//     THAT ITS USE WOULD NOT INFRINGE PRIVATELY OWNED RIGHTS.
//
// Changes, September 2026, GKamundia for Afya Mazingira: rewritten in
// TypeScript from the project's own Python port of v1.1; the globe and wick
// balances are solved by bisection instead of relaxed fixed-point iteration;
// for hourly inputs the top-of-atmosphere irradiance and the sun angle are
// averaged over the hour (see `wbgtForHour`); the sun's position comes from
// solar-position.ts (NOAA equations).
//
// The original stops its iteration at 0.02 K. Bisection on the same balance
// always converges and finds the root far closer than that, so the results
// agree with the original to within its own tolerance.

import { hourlySun } from "./solar-position";

export const SOLAR_CONSTANT = 1367.0; // W/m²
const STEFAN_BOLTZMANN = 5.6696e-8; // W/(m² K⁴)
const CP_AIR = 1003.5; // J/(kg K)
const M_AIR = 28.97; // g/mol
const M_H2O = 18.015;
const R_AIR = 8314.34 / M_AIR; // J/(kg K)
const RATIO = (CP_AIR * M_AIR) / M_H2O;
const PRANDTL = CP_AIR / (CP_AIR + 1.25 * R_AIR);

const WICK_EMISSIVITY = 0.95;
const WICK_ALBEDO = 0.4;
const WICK_DIAMETER = 0.007; // m
const WICK_LENGTH = 0.0254; // m
const GLOBE_EMISSIVITY = 0.95;
const GLOBE_ALBEDO = 0.05;
const GLOBE_DIAMETER = 0.0508; // m, the standard 2-inch globe
const SURFACE_EMISSIVITY = 0.999;
const SURFACE_ALBEDO = 0.45;

/** Below this cos zenith the sun is not clear of the horizon and all sunlight counts as diffuse. */
const MIN_COS_ZENITH = 0.00873;
/** Surface irradiance above this share of the top-of-atmosphere value is taken as a sensor error. */
export const MAX_CLEARNESS = 0.85;
export const REFERENCE_HEIGHT_M = 2.0;
export const MIN_WIND_MS = 0.13;

// Wind-profile exponents by stability class 1 (very unstable) to 6 (stable).
const URBAN_EXPONENTS = [0.15, 0.15, 0.2, 0.25, 0.3, 0.3];
const RURAL_EXPONENTS = [0.07, 0.07, 0.1, 0.15, 0.35, 0.55];

/** Over liquid water, hPa: Buck (1981), times 1.004 for moist air above 800 hPa. */
export function saturationVapourPressure(tK: number): number {
  return 1.004 * 6.1121 * Math.exp((17.502 * (tK - 273.15)) / (tK - 32.18));
}

/** Viscosity of air, kg/(m s). */
function viscosity(tK: number): number {
  const omega = ((tK / 97.0 - 2.9) / 0.4) * -0.034 + 1.048;
  return (2.6693e-6 * Math.sqrt(M_AIR * tK)) / (3.617 ** 2 * omega);
}

/** Thermal conductivity of air, W/(m K). */
function conductivity(tK: number): number {
  return (CP_AIR + 1.25 * R_AIR) * viscosity(tK);
}

/** Diffusivity of water vapour in air, m²/s. */
function diffusivity(tK: number, pHpa: number): number {
  const critical =
    (36.4 * 218.0) ** (1 / 3) * (132.0 * 647.3) ** (5 / 12) * Math.sqrt(1 / M_AIR + 1 / M_H2O);
  return (
    ((3.64e-4 * (tK / Math.sqrt(132.0 * 647.3)) ** 2.334 * critical) / (pHpa / 1013.25)) * 1e-4
  );
}

/** Latent heat of evaporation, J/kg. */
function latentHeat(tK: number): number {
  return ((313.15 - tK) / 30.0) * -71100.0 + 2.4073e6;
}

function density(tK: number, pHpa: number): number {
  return (pHpa * 100.0) / (R_AIR * tK);
}

function skyEmissivity(tK: number, rh: number): number {
  return 0.575 * (rh * saturationVapourPressure(tK)) ** 0.143;
}

function reynolds(diameter: number, tK: number, pHpa: number, wind: number): number {
  return (Math.max(wind, MIN_WIND_MS) * density(tK, pHpa) * diameter) / viscosity(tK);
}

/** Heat transfer coefficient of a sphere, W/(m² K). */
function globeConvection(tK: number, pHpa: number, wind: number): number {
  const nusselt = 2.0 + 0.6 * Math.sqrt(reynolds(GLOBE_DIAMETER, tK, pHpa, wind)) * PRANDTL ** 0.3333;
  return (nusselt * conductivity(tK)) / GLOBE_DIAMETER;
}

/** Heat transfer coefficient of a cylinder in cross flow, W/(m² K). */
function wickConvection(tK: number, pHpa: number, wind: number): number {
  const nusselt = 0.281 * reynolds(WICK_DIAMETER, tK, pHpa, wind) ** 0.6 * PRANDTL ** 0.44;
  return (nusselt * conductivity(tK)) / WICK_DIAMETER;
}

/**
 * Root of an increasing function between `low` and `high`.
 * NaN wherever the bracket holds no root, which includes any missing input.
 */
function bisect(
  residual: (t: number) => number,
  low: number,
  high: number,
  iterations = 48,
): number {
  if (!(residual(low) <= 0 && residual(high) >= 0)) return NaN;
  for (let i = 0; i < iterations; i++) {
    const middle = 0.5 * (low + high);
    if (residual(middle) > 0) high = middle;
    else low = middle;
  }
  return 0.5 * (low + high);
}

export interface DirectBeam {
  /** Irradiance after the 85 % cap, W/m² */
  solarWm2: number;
  /** Direct-beam share of it, 0 to 0.9 */
  fdir: number;
}

/**
 * Irradiance capped at 85 % of the top-of-atmosphere value, and its direct-beam share.
 *
 * The share rises with the clearness of the sky (surface over top-of-atmosphere
 * irradiance) and stays within 0 to 0.9. Where the top-of-atmosphere value is
 * zero the irradiance is kept as it is and treated as all diffuse.
 */
export function directBeam(solarWm2: number, toaWm2: number): DirectBeam {
  const sunUp = toaWm2 > 0;
  const clearness = sunUp ? Math.min(solarWm2 / toaWm2, MAX_CLEARNESS) : 0;
  const capped = sunUp ? clearness * toaWm2 : solarWm2;
  if (!(clearness > 0)) return { solarWm2: capped, fdir: 0 };
  const share = Math.exp(3 - 1.34 * clearness - 1.65 / clearness);
  return { solarWm2: capped, fdir: Math.min(Math.max(share, 0), 0.9) };
}

export interface WbgtInputs {
  airTempC: number;
  rhPct: number;
  pressureHpa: number;
  /** At 2 m */
  windMs: number;
  /** Capped irradiance from `directBeam` */
  solarWm2: number;
  /** Direct-beam share from `directBeam` */
  fdir: number;
  cosZenith: number;
}

/**
 * Black globe temperature, K.
 *
 * Balance: the globe emits σT⁴ and loses h(T − Ta) to the air; it absorbs half
 * the sky's and half the ground's long-wave radiation, the diffuse and
 * ground-reflected sunlight, and the direct beam on its cross-section.
 */
function globeTemperature(tAirK: number, inputs: WbgtInputs, rh: number): number {
  const { pressureHpa, windMs, solarWm2, fdir, cosZenith } = inputs;
  const longWave = 0.5 * (skyEmissivity(tAirK, rh) + SURFACE_EMISSIVITY) * tAirK ** 4;
  const beam = fdir > 0 ? fdir * (1 / (2 * cosZenith) - 1) : 0;
  const shortWave =
    (solarWm2 / (2 * STEFAN_BOLTZMANN * GLOBE_EMISSIVITY)) *
    (1 - GLOBE_ALBEDO) *
    (beam + 1 + SURFACE_ALBEDO);
  const gained = longWave + shortWave;

  return bisect(
    (tGlobe) =>
      tGlobe ** 4 +
      (globeConvection(0.5 * (tGlobe + tAirK), pressureHpa, windMs) /
        (STEFAN_BOLTZMANN * GLOBE_EMISSIVITY)) *
        (tGlobe - tAirK) -
      gained,
    tAirK - 60,
    tAirK + 100,
  );
}

/**
 * Wet-wick temperature, K: the natural wet bulb, or with `radiative` false the
 * psychrometric wet bulb (the same wick, shaded and exchanging no radiation).
 *
 * Balance: evaporation cools the wick below the air; convection from the air
 * and, for the natural wet bulb, sunlight and long-wave radiation warm it.
 */
function wetBulbTemperature(
  tAirK: number,
  inputs: WbgtInputs,
  rh: number,
  radiative: boolean,
): number {
  const { pressureHpa, windMs, solarWm2, fdir, cosZenith } = inputs;
  const eAir = rh * saturationVapourPressure(tAirK);
  const shape = (0.25 * WICK_DIAMETER) / WICK_LENGTH;
  const tanZenith = fdir > 0 ? Math.tan(Math.acos(cosZenith)) : 0;
  const sunlight =
    (1 - WICK_ALBEDO) *
    solarWm2 *
    ((1 - fdir) * (1 + shape) + fdir * (tanZenith / Math.PI + shape) + SURFACE_ALBEDO);
  const skyAndGround =
    STEFAN_BOLTZMANN *
    WICK_EMISSIVITY *
    0.5 *
    (skyEmissivity(tAirK, rh) + SURFACE_EMISSIVITY) *
    tAirK ** 4;

  return bisect(
    (tWick) => {
      const tFilm = 0.5 * (tWick + tAirK);
      const eWick = saturationVapourPressure(tWick);
      const schmidt =
        viscosity(tFilm) / (density(tFilm, pressureHpa) * diffusivity(tFilm, pressureHpa));
      const cooling =
        (((latentHeat(tFilm) / RATIO) * (eWick - eAir)) / (pressureHpa - eWick)) *
        (PRANDTL / schmidt) ** 0.56;
      let warming = 0;
      if (radiative) {
        const absorbed =
          skyAndGround - STEFAN_BOLTZMANN * WICK_EMISSIVITY * tWick ** 4 + sunlight;
        warming = absorbed / wickConvection(tFilm, pressureHpa, windMs);
      }
      return tWick - (tAirK - cooling + warming);
    },
    tAirK - 60,
    tAirK + 40,
  );
}

export interface WbgtResult {
  /** Black globe temperature, °C */
  globeC: number;
  /** Natural wet bulb, °C */
  naturalWetBulbC: number;
  /** Psychrometric wet bulb, °C */
  psychrometricWetBulbC: number;
  /** °C */
  wbgtC: number;
}

/**
 * Globe, natural wet bulb, psychrometric wet bulb and WBGT, all in °C.
 *
 * `solarWm2` and `fdir` are the capped irradiance and its direct-beam share
 * from `directBeam`; `windMs` is at 2 m. A missing input gives missing outputs.
 */
export function liljegren(inputs: WbgtInputs): WbgtResult {
  const tAirK = inputs.airTempC + 273.15;
  const rh = Math.min(Math.max(inputs.rhPct, 0), 100) / 100;
  const globeC = globeTemperature(tAirK, inputs, rh) - 273.15;
  const naturalWetBulbC = wetBulbTemperature(tAirK, inputs, rh, true) - 273.15;
  return {
    globeC,
    naturalWetBulbC,
    psychrometricWetBulbC: wetBulbTemperature(tAirK, inputs, rh, false) - 273.15,
    wbgtC: 0.1 * inputs.airTempC + 0.2 * globeC + 0.7 * naturalWetBulbC,
  };
}

// Pasquill-Gifford day table, wind class (rows, <2, 2-3, 3-5, 5-6, ≥6 m/s) by
// solar class (columns, ≥925, 675-925, 175-675, <175 W/m²), and the night
// table, wind class (<2, 2-2.5, ≥2.5 m/s) by the sign of the vertical
// temperature difference.
const DAY_STABILITY = [
  [1, 1, 2, 4],
  [1, 2, 3, 4],
  [2, 2, 3, 4],
  [3, 3, 4, 4],
  [3, 4, 4, 4],
];
const NIGHT_STABILITY = [
  [5, 6],
  [5, 6],
  [4, 4],
];

/** Index of the first edge `x` falls short of, as numpy's digitize gives it. */
function bucket(x: number, edges: number[]): number {
  let index = 0;
  while (index < edges.length && x >= edges[index]) index++;
  return index;
}

/**
 * Pasquill-Gifford stability class, 1 (very unstable) to 6 (stable).
 *
 * By day from wind speed and solar irradiance; by night from wind speed and
 * the vertical temperature difference (upper minus lower, °C), taken as 0 when
 * it is not measured. Method: US EPA (2000), Meteorological Monitoring Guidance
 * for Regulatory Modeling Applications, section 6.2.5.
 */
export function stabilityClass(
  daytime: boolean,
  windMs: number,
  solarWm2: number,
  deltaTC = 0,
): number {
  if (daytime) {
    const row = bucket(windMs, [2.0, 3.0, 5.0, 6.0]);
    return DAY_STABILITY[row][3 - bucket(solarWm2, [175.0, 675.0, 925.0])];
  }
  return NIGHT_STABILITY[bucket(windMs, [2.0, 2.5])][deltaTC >= 0 ? 1 : 0];
}

/** Wind speed at 2 m from a measurement at `heightM`, by a stability-dependent power law. */
export function windAtReferenceHeight(
  windMs: number,
  heightM: number,
  stability: number,
  urban = false,
): number {
  if (heightM === REFERENCE_HEIGHT_M) return windMs;
  const exponent = (urban ? URBAN_EXPONENTS : RURAL_EXPONENTS)[stability - 1];
  return Math.max(windMs * (REFERENCE_HEIGHT_M / heightM) ** exponent, MIN_WIND_MS);
}

export interface HourlyWbgtInputs {
  /** Start of the hour, epoch milliseconds UTC */
  hourStartMs: number;
  /** Hour mean air temperature, °C */
  airTempC: number;
  rhPct: number;
  /** Station pressure, hPa */
  pressureHpa: number;
  windMs: number;
  /** Estimated global horizontal irradiance, W/m² */
  ghiWm2: number;
  latitude: number;
  longitude: number;
  /** Height the wind was measured at; 2 m means it is used as measured */
  windHeightM?: number;
  urban?: boolean;
}

export interface HourlyWbgt extends WbgtResult {
  hourStartMs: number;
  /** Mean cos zenith over the sunlit part of the hour */
  cosZenith: number;
  /** Irradiance after the clearness cap, W/m² */
  solarWm2: number;
  fdir: number;
  wind2mMs: number;
}

/**
 * WBGT for one hour of mean inputs.
 *
 * The inputs are hour averages, so the sun is too. The top-of-atmosphere
 * irradiance that GHI is compared with is the hour's mean, which keeps the
 * sunrise and sunset hours from being read as unusually clear or dull; the
 * direct beam arrives at the hour's mean sun angle while the sun is up. The
 * original instead takes the sun angle at the middle of the averaging period,
 * which puts the sunset hour's sun on or below the horizon.
 */
export function wbgtForHour(inputs: HourlyWbgtInputs): HourlyWbgt {
  const { hourStartMs, latitude, longitude, windMs, ghiWm2 } = inputs;
  const sun = hourlySun(hourStartMs, latitude, longitude);
  const cosZenith = sun.cosZenithSunlit;
  const toa =
    cosZenith >= MIN_COS_ZENITH
      ? (SOLAR_CONSTANT * sun.cosZenithHour) / sun.earthSunDistanceAu ** 2
      : 0;
  const { solarWm2, fdir } = directBeam(ghiWm2, toa);

  const stability = stabilityClass(cosZenith > 0, windMs, solarWm2);
  const wind2mMs = windAtReferenceHeight(
    windMs,
    inputs.windHeightM ?? REFERENCE_HEIGHT_M,
    stability,
    inputs.urban ?? false,
  );

  const result = liljegren({
    airTempC: inputs.airTempC,
    rhPct: inputs.rhPct,
    pressureHpa: inputs.pressureHpa,
    windMs: wind2mMs,
    solarWm2,
    fdir,
    cosZenith,
  });
  return { hourStartMs, cosZenith, solarWm2, fdir, wind2mMs, ...result };
}
