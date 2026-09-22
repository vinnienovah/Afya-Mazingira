import type { DemoObservation } from "./demo-observations";
import { WBGT_SOURCE_FIELDS, isMeasured } from "./feature-engine";

// The usual shade WBGT at each 15-minute time of day, from the station's own
// record over the 30 days before a forecast. The forecast works from how far
// the latest reading sits from it, so it is only ever built from observations
// made before the forecast time.

export const CLIMATOLOGY_DAYS = 30;
export const SLOTS_PER_DAY = 96;
/** Measured readings a time of day needs before its mean is used. */
export const MIN_CLIMATOLOGY_READINGS = 10;
/** Width of the time-of-day blocks the forecast bands and state changes are grouped by. */
export const BLOCK_HOURS = 3;

const SLOT_MS = 15 * 60 * 1000;
const DAY_MS = 86_400_000;
const EAT_OFFSET_MS = 3 * 3600 * 1000;

export type ClimatologySource = "station" | "archive" | "archive_calendar" | "archive_latest";

export interface Climatology {
  /** Mean shade WBGT (°C) for each 15-minute slot of the local day, 00:00 first; NaN where unmeasured. */
  mean: number[];
  /** Measured readings behind each mean. */
  count: number[];
  source: ClimatologySource;
  from: string;
  to: string;
}

function localDayMs(ms: number): number {
  return (((ms + EAT_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
}

/** 15-minute slot of the East Africa Time day, 0 to 95. */
export function slotOfDay(ms: number): number {
  return Math.floor(localDayMs(ms) / SLOT_MS);
}

/** Three-hour block of the East Africa Time day, 0 (00:00-03:00) to 7. */
export function timeOfDayBlock(ms: number): number {
  return Math.floor(localDayMs(ms) / (BLOCK_HOURS * 3600 * 1000));
}

/**
 * Time-of-day means of measured shade WBGT over the observations whose
 * timestamps fall in any of the [from, to) ranges.
 */
export function computeClimatology(
  series: DemoObservation[],
  ranges: [number, number][],
  source: ClimatologySource,
): Climatology {
  const sum = new Array<number>(SLOTS_PER_DAY).fill(0);
  const count = new Array<number>(SLOTS_PER_DAY).fill(0);
  for (const o of series) {
    const t = Date.parse(o.ts);
    if (!ranges.some(([from, to]) => t >= from && t < to)) continue;
    if (!isMeasured(o, WBGT_SOURCE_FIELDS)) continue;
    const k = slotOfDay(t);
    sum[k] += o.wet_bulb_globe_temp;
    count[k]++;
  }
  return {
    mean: sum.map((s, k) => (count[k] ? s / count[k] : NaN)),
    count,
    source,
    from: new Date(Math.min(...ranges.map((r) => r[0]))).toISOString(),
    to: new Date(Math.max(...ranges.map((r) => r[1]))).toISOString(),
  };
}

/** True when every time of day has enough measured readings behind its mean. */
export function isComplete(c: Climatology): boolean {
  return c.count.every((n) => n >= MIN_CLIMATOLOGY_READINGS);
}

/** The usual shade WBGT at the time of day of `ms`. */
export function usualAt(c: Climatology, ms: number): number {
  return c.mean[slotOfDay(ms)];
}

/**
 * For every slot of an unbroken 15-minute grid, the usual WBGT over the
 * CLIMATOLOGY_DAYS before that slot, at its own time of day and at the times
 * of day of the next `maxLead` slots. Row i holds leads 0 to maxLead, NaN
 * where fewer than MIN_CLIMATOLOGY_READINGS readings were measured. It gives
 * the same means as computeClimatology over [t - 30 days, t), in one pass.
 */
export function rollingClimatology(series: DemoObservation[], maxLead: number): Float64Array {
  const n = series.length;
  const width = maxLead + 1;
  const out = new Float64Array(n * width).fill(NaN);
  if (!n) return out;
  const t0 = Date.parse(series[0].ts);
  const slot0 = slotOfDay(t0);
  const windowSlots = CLIMATOLOGY_DAYS * SLOTS_PER_DAY;
  const ok = series.map((o) => isMeasured(o, WBGT_SOURCE_FIELDS));
  const sum = new Float64Array(SLOTS_PER_DAY);
  const count = new Int32Array(SLOTS_PER_DAY);
  const move = (j: number, sign: 1 | -1) => {
    if (j < 0 || !ok[j]) return;
    const k = (slot0 + j) % SLOTS_PER_DAY;
    sum[k] += sign * series[j].wet_bulb_globe_temp;
    count[k] += sign;
  };
  for (let i = 0; i < n; i++) {
    if (Date.parse(series[i].ts) !== t0 + i * SLOT_MS) {
      throw new Error(`the grid is broken at ${series[i].ts}`);
    }
    move(i - 1, 1);
    move(i - 1 - windowSlots, -1);
    for (let lead = 0; lead <= maxLead; lead++) {
      const k = (slot0 + i + lead) % SLOTS_PER_DAY;
      if (count[k] >= MIN_CLIMATOLOGY_READINGS) out[i * width + lead] = sum[k] / count[k];
    }
  }
  return out;
}
