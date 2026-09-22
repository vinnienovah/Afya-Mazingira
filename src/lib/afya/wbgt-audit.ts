// AFYA MAZINGIRA · Conduit Sentinel audit A04
// The station firmware's own WBGT column against a standards-grade estimate
// (Liljegren et al. 2008), reported by hour of day, as section 9 of the
// Sentinel specification asks.
//
// A04 needs solar irradiance, which the station does not measure. The SI1145
// infrared counts are converted to GHI by the fitted calibration in
// model/solar-calibration.json, whose held-out skill is modest: r² 0.674 over
// 110 daylight hours of 10 days. The Liljegren side of every difference below
// is therefore an ESTIMATE carrying that spread, not a second measurement, and
// the size of the difference is what the audit reads - not its last decimal.
//
// The model runs on hourly means because the calibration was fitted on hourly
// means and the sun is averaged over the hour to match. Raw archive rows
// (about one sampled minute every 15) are averaged into the UTC hour they fall
// in; an hour is audited only when every input it needs has a reading.
//
// Nothing here reads the disk or the network: pass it the archive rows.

import { EAT_OFFSET_MS } from "./nairobi-day";
import { hourlyMeanCosZenith } from "./solar-position";
import { estimateGhi, irradianceUncertaintyNote, SOLAR_CALIBRATION } from "./solar-irradiance";
import { REFERENCE_HEIGHT_M, wbgtForHour, type HourlyWbgt } from "./liljegren";

const HOUR_MS = 3600_000;

/** The Conduit archive columns A04 reads. */
export const A04_COLUMNS = {
  time: "ts",
  airTemp: "temp_sht",
  humidity: "humidity_sht",
  pressure: "press_bmx",
  wind: "wind_spd",
  infrared: "si1145_ir",
  firmwareWbgt: "wet_bulb_globe_temp",
} as const;

export interface A04Options {
  latitude: number;
  longitude: number;
  /** Anemometer height; 2 m means the wind is used as measured */
  windHeightM?: number;
  /** Hours with fewer readings than this are left out */
  minSamplesPerHour?: number;
}

/** The station, as its CHORDS exports give it. Elevation 1,523 m is carried by
 * the measured station pressure, so the model never needs it separately. */
export const A04_STATION: A04Options = { latitude: -1.099736, longitude: 37.014528 };

export interface StationHour extends HourlyWbgt {
  /** Readings averaged into this hour */
  samples: number;
  airTempC: number;
  rhPct: number;
  pressureHpa: number;
  /** Hour mean of the SI1145 infrared channel, counts */
  irCounts: number;
  /** Estimated, not measured, W/m² */
  ghiWm2: number;
  /** The station's own WBGT column, hour mean, °C */
  firmwareWbgtC: number;
}

/** "2025-06-01 00:00:07+00:00" and ISO 8601; anything else is NaN. */
function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim().replace(" ", "T");
  if (!text) return NaN;
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(value);
}

const FIELDS = ["airTemp", "humidity", "pressure", "wind", "infrared", "firmwareWbgt"] as const;

interface Accumulator {
  samples: number;
  totals: Record<(typeof FIELDS)[number], number>;
  counts: Record<(typeof FIELDS)[number], number>;
}

/**
 * The archive as hourly means, with the modelled WBGT for every hour whose
 * inputs are complete. One row per UTC hour that has readings, in time order.
 */
export function stationHours(
  rows: Iterable<Record<string, unknown>>,
  options: A04Options = A04_STATION,
): StationHour[] {
  const { latitude, longitude } = options;
  const minSamples = options.minSamplesPerHour ?? 1;
  const hours = new Map<number, Accumulator>();

  for (const row of rows) {
    const ms = parseTimestamp(row[A04_COLUMNS.time]);
    if (!Number.isFinite(ms)) continue;
    const hourStartMs = Math.floor(ms / HOUR_MS) * HOUR_MS;
    let hour = hours.get(hourStartMs);
    if (!hour) {
      hour = {
        samples: 0,
        totals: { airTemp: 0, humidity: 0, pressure: 0, wind: 0, infrared: 0, firmwareWbgt: 0 },
        counts: { airTemp: 0, humidity: 0, pressure: 0, wind: 0, infrared: 0, firmwareWbgt: 0 },
      };
      hours.set(hourStartMs, hour);
    }
    hour.samples++;
    for (const field of FIELDS) {
      const value = toNumber(row[A04_COLUMNS[field]]);
      if (Number.isFinite(value)) {
        hour.totals[field] += value;
        hour.counts[field]++;
      }
    }
  }

  const out: StationHour[] = [];
  for (const [hourStartMs, hour] of [...hours.entries()].sort((a, b) => a[0] - b[0])) {
    if (hour.samples < minSamples) continue;
    if (FIELDS.some((field) => hour.counts[field] === 0)) continue;
    const mean = (field: (typeof FIELDS)[number]) => hour.totals[field] / hour.counts[field];

    const airTempC = mean("airTemp");
    const rhPct = mean("humidity");
    const pressureHpa = mean("pressure");
    const windMs = mean("wind");
    const irCounts = mean("infrared");
    // The calibration was fitted against the 12-step hourly mean cos zenith,
    // so the sun height fed back into it has to be the same quantity.
    const ghiWm2 = estimateGhi(irCounts, hourlyMeanCosZenith(hourStartMs, latitude, longitude));

    const modelled = wbgtForHour({
      hourStartMs,
      airTempC,
      rhPct,
      pressureHpa,
      windMs,
      ghiWm2,
      latitude,
      longitude,
      windHeightM: options.windHeightM ?? REFERENCE_HEIGHT_M,
    });
    out.push({
      ...modelled,
      samples: hour.samples,
      airTempC,
      rhPct,
      pressureHpa,
      irCounts,
      ghiWm2,
      firmwareWbgtC: mean("firmwareWbgt"),
    });
  }
  return out;
}

export interface A04HourOfDay {
  /** Hour of day in East Africa Time (UTC+3), the clock the station's readers use */
  hourEat: number;
  /** Station hours compared */
  hours: number;
  /** Archive rows behind them */
  samples: number;
  /** Mean of the firmware's own WBGT column, °C */
  firmwareMeanC: number;
  /** Mean of the Liljegren estimate, °C */
  modelMeanC: number;
  /** Mean of firmware minus estimate, °C */
  meanSignedC: number;
  /** Mean of |firmware minus estimate|, °C */
  meanAbsC: number;
  minSignedC: number;
  maxSignedC: number;
}

export interface A04Report {
  audit: "A04";
  what: string;
  method: string;
  byHourOfDay: A04HourOfDay[];
  hours: number;
  samples: number;
  meanSignedC: number;
  meanAbsC: number;
  firstHourUtc: string | null;
  lastHourUtc: string | null;
  /** The estimate's own uncertainty. It travels with every number above. */
  uncertainty: {
    note: string;
    irradiance_r2: number;
    irradiance_rmse_wm2: number;
    irradiance_bias_wm2: number;
    fit_hours: number;
    fit_days: number;
    fit_window: string;
    reference: string;
  };
  verdict: string;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Audit A04: the firmware's WBGT column against the Liljegren estimate, by
 * hour of day. `rows` are raw Conduit archive records, as the committed
 * data/conduit_master_2025_2026.csv holds them.
 *
 * Pure: it reads only what it is given. Differences are firmware minus
 * estimate, so a negative mean means the firmware reads low.
 */
export function a04Audit(
  rows: Iterable<Record<string, unknown>>,
  options: A04Options = A04_STATION,
): A04Report {
  const hours = stationHours(rows, options).filter(
    (hour) => Number.isFinite(hour.wbgtC) && Number.isFinite(hour.firmwareWbgtC),
  );

  const buckets = new Map<number, { hours: StationHour[]; differences: number[] }>();
  for (const hour of hours) {
    const hourEat = new Date(hour.hourStartMs + EAT_OFFSET_MS).getUTCHours();
    let bucket = buckets.get(hourEat);
    if (!bucket) {
      bucket = { hours: [], differences: [] };
      buckets.set(hourEat, bucket);
    }
    bucket.hours.push(hour);
    bucket.differences.push(hour.firmwareWbgtC - hour.wbgtC);
  }

  const mean = (values: number[]) => values.reduce((total, v) => total + v, 0) / values.length;
  const byHourOfDay = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hourEat, bucket]) => ({
      hourEat,
      hours: bucket.hours.length,
      samples: bucket.hours.reduce((total, hour) => total + hour.samples, 0),
      firmwareMeanC: round2(mean(bucket.hours.map((hour) => hour.firmwareWbgtC))),
      modelMeanC: round2(mean(bucket.hours.map((hour) => hour.wbgtC))),
      meanSignedC: round2(mean(bucket.differences)),
      meanAbsC: round2(mean(bucket.differences.map(Math.abs))),
      minSignedC: round2(Math.min(...bucket.differences)),
      maxSignedC: round2(Math.max(...bucket.differences)),
    }));

  const differences = hours.map((hour) => hour.firmwareWbgtC - hour.wbgtC);
  const daylight = SOLAR_CALIBRATION.held_out.daylight;
  const iso = (hour: StationHour | undefined) =>
    hour ? new Date(hour.hourStartMs).toISOString() : null;

  return {
    audit: "A04",
    what: "Firmware WBGT vs a standards-grade estimate",
    method:
      "Liljegren et al. (2008) on hourly means of temp_sht, humidity_sht, press_bmx and wind_spd, " +
      "with irradiance estimated from si1145_ir by the fitted calibration; firmware minus estimate",
    byHourOfDay,
    hours: hours.length,
    samples: hours.reduce((total, hour) => total + hour.samples, 0),
    meanSignedC: differences.length ? round2(mean(differences)) : NaN,
    meanAbsC: differences.length ? round2(mean(differences.map(Math.abs))) : NaN,
    firstHourUtc: iso(hours[0]),
    lastHourUtc: iso(hours[hours.length - 1]),
    uncertainty: {
      note: irradianceUncertaintyNote(),
      irradiance_r2: daylight.r2,
      irradiance_rmse_wm2: daylight.rmse_wm2,
      irradiance_bias_wm2: daylight.bias_wm2,
      fit_hours: daylight.n_hours,
      fit_days: SOLAR_CALIBRATION.n_days,
      fit_window: `${SOLAR_CALIBRATION.first_day} to ${SOLAR_CALIBRATION.last_day}`,
      reference: SOLAR_CALIBRATION.reference,
    },
    verdict:
      "Report only: the estimate's irradiance input is calibrated, not measured, so the audit " +
      "reads the size and the shape of the difference through the day, not its exact value.",
  };
}
