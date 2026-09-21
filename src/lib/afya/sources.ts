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
import { getCsvSeries } from "./csv-source";
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
// own timestamp (see evaluateQuality), never from when we last polled.
const LIVE_TTL_MS = 15 * 60 * 1000;
const LIVE_MAX_STALE_MS = 6 * 3600 * 1000;
const LIVE_LOOKBACK_MS = 30 * 3600 * 1000;

type LiveBundle = SeriesBundle & { fetchedAt: number };
const liveCache: Record<"jhub" | "chords", LiveBundle | null> = { jhub: null, chords: null };
const inflight: Record<"jhub" | "chords", Promise<void> | null> = { jhub: null, chords: null };

function hasConduitCreds(): boolean {
  return !!(process.env.CONDUIT_API_KEY && process.env.CONDUIT_EMAIL);
}

/**
 * The observation series for the pipeline. Near "now" the freshest live feed
 * wins; otherwise the recorded archive; the synthetic series only when neither
 * real source covers the anchor.
 *
 * On a cold cache the live fetches are awaited: Vercel can freeze a function
 * as soon as its response is sent, so a fire-and-forget refresh may never
 * finish. Once a cached bundle exists, a stale one is served while a refresh
 * runs for the next request.
 */
export async function getObservationSeries(anchorIso: string, lookbackHours = 30): Promise<SeriesBundle> {
  const anchorMs = new Date(anchorIso).getTime();
  const nearNow = Date.now() - anchorMs < 3 * 3600 * 1000;

  if (nearNow) {
    const feeds: ("jhub" | "chords")[] = hasConduitCreds() ? ["jhub", "chords"] : ["chords"];
    await Promise.all(feeds.map((feed) => ensureFresh(feed)));
    const usable = feeds
      .map((feed) => liveCache[feed])
      .filter((b): b is LiveBundle => !!b && Date.now() - b.fetchedAt < LIVE_MAX_STALE_MS)
      .sort((a, b) => Date.parse(b.anchorIso) - Date.parse(a.anchorIso));
    if (usable.length) return usable[0];
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
  if (!cached) {
    await refresh(feed);
  } else if (Date.now() - cached.fetchedAt > LIVE_TTL_MS) {
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
    const rows = feed === "jhub"
      // todate is exclusive of the current day, so ask for tomorrow to include today.
      ? await fetchConduitRaw(new Date(now - 3 * 86400_000), new Date(now + 86400_000))
      : await fetchChordsRaw(new Date(now - LIVE_LOOKBACK_MS), new Date(now));

    const { series, duplicates } = cleanAndGridWithStats(rows);
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

/** Raw POST to the Conduit API for a date range. Shared by the live refresh
 * and the Climate History dashboard, which fills the gap between the archive's
 * last row and today. */
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
  return json.data;
}

// The API refuses any request spanning more than a month, so wide ranges go
// in 28-day pieces, which stay under that whichever months they cross.
const CONDUIT_CHUNK_DAYS = 28;
const CONDUIT_CHUNK_CONCURRENCY = 3;

/**
 * Conduit observations for an arbitrary range, for the Climate History
 * dashboard. Fetched in pieces because of the API's one-month limit. Returns
 * [] on failure; the caller already has the archive for the same range.
 */
export async function getConduitRange(fromIso: string, toIso: string): Promise<DemoObservation[]> {
  if (!hasConduitCreds()) return [];

  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];

  const chunkMs = CONDUIT_CHUNK_DAYS * 86400_000;
  const ranges: [Date, Date][] = [];
  for (let start = fromMs; start <= toMs; start += chunkMs) {
    const end = Math.min(start + chunkMs, toMs);
    ranges.push([new Date(start), new Date(end)]);
  }

  const allRows: Record<string, unknown>[] = [];
  for (let i = 0; i < ranges.length; i += CONDUIT_CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CONDUIT_CHUNK_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(([from, to]) => fetchConduitRaw(from, to)));
    for (const r of results) {
      if (r.status === "fulfilled") allRows.push(...r.value);
      else console.warn("[afya] Conduit range chunk failed:", r.reason?.message ?? r.reason);
    }
  }

  return cleanAndGrid(allRows);
}

// The CHORDS portal's public live feed

const CHORDS_URL = process.env.CHORDS_LIVE_URL ?? "https://3d-fewsnet.icdp.ucar.edu/instruments/61/live";

// The live endpoint averages whatever window it is given into about a dozen
// points, so three-hour windows come back as 15-minute means.
const CHORDS_WINDOW_MS = 3 * 3600 * 1000;

// CHORDS short names for the columns the Conduit API calls by longer names.
const CHORDS_FIELDS: Record<string, string> = {
  rg: "rg1", rg2: "rg2", rgt: "rg1tt", rgt2: "rg2tt",
  bt1: "temp_bmx", bp1: "press_bmx", mt1: "temp_mcp",
  st1: "temp_sht", sh1: "humidity_sht",
  sv1: "si1145_vis", si1: "si1145_ir", su1: "si1145_uv",
  ws: "wind_spd", wd: "wind_dir", wg: "wind_gust",
  hi: "heat_idx", wbt: "wet_bulb_temp", wbgt: "wet_bulb_globe_temp",
};

// Rain arrives as a mean of one-minute tips over each 15-minute point; times
// 15 it is the rain that fell in that quarter hour.
const CHORDS_RAIN_FIELDS = new Set(["rg", "rg2"]);

async function fetchChordsWindow(start: number, end: number): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${CHORDS_URL}?start=${start}&end=${end}`, {
    headers: { "User-Agent": "AfyaMazingira/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`CHORDS HTTP ${res.status}`);
  const json = (await res.json()) as { multivariable_points?: Record<string, [number, number][]> };
  const points = json.multivariable_points ?? {};

  const byTime = new Map<number, Record<string, unknown>>();
  for (const [short, series] of Object.entries(points)) {
    const field = CHORDS_FIELDS[short];
    if (!field || !Array.isArray(series)) continue;
    for (const [ms, value] of series) {
      const row = byTime.get(ms) ?? { ts: new Date(ms).toISOString() };
      row[field] = CHORDS_RAIN_FIELDS.has(short) ? value * 15 : value;
      byTime.set(ms, row);
    }
  }
  return [...byTime.values()];
}

async function fetchChordsRaw(from: Date, to: Date): Promise<Record<string, unknown>[]> {
  const windows: [number, number][] = [];
  for (let start = from.getTime(); start < to.getTime(); start += CHORDS_WINDOW_MS) {
    windows.push([start, Math.min(start + CHORDS_WINDOW_MS, to.getTime())]);
  }
  const results = await Promise.allSettled(windows.map(([s, e]) => fetchChordsWindow(s, e)));
  // Neighbouring windows share their edge point; that is our overlap, not a
  // repeat from the station, so it is merged here rather than counted later.
  const byTs = new Map<string, Record<string, unknown>>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const row of r.value) byTs.set(String(row.ts), { ...byTs.get(String(row.ts)), ...row });
  }
  if (!byTs.size) throw new Error("CHORDS returned no observations");
  return [...byTs.values()];
}

// Cleaning and the 15-minute grid

const NUMERIC_FIELDS = [
  "rg1", "rg2", "rg1tt", "rg2tt", "temp_bmx", "press_bmx", "temp_mcp",
  "temp_sht", "humidity_sht", "si1145_vis", "si1145_ir", "wind_spd",
  "wind_dir", "wind_gust", "heat_idx", "wet_bulb_temp", "wet_bulb_globe_temp",
] as const;

const CONTINUOUS = [
  "temp_bmx", "press_bmx", "temp_mcp", "temp_sht", "humidity_sht",
  "si1145_vis", "si1145_ir", "wind_spd", "wind_dir", "wind_gust",
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

export function cleanAndGrid(rows: Record<string, unknown>[]): DemoObservation[] {
  return cleanAndGridWithStats(rows).series;
}

/** The 15-minute grid, plus how many repeated timestamps were removed. */
export function cleanAndGridWithStats(rows: Record<string, unknown>[]): {
  series: DemoObservation[];
  duplicates: number;
} {
  // 1. Parse timestamps; a repeated timestamp keeps its last row and is counted.
  const byTs = new Map<number, Record<string, unknown>>();
  let duplicates = 0;
  for (const r of rows) {
    const t = Date.parse(String(r.ts ?? ""));
    if (!Number.isFinite(t)) continue;
    if (byTs.has(t)) duplicates++;
    byTs.set(t, r);
  }
  const sorted = [...byTs.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length < 2) return { series: [], duplicates };

  // 2. Numbers only; -999.9 is the station's missing-value code. wind_gust_dir
  //    is never read: the exports copy the gust speed into it.
  const cleaned = sorted.map(([t, r]) => {
    const rec: Record<string, number | null> = {};
    for (const f of NUMERIC_FIELDS) {
      const raw = r[f];
      let v: number | null = raw === null || raw === undefined || raw === "" ? null : Number(raw);
      if (v !== null && (!Number.isFinite(v) || v === -999.9)) v = null;
      rec[f] = v;
    }
    return { ts: t, rec };
  });

  // 3. Mean of each field per 15-minute slot, over the rows that have it.
  const bucket0 = Math.floor(cleaned[0].ts / 900_000);
  const bucketN = Math.floor(cleaned[cleaned.length - 1].ts / 900_000);
  const slots = bucketN - bucket0 + 1;
  const sums: Record<string, number | null>[] = Array.from({ length: slots }, () => {
    const rec: Record<string, number | null> = {};
    for (const f of NUMERIC_FIELDS) rec[f] = null;
    return rec;
  });
  const counts: Record<string, number>[] = Array.from({ length: slots }, () => ({}));
  for (const { ts, rec } of cleaned) {
    const b = Math.floor(ts / 900_000) - bucket0;
    for (const f of NUMERIC_FIELDS) {
      const v = rec[f];
      if (v === null) continue;
      sums[b][f] = (sums[b][f] ?? 0) + v;
      counts[b][f] = (counts[b][f] ?? 0) + 1;
    }
  }
  const grid = sums.map((rec, b) => {
    const out: Record<string, number | null> = {};
    for (const f of NUMERIC_FIELDS) out[f] = rec[f] === null ? null : (rec[f] as number) / counts[b][f];
    return out;
  });

  // 4. Short gaps in continuous fields are interpolated. Rain never is.
  const interpolated: Set<string>[] = Array.from({ length: slots }, () => new Set());
  for (const f of CONTINUOUS) interpolateLimited(grid, f, INTERPOLATE_SLOTS, interpolated);

  // 5. Assemble. Anything still missing is carried forward (or a placeholder
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

    const temp_sht = value("temp_sht");
    const humidity_sht = clamp(value("humidity_sht"), 0, 100);
    const measuredWetBulb = rec.wet_bulb_temp;
    const wet_bulb_temp = typeof measuredWetBulb === "number"
      ? value("wet_bulb_temp")
      : stullWetBulb(temp_sht, humidity_sht);
    const wind_spd = Math.max(0, value("wind_spd"));
    const firmware = rec.wet_bulb_globe_temp;

    out.push({
      ts: new Date((bucket0 + b) * 900_000).toISOString(),
      rg1: rain("rg1"),
      rg2: rain("rg2"),
      rg1tt: rec.rg1tt ?? lastKnown.rg1tt ?? 0,
      rg2tt: rec.rg2tt ?? lastKnown.rg2tt ?? 0,
      temp_bmx: rec.temp_bmx ?? temp_sht,
      press_bmx: value("press_bmx"),
      temp_mcp: rec.temp_mcp ?? temp_sht,
      temp_sht,
      humidity_sht,
      si1145_vis: Math.max(0, value("si1145_vis")),
      si1145_ir: Math.max(0, value("si1145_ir")),
      si1145_uv: 0, // the UV channel is not trusted
      wind_spd,
      wind_dir: value("wind_dir"),
      wind_gust: Math.max(wind_spd, rec.wind_gust ?? wind_spd),
      heat_idx: rec.heat_idx ?? temp_sht,
      wet_bulb_temp,
      wet_bulb_globe_temp: shadeWbgt(temp_sht, wet_bulb_temp),
      firmware_wbgt: typeof firmware === "number" ? firmware : null,
      imputed: [...new Set(imputed)],
    });
    if (rec.rg1tt !== null && rec.rg1tt !== undefined) lastKnown.rg1tt = rec.rg1tt;
    if (rec.rg2tt !== null && rec.rg2tt !== undefined) lastKnown.rg2tt = rec.rg2tt;
  }
  return { series: out, duplicates };
}

function interpolateLimited(
  grid: Record<string, number | null>[],
  field: string,
  limit: number,
  marks: Set<string>[],
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
        for (let k = 0; k < gap; k++) {
          grid[i + k][field] = prev + ((next - prev) * (k + 1)) / (gap + 1);
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
