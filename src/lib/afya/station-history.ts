// Station history over any range: the committed archive where it reaches,
// and after it the Conduit API (with a key) topped up from the CHORDS portal
// where the API runs behind, all on one 15-minute grid through the same
// cleaning as every other path. Callers get null, never an error, when
// nothing covers the range or a feed fails.

import type { DemoObservation } from "./demo-observations";
import { getCsvCoverage, getCsvRows } from "./csv-source";
import {
  fetchChordsRows, fetchConduitRows, gridReadings, hasConduitCreds, mergeReadings, parseUtc, toReadings,
} from "./sources";
import { addDays, nairobiDate, nairobiDayStart } from "./nairobi-day";

export interface StationHistory {
  series: DemoObservation[];
  source: "live" | "csv" | "mixed";
  from: string;
  to: string;
  // The live feed with the latest part of the series, when one was used.
  feed?: "jhub" | "chords" | null;
}

// date = YYYY-MM-DD in Africa/Nairobi; null = too little gauge data that day.
export interface DailyRain { date: string; mm: number | null }

export interface HistoryFeeds {
  hasConduit: () => boolean;
  conduit: (fromMs: number, toMs: number) => Promise<Record<string, unknown>[]>;
  chords: (fromMs: number, toMs: number) => Promise<Record<string, unknown>[]>;
}

const LIVE_FEEDS: HistoryFeeds = {
  hasConduit: hasConduitCreds,
  conduit: fetchConduitRows,
  chords: async (fromMs, toMs) => (await fetchChordsRows(fromMs, toMs)).rows,
};

const SLOT_MS = 900_000;
const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;
// Ranges that reach past the archive are kept for half an hour; ranges the
// archive holds entirely never change.
const RECENT_TTL_MS = 30 * 60_000;
const CACHE_MAX = 64;
// The CHORDS portal fills in after the Conduit API's last row when the API
// is further behind than this.
const TOP_UP_AFTER_MS = 30 * 60_000;
// A day's rain counts when the gauge was read in at least this share of its
// hours (20 of 24), or of the hours so far today.
const MIN_HOURS_SHARE = 0.8;

const cache = new Map<string, { at: number; permanent: boolean; value: Promise<StationHistory | null> }>();

/**
 * Cleaned 15-minute grid covering [endIso - days, endIso] (endIso defaults to
 * now): archive where it covers, live feeds beyond. Cached. Null when nothing
 * covers the range.
 */
export async function getStationHistory(days: number, endIso?: string): Promise<StationHistory | null> {
  try {
    const endMs = Math.min(endIso === undefined ? Date.now() : parseUtc(endIso), Date.now());
    if (!Number.isFinite(endMs) || !(days > 0)) return null;
    const startMs = endMs - days * DAY_MS;
    const archiveEnd = Date.parse(getCsvCoverage()?.maxIso ?? "");
    const key = `${archiveEnd}|${Math.round(days * 96)}|${Math.floor(endMs / SLOT_MS)}`;

    const hit = cache.get(key);
    if (hit && (hit.permanent || Date.now() - hit.at < RECENT_TTL_MS)) return await hit.value;

    const value = buildStationHistory(startMs, endMs).catch((err: Error) => {
      console.warn("[afya] station history failed:", err.message);
      return null;
    });
    cache.delete(key);
    cache.set(key, { at: Date.now(), permanent: endMs <= archiveEnd, value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);

    const result = await value;
    if (!result) cache.delete(key);
    return result;
  } catch (err) {
    console.warn("[afya] station history failed:", (err as Error).message);
    return null;
  }
}

/** The history for [startMs, endMs] from the given feeds, uncached. */
export async function buildStationHistory(
  startMs: number,
  endMs: number,
  feeds: HistoryFeeds = LIVE_FEEDS,
): Promise<StationHistory | null> {
  const archiveEnd = Date.parse(getCsvCoverage()?.maxIso ?? "");
  const archiveRows = startMs <= archiveEnd ? getCsvRows(startMs, Math.min(endMs, archiveEnd)) : [];

  let apiRows: Record<string, unknown>[] = [];
  let chordsRows: Record<string, unknown>[] = [];
  if (!(endMs <= archiveEnd)) {
    const liveFrom = Number.isFinite(archiveEnd) ? Math.max(startMs, archiveEnd + 1) : startMs;
    if (feeds.hasConduit()) apiRows = await feeds.conduit(liveFrom, endMs).catch(() => []);
    const lastReading = Math.max(archiveRows.length ? archiveEnd : -Infinity, ...apiRows.map((r) => parseUtc(r.ts)));
    if (!(lastReading > endMs - TOP_UP_AFTER_MS)) {
      // CHORDS points cover whole quarter hours: start at the first one after the last reading.
      const from = Number.isFinite(lastReading) ? Math.max(startMs, Math.floor(lastReading / SLOT_MS + 1) * SLOT_MS) : startMs;
      chordsRows = await feeds.chords(from, endMs).catch(() => []);
    }
  }

  // The archive and the API share the gauges' running totals, so they are
  // read together; CHORDS points carry their own rain.
  const series = gridReadings(
    mergeReadings(
      toReadings([...archiveRows, ...apiRows], "counters").readings,
      toReadings(chordsRows, "sums").readings,
    ),
  ).filter((o) => Date.parse(o.ts) + SLOT_MS > startMs);
  if (!series.length) return null;

  const archiveUsed = archiveRows.some((r) => parseUtc(r.ts) >= startMs);
  const liveUsed = apiRows.length > 0 || chordsRows.length > 0;
  return {
    series,
    source: archiveUsed && liveUsed ? "mixed" : liveUsed ? "live" : "csv",
    from: series[0].ts,
    to: series[series.length - 1].ts,
    feed: chordsRows.length ? "chords" : apiRows.length ? "jhub" : null,
  };
}

/**
 * Gauge-1 rain per Nairobi day from the station's own counters, for the
 * `days` days ending the day before endIso's day (plus today so far as the
 * last element). Null when unavailable.
 */
export async function getStationDailyRain(days: number, endIso?: string): Promise<DailyRain[] | null> {
  try {
    const endMs = Math.min(endIso === undefined ? Date.now() : parseUtc(endIso), Date.now());
    if (!Number.isFinite(endMs) || !(days >= 0)) return null;
    const today = nairobiDate(endMs);
    const firstDay = addDays(today, -Math.round(days));
    const startMs = nairobiDayStart(firstDay);
    const history = await getStationHistory((endMs - startMs) / DAY_MS, new Date(endMs).toISOString());
    return history ? dailyRainFrom(history.series, firstDay, endMs) : null;
  } catch (err) {
    console.warn("[afya] station daily rain failed:", (err as Error).message);
    return null;
  }
}

/** Rain in a slot: gauge 1, or gauge 2 when gauge 1 has no reading there. Null when neither does. */
export function slotRain(o: DemoObservation): number | null {
  if (!o.imputed?.includes("rg1")) return o.rg1;
  if (!o.imputed?.includes("rg2")) return o.rg2;
  return null;
}

/**
 * Rain per Nairobi day from `firstDay` to the day of `endMs`. A day's total
 * is null unless the gauge was read in at least 20 of its 24 hours (for the
 * current day, 80 % of the hours begun by `endMs`).
 */
export function dailyRainFrom(series: DemoObservation[], firstDay: string, endMs: number): DailyRain[] {
  const lastDay = nairobiDate(endMs);
  const byDay = new Map<string, { mm: number; hours: Set<number> }>();
  for (const o of series) {
    const t = Date.parse(o.ts);
    const mm = slotRain(o);
    if (mm === null || t > endMs) continue;
    const day = nairobiDate(t);
    const d = byDay.get(day) ?? { mm: 0, hours: new Set<number>() };
    d.mm += mm;
    d.hours.add(Math.floor(t / HOUR_MS));
    byDay.set(day, d);
  }

  const out: DailyRain[] = [];
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    const start = nairobiDayStart(day);
    const hours = day === lastDay ? Math.max(1, Math.ceil((endMs - start) / HOUR_MS)) : 24;
    const d = byDay.get(day);
    const enough = !!d && d.hours.size >= Math.ceil(MIN_HOURS_SHARE * hours);
    out.push({ date: day, mm: enough ? Math.round(d!.mm * 10) / 10 : null });
  }
  return out;
}
