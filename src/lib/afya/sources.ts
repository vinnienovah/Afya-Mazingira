// Station observations, in order of preference: the live Conduit feeds, the
// recorded Conduit archive, and a synthetic series only when neither covers
// the time asked for. Every path returns the same 15-minute grid, so the
// pipeline does not care which one it got.
//
// There are two live feeds for the same station (Conduit@Empathy1, CHORDS
// instrument 61): JHUB's Conduit API, which needs a key and has at times run
// most of a day behind, and the public CHORDS portal the station reports to.
// Both are asked and the one with the more recent observation is used.

import { generateDemoSeries, type DemoObservation } from "./demo-observations";
import { fixUvRainColumns, getCsvCoverage, getCsvSeries } from "./csv-source";
import { getStationHistory } from "./station-history";
import { hardLimitRule } from "./sentinel";
import { shadeWbgt, stullWetBulb } from "./constants";

export interface SeriesBundle {
  series: DemoObservation[];
  source: "live" | "csv" | "demo";
  // Which live feed the series came from, when it is live.
  feed: "jhub" | "chords" | null;
  anchorIso: string;
  // True when freshness should be judged against the real clock (live, or the
  // archive's latest row standing in for now); false for a replay or the
  // synthetic series, where it is judged against the anchor itself.
  realtime: boolean;
  // Repeated timestamps removed at ingest, reported rather than dropped quietly.
  duplicatesRemoved: number;
}

// The station records about every 15 minutes, so the live caches are checked
// on the same cadence. Staleness is always judged from the latest observation's
// own timestamp (see evaluateQuality), never from when we last polled. A cache
// older than LIVE_MAX_STALE_MS is refreshed before it is used.
const LIVE_TTL_MS = 15 * 60 * 1000;
const LIVE_MAX_STALE_MS = 6 * 3600 * 1000;
const LIVE_LOOKBACK_MS = 30 * 3600 * 1000;

type LiveBundle = SeriesBundle & { fetchedAt: number };
const liveCache: Record<"jhub" | "chords", LiveBundle | null> = { jhub: null, chords: null };
const inflight: Record<"jhub" | "chords", Promise<void> | null> = { jhub: null, chords: null };

export function hasConduitCreds(): boolean {
  return !!(process.env.CONDUIT_API_KEY && process.env.CONDUIT_EMAIL);
}

/**
 * The observation series for the pipeline. Near "now" the freshest live feed
 * wins; for a time the archive covers, the archive; for a later time, the
 * station history from the live feeds; the synthetic series only when no real
 * source covers the anchor.
 *
 * On a cold cache the live fetches are awaited: Vercel can freeze a function
 * as soon as its response is sent, so a fire-and-forget refresh may never
 * finish. A cached bundle younger than six hours is served while a refresh
 * runs for the next request; an older one is refreshed first.
 */
export async function getObservationSeries(anchorIso: string, lookbackHours = 30): Promise<SeriesBundle> {
  const anchorMs = new Date(anchorIso).getTime();
  const nearNow = Date.now() - anchorMs < 3 * 3600 * 1000;
  const archiveEnd = Date.parse(getCsvCoverage()?.maxIso ?? "");

  if (nearNow) {
    const feeds: ("jhub" | "chords")[] = hasConduitCreds() ? ["jhub", "chords"] : ["chords"];
    await Promise.all(feeds.map((feed) => ensureFresh(feed)));
    const usable = feeds
      .map((feed) => liveCache[feed])
      .filter((b): b is LiveBundle => !!b && !(Date.parse(b.anchorIso) < archiveEnd))
      .sort((a, b) => Date.parse(b.anchorIso) - Date.parse(a.anchorIso));
    if (usable.length) return usable[0];
  } else if (anchorMs > archiveEnd) {
    // A past time after the archive ends: the archive's last window would be
    // the wrong day, so the live feeds' record for that time is used.
    const history = await getStationHistory(lookbackHours / 24, new Date(anchorMs).toISOString());
    if (history && history.series.length >= 20) {
      return {
        series: history.series,
        source: history.source === "csv" ? "csv" : "live",
        feed: history.feed ?? null,
        anchorIso: history.to,
        realtime: false,
        duplicatesRemoved: 0,
      };
    }
    return demoBundle(anchorIso, lookbackHours);
  }

  const csv = getCsvSeries(anchorIso, lookbackHours);
  if (csv) {
    return {
      series: csv.series,
      source: "csv",
      feed: null,
      anchorIso: csv.series[csv.series.length - 1].ts,
      realtime: csv.realtime,
      duplicatesRemoved: 0,
    };
  }

  return demoBundle(anchorIso, lookbackHours);
}

function demoBundle(anchorIso: string, lookbackHours: number): SeriesBundle {
  return {
    series: generateDemoSeries(anchorIso, lookbackHours),
    source: "demo",
    feed: null,
    anchorIso,
    realtime: false,
    duplicatesRemoved: 0,
  };
}

async function ensureFresh(feed: "jhub" | "chords"): Promise<void> {
  const cached = liveCache[feed];
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (age > LIVE_MAX_STALE_MS) {
    await refresh(feed);
  } else if (age > LIVE_TTL_MS) {
    void refresh(feed);
  }
}

async function refresh(feed: "jhub" | "chords"): Promise<void> {
  if (inflight[feed]) {
    await inflight[feed]!.catch(() => {});
    return;
  }
  inflight[feed] = (async () => {
    const now = Date.now();
    const { series, duplicates } = feed === "jhub"
      // todate is exclusive of the current day, so ask for tomorrow to include today.
      ? cleanAndGridWithStats(await fetchConduitRaw(new Date(now - 3 * 86400_000), new Date(now + 86400_000)))
      : cleanAndGridWithStats((await fetchChordsRows(now - LIVE_LOOKBACK_MS, now)).rows, "sums");
    if (series.length < 20) throw new Error(`too few valid observations from ${feed}`);

    liveCache[feed] = {
      series,
      source: "live",
      feed,
      anchorIso: series[series.length - 1].ts,
      realtime: true,
      duplicatesRemoved: duplicates,
      fetchedAt: Date.now(),
    };
  })();

  try {
    await inflight[feed];
  } catch (err) {
    console.warn(`[afya] ${feed} live fetch failed:`, (err as Error).message);
  } finally {
    inflight[feed] = null;
  }
}

// JHUB's Conduit API

/** Raw POST to the Conduit API for a date range. Its rows carry the same
 * records as the archive, so the archive's column fix applies to them too. */
async function fetchConduitRaw(from: Date, to: Date): Promise<Record<string, unknown>[]> {
  const url = process.env.CONDUIT_URL ?? "https://conduit.jhubafrica.com/data.php";
  const body = new URLSearchParams({
    apikey: process.env.CONDUIT_API_KEY!,
    email: process.env.CONDUIT_EMAIL!,
    fromdate: from.toISOString().slice(0, 10),
    todate: to.toISOString().slice(0, 10),
  }).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Conduit HTTP ${res.status}`);

  const json = (await res.json()) as { status?: string; data?: Record<string, unknown>[] };
  if (json.status !== "success" || !Array.isArray(json.data)) {
    throw new Error("Conduit response not successful");
  }
  return json.data.map((r) => fixUvRainColumns(r, parseUtc(r.ts)));
}

// The API refuses any request spanning more than a month, so wide ranges go
// in 28-day pieces, which stay under that whichever months they cross.
const CONDUIT_CHUNK_DAYS = 28;
const CONDUIT_CHUNK_CONCURRENCY = 3;

/**
 * Raw Conduit API rows for [fromMs, toMs], fetched in pieces because of the
 * API's one-month limit. [] without a key or when every piece fails.
 */
export async function fetchConduitRows(fromMs: number, toMs: number): Promise<Record<string, unknown>[]> {
  if (!hasConduitCreds() || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];

  const chunkMs = CONDUIT_CHUNK_DAYS * 86400_000;
  const ranges: [Date, Date][] = [];
  for (let start = fromMs; start <= toMs; start += chunkMs) {
    // todate is exclusive of its own day, which the next piece starts on; the
    // last piece asks for the day after the range.
    const end = Math.min(start + chunkMs, toMs + 86400_000);
    ranges.push([new Date(start), new Date(end)]);
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < ranges.length; i += CONDUIT_CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CONDUIT_CHUNK_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(([from, to]) => fetchConduitRaw(from, to)));
    for (const r of results) {
      if (r.status === "fulfilled") rows.push(...r.value);
      else console.warn("[afya] Conduit range chunk failed:", r.reason?.message ?? r.reason);
    }
  }
  return rows.filter((r) => {
    const t = parseUtc(r.ts);
    return t >= fromMs && t <= toMs;
  });
}

/** Conduit observations for an arbitrary range, gridded. [] on failure. */
export async function getConduitRange(fromIso: string, toIso: string): Promise<DemoObservation[]> {
  return cleanAndGrid(await fetchConduitRows(parseUtc(fromIso), parseUtc(toIso)));
}

// The CHORDS portal's public live feeds

const CHORDS_PORTAL_URL = "https://3d-fewsnet.icdp.ucar.edu";
export const CONDUIT_INSTRUMENT_ID = 61;

// Stations the health checks can be asked for. The nearby ones each had
// observations in the previous 24 hours when checked on 21 September 2026.
// Nyeri Wambugu Farm (13) had none. KMD HQ Nairobi (1) was live but reports
// its rain gauge under another name, which the checks would read as silent.
export const CHORDS_STATIONS = [
  { id: CONDUIT_INSTRUMENT_ID, name: "Conduit@Empathy1" },
  { id: 10, name: "KALRO Thika" },
  { id: 39, name: "Machakos Stoni Athi" },
  { id: 11, name: "Embu" },
] as const;

export type ChordsStation = (typeof CHORDS_STATIONS)[number];

/** The allowlisted station for an `instrument` query value, or null. */
export function findChordsStation(instrument: string): ChordsStation | null {
  return CHORDS_STATIONS.find((s) => String(s.id) === instrument) ?? null;
}

/**
 * The live-feed URL for one window of a CHORDS instrument. CHORDS_LIVE_URL,
 * when set, replaces the feed of Conduit@Empathy1 only.
 */
export function chordsWindowUrl(
  instrument: number,
  start: number,
  end: number,
  conduitLiveUrl = process.env.CHORDS_LIVE_URL,
): string {
  const base = instrument === CONDUIT_INSTRUMENT_ID && conduitLiveUrl
    ? conduitLiveUrl
    : `${CHORDS_PORTAL_URL}/instruments/${instrument}/live`;
  return `${base}?start=${start}&end=${end}`;
}

// The live endpoint returns 15-minute means, on quarter-hour boundaries, for
// any window up to three hours long, and coarser means for longer ones. The
// windows are aligned to three-hour boundaries so every mean covers a whole
// quarter hour, and a finished window never changes, so it is kept.
const CHORDS_WINDOW_MS = 3 * 3600 * 1000;
const CHORDS_SLOT_MS = 15 * 60 * 1000;
const CHORDS_CONCURRENCY = 8;
// More failures than this means the portal is down, not slow.
const CHORDS_RETRY_MAX = 4;
const CHORDS_OPEN_WINDOW_TTL_MS = 5 * 60 * 1000;
const CHORDS_CACHE_MAX = 2000;

// CHORDS short names for the columns the Conduit API calls by longer names.
// wgd is read only for the gust-direction check; the export copies the gust
// speed into it.
const CHORDS_FIELDS: Record<string, string> = {
  rg: "rg1", rg2: "rg2", rgt: "rg1tt", rgt2: "rg2tt", rgp: "rg1tp", rgp2: "rg2tp",
  bt1: "temp_bmx", bp1: "press_bmx", mt1: "temp_mcp",
  st1: "temp_sht", sh1: "humidity_sht",
  sv1: "si1145_vis", si1: "si1145_ir", su1: "si1145_uv",
  ws: "wind_spd", wd: "wind_dir", wg: "wind_gust", wgd: "wind_gust_dir",
  hi: "heat_idx", wbt: "wet_bulb_temp", wbgt: "wet_bulb_globe_temp",
  bv: "battery_v",
};

// Rain arrives as the mean of the one-minute tips in each point; times the
// minutes the point covers, it is the rain that fell in them.
const CHORDS_RAIN_FIELDS = new Set(["rg", "rg2"]);

export interface ChordsRows {
  rows: Record<string, unknown>[];
  // Our names for the channels the instrument lists, whether or not they
  // carried any points.
  channels: string[];
}

const chordsWindows = new Map<string, ChordsRows & { fetchedAt: number; complete: boolean }>();

async function fetchChordsWindow(start: number, end: number, instrument: number): Promise<ChordsRows> {
  const res = await fetch(chordsWindowUrl(instrument, start, end), {
    headers: { "User-Agent": "AfyaMazingira/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`CHORDS HTTP ${res.status}`);
  const json = (await res.json()) as {
    multivariable_points?: Record<string, [number, number][]>;
    multivariable_names?: string[];
  };
  const fetchedAt = Date.now();
  const points = json.multivariable_points ?? {};
  const channels = (json.multivariable_names ?? []).map((short) => CHORDS_FIELDS[short]).filter(Boolean);

  const byTime = new Map<number, Record<string, unknown>>();
  for (const [short, series] of Object.entries(points)) {
    const field = CHORDS_FIELDS[short];
    if (!field || !Array.isArray(series)) continue;
    for (const [ms, value] of series) {
      if (ms < start || ms >= end) continue;
      const minutes = (Math.min(ms + CHORDS_SLOT_MS, end, fetchedAt) - ms) / 60_000;
      if (minutes <= 0) continue;
      const row = byTime.get(ms) ?? { ts: new Date(ms).toISOString() };
      row[field] = CHORDS_RAIN_FIELDS.has(short) ? value * minutes : value;
      byTime.set(ms, row);
    }
  }
  return { rows: [...byTime.values()], channels };
}

async function cachedChordsWindow(start: number, instrument: number): Promise<ChordsRows> {
  const key = `${instrument}:${start}`;
  const hit = chordsWindows.get(key);
  if (hit && (hit.complete || Date.now() - hit.fetchedAt < CHORDS_OPEN_WINDOW_TTL_MS)) return hit;

  const end = start + CHORDS_WINDOW_MS;
  const fresh = await fetchChordsWindow(start, end, instrument);
  // Minute data can reach the portal a few minutes late.
  const complete = Date.now() > end + CHORDS_SLOT_MS;
  chordsWindows.delete(key);
  chordsWindows.set(key, { ...fresh, fetchedAt: Date.now(), complete });
  if (chordsWindows.size > CHORDS_CACHE_MAX) chordsWindows.delete(chordsWindows.keys().next().value!);
  return fresh;
}

/**
 * CHORDS points for [fromMs, toMs], one row per quarter hour, fetched a
 * three-hour window at a time with a few requests in flight; a window that
 * times out is asked for once more. A point covers the quarter hour after its
 * timestamp, so one starting at toMs is left out. Throws when the portal
 * returned nothing at all.
 */
export async function fetchChordsRows(fromMs: number, toMs: number, instrument = CONDUIT_INSTRUMENT_ID): Promise<ChordsRows> {
  const starts: number[] = [];
  for (let s = Math.floor(fromMs / CHORDS_WINDOW_MS) * CHORDS_WINDOW_MS; s < toMs; s += CHORDS_WINDOW_MS) starts.push(s);

  const results = await mapLimit(starts, CHORDS_CONCURRENCY, (s) => cachedChordsWindow(s, instrument));
  const failed = starts.filter((_, i) => !results[i]);
  if (failed.length && failed.length <= CHORDS_RETRY_MAX) {
    const retried = await mapLimit(failed, CHORDS_CONCURRENCY, (s) => cachedChordsWindow(s, instrument));
    failed.forEach((s, i) => (results[starts.indexOf(s)] = retried[i]));
  }
  const rows: Record<string, unknown>[] = [];
  const channels = new Set<string>();
  for (const r of results) {
    if (!r) continue;
    r.channels.forEach((c) => channels.add(c));
    for (const row of r.rows) {
      const t = Date.parse(String(row.ts));
      if (t + CHORDS_SLOT_MS > fromMs && t < toMs) rows.push(row);
    }
  }
  if (!rows.length) throw new Error("CHORDS returned no observations");
  return { rows, channels: [...channels] };
}

/** Run `fn` over `items` with at most `limit` calls in flight; a failed call gives null. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        console.warn("[afya] CHORDS window failed:", (err as Error).message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The cleaned 15-minute grid for the last 30 hours of an instrument on the
 * portal, built the same way as the live series for Conduit@Empathy1, with
 * the channels the instrument lists. Throws when the portal has nothing.
 */
export async function getChordsSeries(instrument: number): Promise<{ series: DemoObservation[]; channels: string[] }> {
  const now = Date.now();
  const { rows, channels } = await fetchChordsRows(now - LIVE_LOOKBACK_MS, now, instrument);
  return { series: cleanAndGrid(rows, "sums"), channels };
}

// Cleaning and the 15-minute grid

/**
 * Where a feed's rain comes from. The Conduit API and the archive keep one
 * sampled minute in about every fifteen, so their rain is read from each
 * gauge's running daily total ("counters"). A CHORDS point is already the rain
 * of its quarter hour ("sums"), and a point without rain is a dry one: the
 * portal leaves rain out while none falls.
 */
export type RainSource = "counters" | "sums";

const NUMERIC_FIELDS = [
  "rg1", "rg2", "rg1tt", "rg2tt", "rg1tp", "rg2tp", "temp_bmx", "press_bmx", "temp_mcp",
  "temp_sht", "humidity_sht", "si1145_vis", "si1145_ir", "wind_spd", "wind_dir",
  "wind_gust", "wind_gust_dir", "heat_idx", "wet_bulb_temp", "wet_bulb_globe_temp", "battery_v",
] as const;
type Field = (typeof NUMERIC_FIELDS)[number];

// Averaged within a slot. The gust and the gust-direction column take the
// slot's highest reading, wind direction its mean on the circle, and rain the
// sum of the slot's readings.
const MEAN_FIELDS = [
  "temp_bmx", "press_bmx", "temp_mcp", "temp_sht", "humidity_sht", "si1145_vis", "si1145_ir",
  "wind_spd", "heat_idx", "wet_bulb_temp", "wet_bulb_globe_temp", "battery_v",
] as const;
const MAX_FIELDS = ["wind_gust", "wind_gust_dir"] as const;

// Interpolated across short gaps; wind direction is interpolated on the circle.
const CONTINUOUS = [
  "temp_bmx", "press_bmx", "temp_mcp", "temp_sht", "humidity_sht",
  "si1145_vis", "si1145_ir", "wind_spd", "wind_gust",
  "heat_idx", "wet_bulb_temp", "wet_bulb_globe_temp",
] as const;

// Gaps up to this many slots (30 minutes) are interpolated. Longer ones carry
// the last value forward so the engines keep running, and every slot that does
// is listed in `imputed` so data quality can see it.
const INTERPOLATE_SLOTS = 2;

// Stand-ins used only before a field has ever been observed in the series.
// Every slot that uses one is marked imputed.
const PLACEHOLDER: Record<string, number> = {
  temp_sht: 20, humidity_sht: 60, press_bmx: 848, wind_spd: 1, wind_dir: 120,
  wet_bulb_temp: 16,
};

const SLOT_MS = 900_000;
// The station reports about every 15 minutes (906 s apart in the archive), so
// a quarter hour without a reading is not a gap; readings more than 20
// minutes apart are, from 15 minutes after the first to the second.
const GAP_AFTER_MS = 20 * 60_000;

// The gauges' running totals restart at 06:00 UTC, the start of the station's
// rain day. They move in 0.2 mm tips.
const RAIN_DAY_START_MS = 6 * 3600_000;
const HALF_TIP_MM = 0.1;
const rainDay = (t: number) => Math.floor((t - RAIN_DAY_START_MS) / 86400_000);

/** A reading after cleaning: its values, the rain it adds for each gauge, and
 * the channels dropped for breaking a hard limit. */
export interface Reading {
  t: number;
  v: Record<Field, number | null>;
  rain: [number | null, number | null];
  rejected: string[];
}

/** Epoch milliseconds for a timestamp; one without a zone is read as UTC. */
export function parseUtc(ts: unknown): number {
  if (typeof ts === "number") return ts;
  const s = String(ts ?? "").trim().replace(" ", "T");
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return Date.parse(s);
  return Date.parse(`${s}Z`);
}

/**
 * Rain between consecutive readings of one gauge, from its running daily
 * total, given to the later reading. Across the 06:00 UTC restart it is the
 * new total plus whatever the previous day ended above its last reading (its
 * final total is the next day's prior total). A total that falls without a
 * restart is a glitch and adds nothing, so it is not counted twice when it
 * recovers. Never negative; null for the first reading and wherever the total
 * is missing.
 */
export function counterRain(
  readings: { t: number; total: number | null; prior: number | null }[],
): (number | null)[] {
  let last: { t: number; peak: number; restartDay: number } | null = null;
  return readings.map(({ t, total, prior }) => {
    if (total === null) return null;
    if (!last) {
      last = { t, peak: total, restartDay: rainDay(t) };
      return null;
    }
    const daysSinceLast = rainDay(t) - rainDay(last.t);
    let mm: number;
    if (daysSinceLast >= 2) {
      // A whole rain day went unread: only the rain since the restart is known.
      mm = total;
      last.peak = total;
      last.restartDay = rainDay(t);
    } else if (total < last.peak - HALF_TIP_MM && rainDay(t) > last.restartDay) {
      mm = total + Math.max(0, (prior ?? last.peak) - last.peak);
      last.peak = total;
      last.restartDay = rainDay(t);
    } else {
      // The same total still running, including the odd day it restarts late.
      mm = Math.max(0, total - last.peak);
      last.peak = Math.max(last.peak, total);
    }
    last.t = t;
    return Math.round(mm * 1000) / 1000;
  });
}

/**
 * Raw rows as readings in time order: numbers only, without the station's
 * -999.9 missing code or readings that break a hard limit, and with each
 * gauge's rain worked out. A repeated timestamp keeps its last row and is
 * counted.
 */
export function toReadings(
  rows: Record<string, unknown>[],
  rain: RainSource = "counters",
): { readings: Reading[]; duplicates: number } {
  const byTs = new Map<number, Record<string, unknown>>();
  let duplicates = 0;
  for (const r of rows) {
    const t = parseUtc(r.ts);
    if (!Number.isFinite(t)) continue;
    if (byTs.has(t)) duplicates++;
    byTs.set(t, r);
  }

  const readings: Reading[] = [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, r]) => {
      const v = {} as Record<Field, number | null>;
      const rejected: string[] = [];
      for (const f of NUMERIC_FIELDS) {
        const raw = r[f];
        let x: number | null = raw === null || raw === undefined || raw === "" ? null : Number(raw);
        if (x !== null && (!Number.isFinite(x) || x === -999.9)) x = null;
        if (x !== null && hardLimitRule(f, x)) {
          rejected.push(f);
          x = null;
        }
        v[f] = x;
      }
      // The firmware's wet bulb, heat index and WBGT are worked out from the
      // SHT readings, so they go with them.
      if (rejected.includes("temp_sht") || rejected.includes("humidity_sht")) {
        v.wet_bulb_temp = v.heat_idx = v.wet_bulb_globe_temp = null;
      }
      return { t, v, rain: [null, null], rejected };
    });

  if (rain === "counters") {
    const gauges = [["rg1tt", "rg1tp"], ["rg2tt", "rg2tp"]] as const;
    gauges.forEach(([total, prior], g) => {
      const mm = counterRain(readings.map((r) => ({ t: r.t, total: r.v[total], prior: r.v[prior] })));
      readings.forEach((r, i) => (r.rain[g] = mm[i]));
    });
  } else {
    for (const r of readings) {
      const reported = NUMERIC_FIELDS.some((f) => r.v[f] !== null);
      r.rain = [r.v.rg1 ?? (reported ? 0 : null), r.v.rg2 ?? (reported ? 0 : null)];
      if (reported) {
        for (const f of ["rg1tt", "rg2tt", "rg1tp", "rg2tp"] as const) r.v[f] ??= 0;
      }
    }
  }
  return { readings, duplicates };
}

/** Readings from several feeds in one time line; the first feed wins a shared timestamp. */
export function mergeReadings(...feeds: Reading[][]): Reading[] {
  const byTs = new Map<number, Reading>();
  for (const feed of feeds) for (const r of feed) if (!byTs.has(r.t)) byTs.set(r.t, r);
  return [...byTs.values()].sort((a, b) => a.t - b.t);
}

export function cleanAndGrid(rows: Record<string, unknown>[], rain: RainSource = "counters"): DemoObservation[] {
  return cleanAndGridWithStats(rows, rain).series;
}

/** The 15-minute grid, plus how many repeated timestamps were removed. */
export function cleanAndGridWithStats(
  rows: Record<string, unknown>[],
  rain: RainSource = "counters",
): { series: DemoObservation[]; duplicates: number } {
  const { readings, duplicates } = toReadings(rows, rain);
  return { series: gridReadings(readings), duplicates };
}

/** Readings on the 15-minute grid, from the first reading's slot to the last's. */
export function gridReadings(readings: Reading[]): DemoObservation[] {
  if (readings.length < 2) return [];
  const bucket0 = Math.floor(readings[0].t / SLOT_MS);
  const slots = Math.floor(readings[readings.length - 1].t / SLOT_MS) - bucket0 + 1;

  // 1. Each slot's readings, combined field by field.
  const acc = Array.from({ length: slots }, () => ({
    sum: {} as Record<string, number>,
    n: {} as Record<string, number>,
    max: {} as Record<string, number>,
    dir: { x: 0, y: 0, n: 0 },
    rain: [null, null] as (number | null)[],
    total: [null, null] as (number | null)[],
    prior: [null, null] as (number | null)[],
    rejected: new Set<string>(),
  }));
  for (const r of readings) {
    const s = acc[Math.floor(r.t / SLOT_MS) - bucket0];
    for (const f of MEAN_FIELDS) {
      const x = r.v[f];
      if (x === null) continue;
      s.sum[f] = (s.sum[f] ?? 0) + x;
      s.n[f] = (s.n[f] ?? 0) + 1;
    }
    for (const f of MAX_FIELDS) {
      const x = r.v[f];
      if (x !== null) s.max[f] = Math.max(s.max[f] ?? -Infinity, x);
    }
    if (r.v.wind_dir !== null) {
      const a = (r.v.wind_dir * Math.PI) / 180;
      s.dir.x += Math.cos(a);
      s.dir.y += Math.sin(a);
      s.dir.n++;
    }
    r.rain.forEach((mm, g) => {
      if (mm !== null) s.rain[g] = (s.rain[g] ?? 0) + mm;
    });
    if (r.v.rg1tt !== null) s.total[0] = r.v.rg1tt;
    if (r.v.rg2tt !== null) s.total[1] = r.v.rg2tt;
    if (r.v.rg1tp !== null) s.prior[0] = r.v.rg1tp;
    if (r.v.rg2tp !== null) s.prior[1] = r.v.rg2tp;
    r.rejected.forEach((f) => s.rejected.add(f));
  }
  const grid = acc.map((s) => {
    const rec: Record<string, number | null> = {};
    for (const f of MEAN_FIELDS) rec[f] = s.n[f] ? s.sum[f] / s.n[f] : null;
    for (const f of MAX_FIELDS) rec[f] = s.max[f] ?? null;
    rec.wind_dir = s.dir.n ? circularDegrees(s.dir.y, s.dir.x) : null;
    rec.rg1 = s.rain[0] === null ? null : Math.round(s.rain[0] * 1000) / 1000;
    rec.rg2 = s.rain[1] === null ? null : Math.round(s.rain[1] * 1000) / 1000;
    rec.rg1tt = s.total[0];
    rec.rg2tt = s.total[1];
    return rec;
  });

  // 2. Time between readings that are too far apart, charged to the slots it covers.
  const gapMinutes = new Array<number>(slots).fill(0);
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1].t;
    const next = readings[i].t;
    if (next - prev <= GAP_AFTER_MS) continue;
    for (let b = Math.floor((prev + SLOT_MS) / SLOT_MS); b * SLOT_MS < next; b++) {
      const overlap = Math.min(next, (b + 1) * SLOT_MS) - Math.max(prev + SLOT_MS, b * SLOT_MS);
      if (overlap > 0) gapMinutes[b - bucket0] += overlap / 60_000;
    }
  }

  // 3. Short gaps in continuous fields are interpolated. Rain never is.
  const interpolated: Set<string>[] = Array.from({ length: slots }, () => new Set());
  for (const f of CONTINUOUS) interpolateLimited(grid, f, INTERPOLATE_SLOTS, interpolated);
  interpolateLimited(grid, "wind_dir", INTERPOLATE_SLOTS, interpolated, true);

  // 4. Assemble. Anything still missing is carried forward (or a placeholder
  //    before the first observation) and listed in `imputed`.
  const out: DemoObservation[] = [];
  const lastKnown: Record<string, number> = {};
  for (let b = 0; b < slots; b++) {
    const rec = grid[b];
    const imputed: string[] = [...interpolated[b]];
    const value = (f: string): number => {
      const v = rec[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        lastKnown[f] = v;
        return v;
      }
      imputed.push(f);
      return lastKnown[f] ?? PLACEHOLDER[f] ?? 0;
    };
    // Missing rain is not the same as no rain, so it is marked too.
    const rain = (f: "rg1" | "rg2"): number => {
      const v = rec[f];
      if (typeof v === "number") return v;
      imputed.push(f);
      return 0;
    };
    // Channels that stand in for each other when one is missing; marked as well.
    const orElse = (f: string, fallback: number): number => {
      const v = rec[f];
      if (typeof v === "number") return v;
      imputed.push(f);
      return fallback;
    };

    const temp_sht = value("temp_sht");
    const humidity_sht = clamp(value("humidity_sht"), 0, 100);
    const measuredWetBulb = rec.wet_bulb_temp;
    const wet_bulb_temp = typeof measuredWetBulb === "number"
      ? value("wet_bulb_temp")
      : stullWetBulb(temp_sht, humidity_sht);
    const wind_spd = Math.max(0, value("wind_spd"));
    const firmware = rec.wet_bulb_globe_temp;

    const o: DemoObservation = {
      ts: new Date((bucket0 + b) * SLOT_MS).toISOString(),
      rg1: rain("rg1"),
      rg2: rain("rg2"),
      rg1tt: rec.rg1tt ?? lastKnown.rg1tt ?? 0,
      rg2tt: rec.rg2tt ?? lastKnown.rg2tt ?? 0,
      temp_bmx: orElse("temp_bmx", temp_sht),
      press_bmx: value("press_bmx"),
      temp_mcp: orElse("temp_mcp", temp_sht),
      temp_sht,
      humidity_sht,
      si1145_vis: Math.max(0, value("si1145_vis")),
      si1145_ir: Math.max(0, value("si1145_ir")),
      si1145_uv: 0, // the UV channel is not trusted
      wind_spd,
      wind_dir: value("wind_dir"),
      wind_gust: Math.max(wind_spd, orElse("wind_gust", wind_spd)),
      heat_idx: orElse("heat_idx", temp_sht),
      wet_bulb_temp,
      wet_bulb_globe_temp: shadeWbgt(temp_sht, wet_bulb_temp),
      firmware_wbgt: typeof firmware === "number" ? firmware : null,
      imputed: [...new Set(imputed)],
    };
    const [prior1, prior2] = acc[b].prior;
    if (prior1 !== null) o.rg1tp = prior1;
    if (prior2 !== null) o.rg2tp = prior2;
    if (acc[b].rejected.size) o.rejected = [...acc[b].rejected];
    if (gapMinutes[b] > 0) o.gap_minutes = Math.round(gapMinutes[b] * 10) / 10;
    if (typeof rec.wind_gust_dir === "number") o.wind_gust_dir = rec.wind_gust_dir;
    if (typeof rec.battery_v === "number") o.battery_v = rec.battery_v;
    out.push(o);
    if (rec.rg1tt !== null && rec.rg1tt !== undefined) lastKnown.rg1tt = rec.rg1tt;
    if (rec.rg2tt !== null && rec.rg2tt !== undefined) lastKnown.rg2tt = rec.rg2tt;
  }
  return out;
}

/** The direction, 0 to 360 degrees, of a summed set of unit vectors. */
function circularDegrees(y: number, x: number): number {
  const deg = Math.round(((Math.atan2(y, x) * 180) / Math.PI) * 10) / 10;
  return ((deg % 360) + 360) % 360;
}

function interpolateLimited(
  grid: Record<string, number | null>[],
  field: string,
  limit: number,
  marks: Set<string>[],
  circular = false,
) {
  const n = grid.length;
  let i = 0;
  while (i < n) {
    if (grid[i][field] === null) {
      let j = i;
      while (j < n && grid[j][field] === null) j++;
      const gap = j - i;
      const prev = i > 0 ? grid[i - 1][field] : null;
      const next = j < n ? grid[j][field] : null;
      if (gap <= limit && prev !== null && next !== null) {
        // On the circle, the short way round: 350 to 10 degrees passes 0.
        const step = circular ? ((((next - prev) % 360) + 540) % 360) - 180 : next - prev;
        for (let k = 0; k < gap; k++) {
          const v = prev + (step * (k + 1)) / (gap + 1);
          grid[i + k][field] = circular ? ((v % 360) + 360) % 360 : v;
          marks[i + k].add(field);
        }
      }
      i = j;
    } else {
      i++;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
