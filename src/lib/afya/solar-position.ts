// AFYA MAZINGIRA · Solar position
// Where the sun is over the station: the cosine of the solar zenith angle,
// and the Earth-Sun distance that scales top-of-atmosphere sunlight.
//
// Equations: NOAA's solar position calculator, after Meeus, Astronomical
// Algorithms (2nd ed. 1998) - solar coordinates (ch. 25), the equation of
// time (ch. 28) and the radius vector. Accurate to a fraction of a degree,
// which is far finer than an hourly mean of the sun's height needs.
//
// Everything here works on hours, because the two things that use it - the
// Liljegren WBGT balance and the light-sensor calibration - both take hourly
// mean inputs, so the sun has to be averaged the same way the irradiance was.

const HOUR_MS = 3600_000;
const JULIAN_UNIX_EPOCH = 2440587.5; // Julian date of 1970-01-01T00:00Z
const JULIAN_J2000 = 2451545.0;
const JULIAN_CENTURY_DAYS = 36525.0;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** Remainder in [0, m), which JavaScript's % is not for negative numbers. */
const positiveMod = (x: number, m: number) => ((x % m) + m) % m;

interface SunState {
  /** Solar declination, radians */
  declination: number;
  /** Equation of time, minutes */
  equationOfTime: number;
  /** Minutes since midnight UTC */
  minutesOfDay: number;
  /** Earth-Sun distance, astronomical units */
  distanceAu: number;
}

function sunState(ms: number): SunState {
  const julianDate = ms / (24 * HOUR_MS) + JULIAN_UNIX_EPOCH;
  const century = (julianDate - JULIAN_J2000) / JULIAN_CENTURY_DAYS;

  const meanLongitudeDeg = positiveMod(280.46646 + century * (36000.76983 + century * 0.0003032), 360);
  const meanLongitude = toRadians(meanLongitudeDeg);
  const meanAnomaly = toRadians(357.52911 + century * (35999.05029 - 0.0001537 * century));
  const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century);
  const centre =
    Math.sin(meanAnomaly) * (1.914602 - century * (0.004817 + 0.000014 * century)) +
    Math.sin(2 * meanAnomaly) * (0.019993 - 0.000101 * century) +
    Math.sin(3 * meanAnomaly) * 0.000289;

  // Longitude of the ascending node of the Moon's orbit; it carries the
  // nutation terms applied to the apparent longitude and the obliquity.
  const omega = toRadians(125.04 - 1934.136 * century);
  const apparentLongitude = toRadians(meanLongitudeDeg + centre - 0.00569 - 0.00478 * Math.sin(omega));
  const obliquity = toRadians(
    23 +
      (26 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60) / 60 +
      0.00256 * Math.cos(omega),
  );

  const y = Math.tan(obliquity / 2) ** 2;
  const equationOfTime =
    4 *
    toDegrees(
      y * Math.sin(2 * meanLongitude) -
        2 * eccentricity * Math.sin(meanAnomaly) +
        4 * eccentricity * y * Math.sin(meanAnomaly) * Math.cos(2 * meanLongitude) -
        0.5 * y * y * Math.sin(4 * meanLongitude) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly),
    );

  const at = new Date(ms);
  const trueAnomaly = meanAnomaly + toRadians(centre);
  return {
    declination: Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude)),
    equationOfTime,
    minutesOfDay: at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60,
    distanceAu: (1.000001018 * (1 - eccentricity ** 2)) / (1 + eccentricity * Math.cos(trueAnomaly)),
  };
}

/** Cosine of the solar zenith angle; negative while the sun is below the horizon. */
export function cosZenith(ms: number, latitude: number, longitude: number): number {
  const { declination, equationOfTime, minutesOfDay } = sunState(ms);
  const solarMinutes = positiveMod(minutesOfDay + equationOfTime + 4 * longitude, 1440);
  const hourAngle = toRadians(solarMinutes / 4 - 180);
  const lat = toRadians(latitude);
  return (
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)
  );
}

/** Distance from the Earth to the Sun in astronomical units (0.983 to 1.017). */
export function earthSunDistanceAu(ms: number): number {
  return sunState(ms).distanceAu;
}

/** cos zenith at the middle of each of `steps` equal slices of the hour starting at `hourStartMs`. */
function withinHour(hourStartMs: number, latitude: number, longitude: number, steps: number): number[] {
  const samples: number[] = [];
  for (let i = 0; i < steps; i++) {
    samples.push(cosZenith(hourStartMs + ((2 * i + 1) * HOUR_MS) / (2 * steps), latitude, longitude));
  }
  return samples;
}

/**
 * Mean of max(cos zenith, 0) over the hour starting at `hourStartMs`.
 *
 * Averaging within the hour, rather than reading the value at half past,
 * keeps the sunrise and sunset hours right: the sun is up for part of them
 * only. 12 steps is what the light calibration was fitted with, so the sun
 * height fed to it here has to be computed the same way.
 */
export function hourlyMeanCosZenith(
  hourStartMs: number,
  latitude: number,
  longitude: number,
  steps = 12,
): number {
  const samples = withinHour(hourStartMs, latitude, longitude, steps);
  return samples.reduce((total, value) => total + Math.max(value, 0), 0) / steps;
}

export interface HourlySun {
  /** Mean of max(cos zenith, 0) over the whole hour: sunlight at the top of the
   * atmosphere, averaged the way an hourly mean irradiance is. */
  cosZenithHour: number;
  /** Mean cos zenith over the sunlit part of the hour only, 0 if the sun never
   * rises in it: the angle at which that hour's direct beam arrives. */
  cosZenithSunlit: number;
  /** At the middle of the hour. */
  earthSunDistanceAu: number;
}

/**
 * The sun over the hour starting at `hourStartMs`, as an hourly energy balance
 * needs it. The sunlit mean follows Hogan and Hirahara (2016), as used for
 * hourly WBGT by Kong and Huber (2022): the midpoint's angle would put the
 * sunset hour's sun on or below the horizon.
 */
export function hourlySun(
  hourStartMs: number,
  latitude: number,
  longitude: number,
  steps = 60,
): HourlySun {
  const samples = withinHour(hourStartMs, latitude, longitude, steps);
  let sunlitSteps = 0;
  let sunlitTotal = 0;
  for (const value of samples) {
    if (value > 0) {
      sunlitSteps++;
      sunlitTotal += value;
    }
  }
  return {
    cosZenithHour: sunlitTotal / steps,
    cosZenithSunlit: sunlitSteps > 0 ? sunlitTotal / sunlitSteps : 0,
    earthSunDistanceAu: earthSunDistanceAu(hourStartMs + HOUR_MS / 2),
  };
}
