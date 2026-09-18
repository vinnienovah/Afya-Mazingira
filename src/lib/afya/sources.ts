// ─── Data source adapters ────────────────────────────────────────────────────
// Production path  : real Conduit POST → clean → 15-min normalized grid
// Demo path        : seeded synthetic generator with the SAME contract
// Both paths produce DemoObservation[] so the pipeline is source-agnostic.
// Live mode activates automatically when CONDUIT_API_KEY + CONDUIT_EMAIL are set.

import { generateDemoSeries, type DemoObservation } from "./demo-observations";

export interface SeriesBundle {
  series: DemoObservation[];
  source: "live" | "demo";
  anchorIso: string;
}

const LIVE_TTL_MS = 12 * 60 * 1000; // refresh every 12 min
const LIVE_MAX_STALE_MS = 6 * 3600 * 1000;

let liveBundle: (SeriesBundle & { fetchedAt: number }) | null = null;
let inflight: Promise<void> | null = null;

function hasConduitCreds(): boolean {
  return !!(process.env.CONDUIT_API_KEY && process.env.CONDUIT_EMAIL);
}

/**
 * Get the observation series for the pipeline.
 * - If Conduit credentials exist and the anchor is near "now", prefer live data
 *   (serving the cached bundle while a background refresh runs).
 * - Otherwise (and for historical replay anchors) use the demo series.
 */
export function getObservationSeries(anchorIso: string, lookbackHours = 30): SeriesBundle {
  const anchorMs = new Date(anchorIso).getTime();
  const nearNow = Date.now() - anchorMs < 3 * 3600 * 1000;

  if (hasConduitCreds() && nearNow) {
    if (liveBundle) {
      if (Date.now() - liveBundle.fetchedAt > LIVE_TTL_MS) void refreshLive();
      if (Date.now() - liveBundle.fetchedAt < LIVE_MAX_STALE_MS) return liveBundle;
    } else {
      void refreshLive();
    }
  }

  return {
    series: generateDemoSeries(anchorIso, lookbackHours),
    source: "demo",
    anchorIso,
  };
}

// ─── Live Conduit ingestion ──────────────────────────────────────────────────

async function refreshLive(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const url = process.env.CONDUIT_URL ?? "https://conduit.jhubafrica.com/data.php";
    // todate is effectively exclusive of the current day — request tomorrow
    // so today's observations are included whenever the station uploads them.
    const to = new Date(Date.now() + 86400_000);
    const from = new Date(Date.now() - 3 * 86400_000);
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
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Conduit HTTP ${res.status}`);

    const json = (await res.json()) as { status?: string; data?: Record<string, unknown>[] };
    if (json.status !== "success" || !Array.isArray(json.data)) {
      throw new Error("Conduit response not successful");
    }

    const grid = cleanAndGrid(json.data);
    if (grid.length < 20) throw new Error("Insufficient valid Conduit observations");

    liveBundle = {
      series: grid,
      source: "live",
      anchorIso: grid[grid.length - 1].ts,
      fetchedAt: Date.now(),
    };
  })();

  try {
    await inflight;
  } catch (err) {
    // Live fetch failed — stay on demo / previous cache (graceful degradation, spec §40)
    console.warn("[afya] Conduit live fetch failed, staying on demo:", (err as Error).message);
  } finally {
    inflight = null;
  }
}

// ─── Cleaning + 15-min normalization (spec §16–17) ───────────────────────────

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

function cleanAndGrid(rows: Record<string, unknown>[]): DemoObservation[] {
  // 1. Parse timestamps, keep last per ts, sort ascending
  const byTs = new Map<number, Record<string, unknown>>();
  for (const r of rows) {
    const t = Date.parse(String(r.ts ?? ""));
    if (!Number.isFinite(t)) continue;
    byTs.set(t, r);
  }
  const sorted = [...byTs.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length < 2) return [];

  // 2. Numeric coercion + -999.9 sentinel removal; wind_gust_dir never read (spec §15.2)
  const cleaned: { ts: number; rec: Record<string, number | null> }[] = sorted.map(([t, r]) => {
    const rec: Record<string, number | null> = {};
    for (const f of NUMERIC_FIELDS) {
      let v: number | null = Number(r[f]);
      if (!Number.isFinite(v) || v === -999.9) v = null;
      rec[f] = v;
    }
    return { ts: t, rec };
  });

  // 3. Bucket onto an exact 15-min grid (mean per bucket)
  const bucket0 = Math.floor(cleaned[0].ts / 900_000);
  const bucketN = Math.floor(cleaned[cleaned.length - 1].ts / 900_000);
  const slots = bucketN - bucket0 + 1;
  const grid: Record<string, number | null>[] = Array.from({ length: slots }, () => {
    const rec: Record<string, number | null> = {};
    for (const f of NUMERIC_FIELDS) rec[f] = null;
    return rec;
  });
  const counts = new Array(slots).fill(0);
  for (const { ts, rec } of cleaned) {
    const b = Math.floor(ts / 900_000) - bucket0;
    counts[b] += 1;
    for (const f of NUMERIC_FIELDS) {
      const v = rec[f];
      if (v === null) continue;
      grid[b][f] = (grid[b][f] ?? 0) + v; // accumulate; divide by count below
    }
  }
  for (let b = 0; b < slots; b++) {
    if (!counts[b]) continue;
    for (const f of NUMERIC_FIELDS) if (grid[b][f] !== null) grid[b][f] = (grid[b][f] as number) / counts[b];
  }

  // 4. Limited interpolation (limit 2 both directions) for continuous fields ONLY.
  //    Rain channels (rg1/rg2) are NEVER interpolated (spec §17).
  for (const f of CONTINUOUS) {
    interpolateLimited(grid as { [k: string]: number | null }[], f, 2);
  }

  // 5. Assemble observations; remaining nulls fall back to nearest known value
  const out: DemoObservation[] = [];
  let lastKnown: Record<string, number> = {};
  for (let b = 0; b < slots; b++) {
    const rec = grid[b];
    const filled: Record<string, number> = { ...lastKnown };
    for (const f of NUMERIC_FIELDS) {
      const v = rec[f];
      if (typeof v === "number" && Number.isFinite(v)) filled[f] = v;
    }
    lastKnown = filled;
    const ts = new Date((bucket0 + b) * 900_000).toISOString();
    out.push({
      ts,
      rg1: rec.rg1 ?? 0,                     // rain present only when observed
      rg2: rec.rg2 ?? 0,
      rg1tt: filled.rg1tt ?? rec.rg1 ?? 0,
      rg2tt: filled.rg2tt ?? rec.rg2 ?? 0,
      temp_bmx: filled.temp_bmx ?? filled.temp_sht ?? 20,
      press_bmx: filled.press_bmx ?? 848,
      temp_mcp: filled.temp_mcp ?? filled.temp_sht ?? 20,
      temp_sht: filled.temp_sht ?? 20,
      humidity_sht: clamp(filled.humidity_sht ?? 60, 0, 100),
      si1145_vis: Math.max(0, filled.si1145_vis ?? 0),
      si1145_ir: Math.max(0, filled.si1145_ir ?? 0),
      si1145_uv: 0,                           // low-trust channel (spec §15.3)
      wind_spd: Math.max(0, filled.wind_spd ?? 1),
      wind_dir: filled.wind_dir ?? 120,
      wind_gust: Math.max(filled.wind_spd ?? 1, filled.wind_gust ?? 1.5),
      heat_idx: filled.heat_idx ?? (filled.temp_sht ?? 20) + 0.4,
      wet_bulb_temp: filled.wet_bulb_temp ?? 16,
      wet_bulb_globe_temp: filled.wet_bulb_globe_temp ?? 17,
    });
  }
  return out;
}

function interpolateLimited(grid: { [k: string]: number | null }[], field: string, limit: number) {
  const n = grid.length;
  let i = 0;
  while (i < n) {
    if (grid[i][field] === null) {
      let j = i;
      while (j < n && grid[j][field] === null) j++;
      const gap = j - i;
      const prev = i > 0 ? (grid[i - 1][field] as number | null) : null;
      const next = j < n ? (grid[j][field] as number | null) : null;
      if (gap <= limit && prev !== null && next !== null) {
        for (let k = 0; k < gap; k++) {
          grid[i + k][field] = prev + ((next - prev) * (k + 1)) / (gap + 1);
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
