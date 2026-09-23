// Views derived from a SituationResult that several pages show. Each page
// calls the same function, so the Situation, Forecast, Why?, Operations and
// Briefing pages cannot tell different stories about the same data.

import type {
  ChirpsContext, Contributor, EnvironmentalState, HorizonForecast, Lang,
  RiskLevel, SituationResult, StateId, StateSegment,
} from "./types";
import { getActivityProfile, shadeWbgt, wbgtToRisk } from "./constants";
import { fill } from "./format";
import { t } from "./i18n";

/** Band of the WBGT measured now. risk.thermal is the band of the +3 h forecast. */
export function currentBand(s: Pick<SituationResult, "current" | "risk">): RiskLevel {
  return s.risk.thermal_now ?? wbgtToRisk(s.current.wbgt_c);
}

export type Trend = "rising" | "falling" | "stable";

// Over three hours, a smaller change than this reads as stable.
export const TREND_DEADBAND_C = 0.3;

export const TREND_KEYS: Record<Trend, string> = {
  rising: "exposure_rising",
  falling: "exposure_falling",
  stable: "exposure_stable",
};

/** Where WBGT is heading: the +3 h forecast against the current reading. */
export function exposureTrend(currentWbgt: number, forecast: HorizonForecast[]): Trend {
  const f3h = forecast.find((f) => f.horizon === "3h");
  if (!f3h) return "stable";
  const change = f3h.value - currentWbgt;
  if (change > TREND_DEADBAND_C) return "rising";
  if (change < -TREND_DEADBAND_C) return "falling";
  return "stable";
}

export interface ContributionBar {
  feature: string;
  value_c: number;
  width_pct: number; // share of the longest bar, 0-100
}

/**
 * Bars for each input's effect on the +3 h forecast, scaled so the largest
 * effect fills the row. Null unless every contributor carries a value: bars
 * scaled against a partial set would misstate the rest.
 */
export function contributionBars(contributors: Contributor[]): ContributionBar[] | null {
  if (!contributors.length) return null;
  const values: number[] = [];
  for (const c of contributors) {
    if (typeof c.contribution_c !== "number" || !Number.isFinite(c.contribution_c)) return null;
    values.push(c.contribution_c);
  }
  const largest = Math.max(...values.map(Math.abs));
  return contributors.map((c, i) => ({
    feature: c.feature,
    value_c: values[i],
    width_pct: largest > 0 ? (Math.abs(values[i]) / largest) * 100 : 0,
  }));
}

/** An activity's name as it reads inside a sentence: "sports / exercise". */
export function activityName(key: string, lang: Lang): string {
  const profile = getActivityProfile(key);
  const label = lang === "sw" ? profile.label_sw : profile.label_en;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Name of a contributor's input, falling back to its key when it has no label. */
export function contributorLabel(feature: string, lang: Lang): string {
  const key = `contributor_${feature}`;
  const label = t(lang, key);
  return label === key ? feature.replace(/_/g, " ") : label;
}

/** Whole-degree scale that holds every band, for drawing them side by side. */
export function bandScale(bands: { lower: number; upper: number }[]): [number, number] {
  const lo = Math.floor(Math.min(...bands.map((b) => b.lower)));
  const hi = Math.ceil(Math.max(...bands.map((b) => b.upper)));
  return hi > lo ? [lo, hi] : [lo - 1, hi + 1];
}

/** Where a band and its central value sit on a scale, in percent of its width. */
export function bandGeometry(
  band: { lower: number; value: number; upper: number },
  [min, max]: [number, number],
): { left: number; width: number; marker: number } {
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
  return { left: pos(band.lower), width: pos(band.upper) - pos(band.lower), marker: pos(band.value) };
}

export const SLOT_MS = 15 * 60_000;

export interface StateSpan {
  state_id: StateId;
  start: number;
  end: number;
  segment: StateSegment;
}

/**
 * The state segments as time spans clipped to [fromMs, toMs]. Each reading
 * stands for the quarter hour around it, so neighbouring segments meet
 * halfway between their readings rather than leaving gaps.
 */
export function stateSpans(segments: StateSegment[], fromMs: number, toMs: number): StateSpan[] {
  const half = SLOT_MS / 2;
  return segments
    .map((segment) => ({
      state_id: segment.state_id,
      start: Math.max(fromMs, Date.parse(segment.start) - half),
      end: Math.min(toMs, Date.parse(segment.end) + half),
      segment,
    }))
    .filter((s) => s.end > s.start);
}

/** The state at an instant, from spans built by stateSpans. */
export function stateAt(spans: StateSpan[], ms: number): StateId | null {
  return spans.find((s) => ms >= s.start && ms <= s.end)?.state_id ?? null;
}

// Nairobi keeps UTC+3 all year.
const EAT_OFFSET_MS = 3 * 3600_000;

/** Instants inside [fromMs, toMs] where the Nairobi clock reads a whole multiple of `everyHours`. */
export function hourTicks(fromMs: number, toMs: number, everyHours: number): number[] {
  const step = everyHours * 3600_000;
  const ticks: number[] = [];
  for (let ms = Math.ceil((fromMs + EAT_OFFSET_MS) / step) * step - EAT_OFFSET_MS; ms <= toMs; ms += step) {
    ticks.push(ms);
  }
  return ticks;
}

/** Whole-degree axis ticks 1, 2, 5 or 10 apart, at most seven, covering every value. */
export function degreeTicks(values: number[]): number[] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const step = [1, 2, 5].find((s) => Math.ceil(max / s) - Math.floor(min / s) <= 6) ?? 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(Math.ceil(max / step) * step, lo + step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  return ticks;
}

/** Hours between the times of day of two instants, 0 to 12, whatever their dates. */
export function timeOfDayGapHours(aIso: string, bIso: string): number {
  const hourOfDay = (iso: string) => (((Date.parse(iso) / 3600_000) % 24) + 24) % 24;
  const gap = Math.abs(hourOfDay(aIso) - hourOfDay(bIso));
  return Math.min(gap, 24 - gap);
}

export interface LiveWindow {
  /** First and last reading the run covers, and the hours between them. */
  from: string;
  to: string;
  hours: number;
  /** Minutes since the last reading, once it is more than one slot late. */
  silent_minutes: number;
  /** Minutes with no reading: the gaps inside the run and the silence since it. */
  missing_minutes: number;
  /** Readings landing inside the `of_hours` before now, and how many a full window holds. */
  read_slots: number;
  of_slots: number;
  of_hours: number;
}

/**
 * What a run of readings covers, against the window it is meant to fill. A
 * station that stops reporting leaves no gap behind its last reading, so the
 * gaps inside the run never account for the silence since: without counting it
 * a station that died yesterday reads as a full window with nothing missing.
 */
export function liveWindow(
  series: { ts: string; gap_minutes?: number }[],
  nowMs: number,
  windowHours = 24,
): LiveWindow | null {
  if (!series.length) return null;
  const from = series[0].ts;
  const to = series[series.length - 1].ts;
  const toMs = Date.parse(to);
  const slotMinutes = SLOT_MS / 60_000;
  // Each reading stands for the quarter hour around it, so a full run of
  // `n` slots covers one slot more than its first and last are apart.
  const hours = Math.max(1, Math.round((toMs - Date.parse(from) + SLOT_MS) / 3600_000));
  const silent = Math.max(0, Math.round((nowMs - toMs) / 60_000 - slotMinutes));
  const start = nowMs - windowHours * 3600_000;
  return {
    from,
    to,
    hours,
    silent_minutes: silent,
    missing_minutes: Math.round(series.reduce((s, o) => s + (o.gap_minutes ?? 0), 0) + silent),
    read_slots: series.filter((o) => Date.parse(o.ts) > start).length,
    of_slots: Math.round((windowHours * 3600_000) / SLOT_MS),
    of_hours: windowHours,
  };
}

/** The days behind the rainfall totals, both ending today; null when rainfall is unavailable. */
export function rainWindows(c: ChirpsContext): {
  day: string;
  week: { from: string; to: string };
  month: { from: string; to: string };
} | null {
  if (!c.available) return null;
  return {
    day: c.valid_date,
    week: { from: c.window_7d_start, to: c.valid_date },
    month: { from: c.window_30d_start, to: c.valid_date },
  };
}

export interface ClimateSeriesRow {
  ts: string;
  temp_c?: number | null;
  wet_bulb_c?: number | null;
  wbgt_c?: number | null;
  imputed?: string[];
}

// A row whose WBGT inputs were filled in is not a measurement.
const WBGT_INPUTS = ["temp_sht", "wet_bulb_temp", "wet_bulb_globe_temp", "temp_c", "wet_bulb_c", "wbgt_c"];

export interface ClimateSeriesResponse {
  conduit_source?: string;
  conduit?: ClimateSeriesRow[];
}

const SOURCE_OF: Record<string, SituationResult["data_source"]> = {
  live: "CONDUIT_LIVE",
  csv: "CONDUIT_ARCHIVE",
  demo: "DEMO",
};

/**
 * Station shade WBGT for the hours up to the situation's latest reading, from
 * /api/climate-series: 0.7 x wet bulb + 0.3 x air temperature when the row
 * carries both, otherwise its wbgt_c, which the route computes the same way.
 * The firmware's own WBGT column is never read. A slot with no measured value
 * is null, so the line breaks there. Empty for demo data and when the series
 * comes from another source than the situation.
 */
export function stationWbgtSeries(
  res: ClimateSeriesResponse,
  situation: Pick<SituationResult, "data_source" | "generated_at">,
  hours = 12,
): { time: string; wbgt: number | null }[] {
  if (situation.data_source === "DEMO") return [];
  if (SOURCE_OF[res.conduit_source ?? ""] !== situation.data_source) return [];
  const end = Date.parse(situation.generated_at);
  const start = end - hours * 3600_000;
  const out: { time: string; wbgt: number | null }[] = [];
  for (const row of res.conduit ?? []) {
    const ms = Date.parse(row.ts);
    if (!(ms >= start && ms <= end)) continue;
    const wbgt = typeof row.wet_bulb_c === "number" && typeof row.temp_c === "number"
      ? shadeWbgt(row.temp_c, row.wet_bulb_c)
      : row.wbgt_c;
    const measured = typeof wbgt === "number" && Number.isFinite(wbgt)
      && !row.imputed?.some((f) => WBGT_INPUTS.includes(f));
    out.push({ time: row.ts, wbgt: measured ? Math.round((wbgt as number) * 10) / 10 : null });
  }
  return out;
}

// Station fields behind each reading in the measurement strip, under their
// pipeline names and their CurrentObservation names.
const READING_FIELDS: Record<string, string[]> = {
  temperature: ["temp_sht", "temperature_c"],
  humidity: ["humidity_sht", "humidity_pct"],
  wind: ["wind_spd", "wind_speed_ms"],
  infrared: ["si1145_ir", "infrared_signal"],
  pressure: ["press_bmx", "pressure_hpa"],
  wet_bulb: ["wet_bulb_temp", "wet_bulb_c"],
  wbgt: ["wet_bulb_globe_temp", "wbgt_c"],
  rain: ["rg1", "rain_observed"],
};

/** Readings in the strip that were filled in rather than measured. */
export function filledReadings(imputed: string[] | undefined, feed?: string | null): Set<string> {
  const fields = new Set(imputed ?? []);
  const filled = new Set<string>();
  for (const [reading, names] of Object.entries(READING_FIELDS)) {
    if (names.some((n) => fields.has(n))) filled.add(reading);
  }
  // WBGT is computed from the wet bulb and the air temperature.
  if (filled.has("temperature") || filled.has("wet_bulb")) filled.add("wbgt");
  // CHORDS sends rain only when it rains, so a gap in its feed means none fell.
  if (feed === "chords") filled.delete("rain");
  return filled;
}

/**
 * How often the station went from this state to the one named, in words. The
 * table that gives typical_hours is built per time of day; the older one is
 * over all hours, so the wording follows whichever the pipeline sent.
 */
export function nextStateNote(tl: EnvironmentalState["transition_likelihood"], lang: Lang): string | null {
  if (!tl) return null;
  const pct = Math.round(tl.probability * 100);
  const hours = tl.typical_hours;
  if (typeof hours === "number" && Number.isFinite(hours) && hours > 0) {
    const share = fill(t(lang, "next_state_share_tod"), { pct });
    const halfHours = Math.max(0.5, Math.round(hours * 2) / 2);
    return `${share}. ${fill(t(lang, "next_state_typical"), { hours: halfHours })}`;
  }
  return fill(t(lang, "next_state_share"), { pct });
}
