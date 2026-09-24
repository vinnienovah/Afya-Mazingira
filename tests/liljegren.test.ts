import { test } from "node:test";
import assert from "node:assert/strict";
import reference from "./fixtures/liljegren-reference.json";
import calibrationFile from "../src/lib/afya/model/solar-calibration.json";
import {
  cosZenith,
  earthSunDistanceAu,
  hourlyMeanCosZenith,
  hourlySun,
} from "../src/lib/afya/solar-position";
import { estimateGhi, SOLAR_CALIBRATION } from "../src/lib/afya/solar-irradiance";
import {
  directBeam,
  liljegren,
  MAX_CLEARNESS,
  MIN_WIND_MS,
  SOLAR_CONSTANT,
  saturationVapourPressure,
  stabilityClass,
  wbgtForHour,
  windAtReferenceHeight,
  type WbgtInputs,
} from "../src/lib/afya/liljegren";

const JKUAT = { latitude: -1.099736, longitude: 37.014528 };
const HOUR_MS = 3600_000;

const at = (iso: string) => Date.parse(iso);
const close = (a: number, b: number, tolerance: number, what = "") =>
  assert.ok(Math.abs(a - b) <= tolerance, `${what} ${a} vs ${b} (tolerance ${tolerance})`);

const inputs = (
  airTempC: number,
  rhPct: number,
  pressureHpa: number,
  windMs: number,
  solarWm2: number,
  fdir: number,
  cza: number,
): WbgtInputs => ({ airTempC, rhPct, pressureHpa, windMs, solarWm2, fdir, cosZenith: cza });

// Liljegren's own program (WBGT v1.1, calc_wbgt, compiled unchanged) on these
// inputs. The irradiance, direct share and cos zenith are the values it derived
// from the date, place and measured irradiance; wind is at 2 m. Its iteration
// stops at 0.02 K, which is the tolerance asserted below.
//   air degC, RH %, hPa, wind m/s, W/m2, fdir, cos zenith
//   -> globe, natural wet bulb, psychrometric wet bulb, WBGT (degC)
const ORIGINAL: [WbgtInputs, [number, number, number, number]][] = [
  // JKUAT 1 Sep 09:30 UTC, sunny, light wind
  [inputs(28, 40, 852, 1.0, 900.0, 0.712765, 0.986814), [48.3233, 21.5639, 17.7491, 27.5594]],
  // JKUAT 1 Sep 21:30 UTC, calm humid night
  [inputs(15, 85, 852, 0.0, 0.0, 0.0, -0.992678), [12.3539, 12.7179, 13.3787, 12.8733]],
  // hot, humid and sunny at sea level
  [inputs(33, 65, 1010, 2.5, 950.0, 0.725457, 0.999403), [48.1206, 28.8586, 27.216, 33.1251]],
  // hot, dry and windy
  [inputs(38, 15, 950, 6.0, 800.0, 0.67627, 0.867033), [46.9492, 19.7904, 18.253, 27.0431]],
  // low morning sun
  [inputs(16, 80, 852, 0.5, 200.0, 0.586275, 0.245834), [26.1289, 16.3478, 13.7475, 18.2693]],
  // overcast noon, almost no direct beam
  [inputs(21, 70, 852, 1.5, 300.0, 0.010073, 0.987832), [28.5064, 18.8612, 17.0519, 21.0041]],
  // 1300 W/m2 measured, capped at 85 % of the top of the atmosphere
  [inputs(26, 50, 852, 1.0, 1125.692505, 0.9, 0.986814), [49.7022, 21.7798, 18.1285, 27.7863]],
];

test("the model matches Liljegren's own program to within its tolerance", () => {
  for (const [input, [tg, tnwb, tpsy, wbgt]] of ORIGINAL) {
    const result = liljegren(input);
    close(result.globeC, tg, 0.02, "globe");
    close(result.naturalWetBulbC, tnwb, 0.02, "natural wet bulb");
    close(result.psychrometricWetBulbC, tpsy, 0.02, "psychrometric wet bulb");
    close(result.wbgtC, wbgt, 0.02, "wbgt");
  }
});

test("WBGT is the weighted sum of its parts", () => {
  for (const [input] of ORIGINAL) {
    const result = liljegren(input);
    close(
      result.wbgtC,
      0.1 * input.airTempC + 0.2 * result.globeC + 0.7 * result.naturalWetBulbC,
      1e-12,
    );
  }
});

test("on a calm clear night the globe and the wick cool below the air", () => {
  const night = liljegren(inputs(15, 85, 852, 0, 0, 0, 0));
  // both radiate to a sky colder than the air
  assert.ok(night.globeC < 15);
  assert.ok(night.naturalWetBulbC < night.psychrometricWetBulbC);
  // so even the standard index can sit a little below the wet bulb
  const gap = night.wbgtC - night.psychrometricWetBulbC;
  assert.ok(gap > -1 && gap < 0, `${gap}`);
});

test("wind pulls the globe towards air temperature", () => {
  const calm = liljegren(inputs(20, 60, 852, 0.5, 0, 0, 0)).globeC;
  const windy = liljegren(inputs(20, 60, 852, 10, 0, 0, 0)).globeC;
  // at night the globe still loses heat to the sky, but a strong wind replaces most of it
  assert.ok(calm < windy && windy < 20, `${calm} ${windy}`);
  assert.ok(20 - windy < (20 - calm) / 2);
});

test("the psychrometric wet bulb equals air temperature in saturated air", () => {
  close(liljegren(inputs(20, 100, 852, 3, 0, 0, 0)).psychrometricWetBulbC, 20, 0.01);
});

test("the wet bulb is lower at the station pressure than at sea level", () => {
  const station = liljegren(inputs(28, 40, 852, 2, 0, 0, 0)).psychrometricWetBulbC;
  const seaLevel = liljegren(inputs(28, 40, 1013.25, 2, 0, 0, 0)).psychrometricWetBulbC;
  assert.ok(station < seaLevel - 0.2, `${station} vs ${seaLevel}`);
});

test("more sun raises WBGT and more wind lowers it", () => {
  const sun = [0, 300, 600, 900].map((s) => liljegren(inputs(25, 50, 852, 1, s, 0.7, 0.9)).wbgtC);
  const wind = [0.5, 1, 3, 6].map((w) => liljegren(inputs(25, 50, 852, w, 800, 0.7, 0.9)).wbgtC);
  sun.forEach((value, i) => i && assert.ok(value > sun[i - 1], `sun ${sun}`));
  wind.forEach((value, i) => i && assert.ok(value < wind[i - 1], `wind ${wind}`));
});

test("wind below the floor counts as the floor", () => {
  const still = liljegren(inputs(25, 50, 852, 0, 800, 0.7, 0.9)).wbgtC;
  const floor = liljegren(inputs(25, 50, 852, MIN_WIND_MS, 800, 0.7, 0.9)).wbgtC;
  close(still, floor, 1e-12);
});

test("a missing input leaves every output missing", () => {
  const complete = liljegren(inputs(25, 50, 852, 1, 500, 0.5, 0.8));
  assert.ok(Number.isFinite(complete.wbgtC));
  for (const missing of [
    inputs(25, NaN, 852, 1, 500, 0.5, 0.8),
    inputs(NaN, 50, 852, 1, 500, 0.5, 0.8),
    inputs(25, 50, NaN, 1, 500, 0.5, 0.8),
  ]) {
    const result = liljegren(missing);
    assert.ok(Number.isNaN(result.globeC));
    assert.ok(Number.isNaN(result.naturalWetBulbC));
    assert.ok(Number.isNaN(result.psychrometricWetBulbC));
    assert.ok(Number.isNaN(result.wbgtC));
  }
});

test("saturation vapour pressure follows Buck (1981) with Liljegren's moist-air factor", () => {
  // Buck gives 23.37 hPa at 20 degC; Liljegren adds 0.4 % for moist air
  close(saturationVapourPressure(293.15), 23.37 * 1.004, 0.01);
});

test("the direct-beam share matches the original program", () => {
  const toa = (SOLAR_CONSTANT * 0.986814) / earthSunDistanceAu(at("2026-09-01T09:30:00Z")) ** 2;
  const clear = directBeam(900, toa);
  const capped = directBeam(1300, toa);
  close(clear.solarWm2, 900, 0.05);
  close(clear.fdir, 0.712765, 1e-4);
  close(capped.solarWm2, 1125.6925, 0.05);
  close(capped.fdir, 0.9, 1e-4);
});

test("irradiance is capped at 85 % of the top of the atmosphere", () => {
  const bright = directBeam(2000, 1000);
  const dull = directBeam(50, 1000);
  close(bright.solarWm2, MAX_CLEARNESS * 1000, 1e-12);
  assert.equal(bright.fdir, 0.9); // the share never exceeds 0.9
  assert.equal(dull.solarWm2, 50);
  assert.ok(dull.fdir > 0 && dull.fdir < 0.01); // a dull sky is nearly all diffuse
});

test("without a sun all light is diffuse and kept", () => {
  assert.deepEqual(directBeam(0, 0), { solarWm2: 0, fdir: 0 });
  assert.deepEqual(directBeam(40, 0), { solarWm2: 40, fdir: 0 });
});

test("Pasquill-Gifford stability classes follow the EPA table", () => {
  // by day: strong sun and light wind are very unstable, weak sun is neutral
  assert.deepEqual(
    [
      stabilityClass(true, 1.0, 950),
      stabilityClass(true, 1.0, 100),
      stabilityClass(true, 2.5, 700),
      stabilityClass(true, 7.0, 950),
    ],
    [1, 4, 2, 3],
  );
  // by night: light wind is stable, moderate wind neutral
  assert.deepEqual(
    [
      stabilityClass(false, 1.0, 0, 0),
      stabilityClass(false, 1.0, 0, -0.5),
      stabilityClass(false, 3.0, 0, 0),
    ],
    [6, 5, 4],
  );
});

test("wind brought from 10 m down to 2 m matches the original program", () => {
  close(windAtReferenceHeight(1.0, 10, stabilityClass(true, 1.0, 900)), 0.8935, 1e-4);
  close(windAtReferenceHeight(1.5, 10, stabilityClass(false, 1.5, 0)), 0.619, 1e-4);
});

test("wind measured at 2 m is used as it stands, and never falls below the floor", () => {
  assert.equal(windAtReferenceHeight(0, 2, 6), 0);
  assert.equal(windAtReferenceHeight(3, 2, 6), 3);
  assert.equal(windAtReferenceHeight(0, 10, 6), MIN_WIND_MS);
});

test("with no irradiance every hour of a day gives the same WBGT", () => {
  const start = at("2026-09-01T00:00:00Z");
  const day = Array.from({ length: 24 }, (_, i) =>
    wbgtForHour({
      hourStartMs: start + i * HOUR_MS,
      airTempC: 20,
      rhPct: 60,
      pressureHpa: 852,
      windMs: 1,
      ghiWm2: 0,
      ...JKUAT,
    }),
  );
  for (const hour of day) {
    close(hour.wbgtC, day[0].wbgtC, 1e-12);
    assert.equal(hour.fdir, 0);
  }
});

test("the sunrise hour uses the sun after it rises, not the sun at half past", () => {
  // the sun rises at about 03:33 UTC, so at 03:30, the middle of the hour, it is still down
  const hourStartMs = at("2026-09-01T03:00:00Z");
  assert.ok(cosZenith(hourStartMs + HOUR_MS / 2, JKUAT.latitude, JKUAT.longitude) < 0);
  const sun = hourlySun(hourStartMs, JKUAT.latitude, JKUAT.longitude);
  const toa = (SOLAR_CONSTANT * sun.cosZenithHour) / sun.earthSunDistanceAu ** 2;

  const hour = wbgtForHour({
    hourStartMs,
    airTempC: 16,
    rhPct: 80,
    pressureHpa: 852,
    windMs: 1,
    ghiWm2: 0.5 * toa,
    ...JKUAT,
  });

  close(hour.cosZenith, sun.cosZenithSunlit, 1e-4);
  // judged against the hour's own top-of-atmosphere sunlight, half of it is half clear
  close(hour.fdir, Math.exp(3 - 1.34 * 0.5 - 1.65 / 0.5), 1e-3);
});

test("solar noon at JKUAT on 1 September falls at 09:32 UTC, 9.3 degrees off overhead", () => {
  const midnight = at("2026-09-01T00:00:00Z");
  let best = -2;
  let bestMinute = -1;
  for (let minute = 0; minute < 1440; minute++) {
    const value = cosZenith(midnight + minute * 60_000, JKUAT.latitude, JKUAT.longitude);
    if (value > best) {
      best = value;
      bestMinute = minute;
    }
  }
  // 37.01 E puts solar noon 2 h 28 min before 12:00 UTC; the equation of time is near 0
  assert.equal(new Date(midnight + bestMinute * 60_000).toISOString().slice(11, 16), "09:32");
  // declination about +8.2 deg at latitude -1.1 deg leaves the noon sun 9.3 deg off overhead
  close((Math.acos(best) * 180) / Math.PI, 9.3, 0.1);
});

test("the sun is nearly overhead at the September equinox and up for about twelve hours", () => {
  const midnight = at("2026-09-23T00:00:00Z");
  const equinox = Array.from({ length: 1440 }, (_, m) =>
    cosZenith(midnight + m * 60_000, JKUAT.latitude, JKUAT.longitude),
  );
  assert.ok((Math.acos(Math.max(...equinox)) * 180) / Math.PI < 1.5);

  const september = at("2026-09-01T00:00:00Z");
  const daylight = Array.from({ length: 1440 }, (_, m) =>
    cosZenith(september + m * 60_000, JKUAT.latitude, JKUAT.longitude),
  ).filter((value) => value > 0).length;
  assert.ok(daylight > 11.8 * 60 && daylight < 12.2 * 60, `${daylight} minutes`);
});

test("the Earth is nearest the sun in January and farthest in July", () => {
  close(earthSunDistanceAu(at("2026-01-03T12:00:00Z")), 0.9833, 2e-4);
  close(earthSunDistanceAu(at("2026-07-06T12:00:00Z")), 1.0167, 2e-4);
});

test("the hourly mean sun is zero at night and only partial at sunrise", () => {
  const start = at("2026-09-01T02:00:00Z");
  const means = Array.from({ length: 4 }, (_, i) =>
    hourlyMeanCosZenith(start + i * HOUR_MS, JKUAT.latitude, JKUAT.longitude),
  );
  assert.equal(means[0], 0);
  // sunrise at 03:33 UTC leaves only the end of the 03:00 hour in sunlight
  assert.ok(means[1] > 0 && means[1] < 0.05, `${means[1]}`);
  assert.ok(means[1] < means[2] && means[2] < means[3]);
});

test("the sunlit mean differs from the hour mean only at sunrise and sunset", () => {
  const start = at("2026-09-01T03:00:00Z");
  const sun = Array.from({ length: 13 }, (_, i) =>
    hourlySun(start + i * HOUR_MS, JKUAT.latitude, JKUAT.longitude),
  );
  const ratio = sun.map((hour) => hour.cosZenithSunlit / hour.cosZenithHour);
  // 03:00 and 15:00 UTC: the sun is up for only part of the hour
  assert.ok(ratio[0] > 2, `${ratio[0]}`);
  assert.ok(ratio[ratio.length - 1] > 1.5);
  for (const value of ratio.slice(1, -1)) close(value, 1, 1e-9);
  // the 60-step hour mean agrees with the 12-step mean the light calibration uses
  for (const [i, hour] of sun.entries()) {
    close(
      hour.cosZenithHour,
      hourlyMeanCosZenith(start + i * HOUR_MS, JKUAT.latitude, JKUAT.longitude),
      1e-3,
    );
  }
});

test("the shipped calibration is the Python fit, copied unchanged", () => {
  const python = reference.calibration;
  assert.equal(calibrationFile.formula, python.formula);
  assert.equal(calibrationFile.dark_floor_counts, python.dark_floor_counts);
  assert.equal(calibrationFile.a, python.a);
  assert.equal(calibrationFile.b, python.b);
  assert.equal(calibrationFile.reference, python.reference);
  assert.equal(calibrationFile.first_day, python.first_day);
  assert.equal(calibrationFile.last_day, python.last_day);
  assert.equal(calibrationFile.n_days, python.n_days);
  assert.equal(calibrationFile.n_hours, python.n_hours);
  assert.deepEqual(calibrationFile.held_out, python.held_out);
  // the numbers the report has to quote alongside any estimate
  assert.equal(SOLAR_CALIBRATION.held_out.daylight.r2, 0.674);
  assert.equal(SOLAR_CALIBRATION.held_out.daylight.n_hours, 110);
  assert.equal(SOLAR_CALIBRATION.n_days, 10);
});

test("counts become irradiance only while the sun is up, and never below the dark floor", () => {
  const { a, b, dark_floor_counts: floor } = SOLAR_CALIBRATION;
  assert.equal(estimateGhi(5000, 0), 0);
  assert.equal(estimateGhi(5000, -0.3), 0);
  assert.equal(estimateGhi(floor - 10, 0.5), 0);
  close(estimateGhi(floor + 1000, 0.5), 1000 * (a + b * 0.5), 1e-12);
  close(estimateGhi(floor + 1000, 1), 1000 * a, 1e-12);
  assert.ok(Number.isNaN(estimateGhi(NaN, 0.5)));
});

test("the solar position matches the Python at every sampled instant", () => {
  for (const row of reference.solar_instants) {
    const ms = at(row.iso);
    close(cosZenith(ms, JKUAT.latitude, JKUAT.longitude), row.cos_zenith, 1e-12, row.iso);
    close(earthSunDistanceAu(ms), row.distance_au, 1e-12, row.iso);
  }
});

test("the hourly sun matches the Python for every hour of two days", () => {
  for (const row of reference.solar_hours) {
    const ms = at(row.iso);
    const sun = hourlySun(ms, JKUAT.latitude, JKUAT.longitude);
    close(sun.cosZenithHour, row.cos_zenith_hour, 1e-12, row.iso);
    close(sun.cosZenithSunlit, row.cos_zenith_sunlit, 1e-12, row.iso);
    close(sun.earthSunDistanceAu, row.earth_sun_distance_au, 1e-12, row.iso);
    close(hourlyMeanCosZenith(ms, JKUAT.latitude, JKUAT.longitude), row.mu12, 1e-12, row.iso);
  }
});

test("every intermediate of the hourly pipeline matches the Python on 243 station hours", () => {
  for (const row of reference.station_hours) {
    const hourStartMs = at(row.hour_utc);
    close(hourlyMeanCosZenith(hourStartMs, JKUAT.latitude, JKUAT.longitude), row.mu, 1e-12);
    const ghi = estimateGhi(row.si1145_ir, row.mu);
    close(ghi, row.ghi_wm2, 1e-9, `ghi ${row.hour_utc}`);

    const hour = wbgtForHour({
      hourStartMs,
      airTempC: row.temp_sht,
      rhPct: row.humidity_sht,
      pressureHpa: row.press_bmx,
      windMs: row.wind_spd,
      ghiWm2: ghi,
      ...JKUAT,
    });
    close(hour.cosZenith, row.cos_zenith, 1e-12, `cos zenith ${row.hour_utc}`);
    close(hour.solarWm2, row.solar_wm2, 1e-9, `solar ${row.hour_utc}`);
    close(hour.fdir, row.fdir, 1e-12, `fdir ${row.hour_utc}`);
    close(hour.wind2mMs, row.wind_2m_ms, 1e-12, `wind ${row.hour_utc}`);
    close(hour.globeC, row.tg_c, 1e-9, `globe ${row.hour_utc}`);
    close(hour.naturalWetBulbC, row.tnwb_c, 1e-9, `natural wet bulb ${row.hour_utc}`);
    close(hour.psychrometricWetBulbC, row.tpsy_c, 1e-9, `psychrometric ${row.hour_utc}`);
    close(hour.wbgtC, row.wbgt_c, 1e-9, `wbgt ${row.hour_utc}`);
    // and through the Python's published entry point, which rounds to 2 dp
    assert.equal(Math.round(hour.wbgtC * 100) / 100, row.wbgt_rounded_c, row.hour_utc);
  }
});
