// Conduit CSV archive adapter
// Real recorded station data, downloaded by hand from the Conduit dashboard
// and dropped in data/*.csv, for use while direct API access is blocked
// (Imunify360 bot-protection on conduit.jhubafrica.com, see project notes).
// The CSV's columns are the exact raw Conduit row shape, so it goes through
// the SAME cleaning/gridding pipeline as the live API (sources.ts).
//
// Update the file at any time, it's picked up automatically (checked by
// mtime) without restarting the server.

import fs from "fs";
import path from "path";
import { cleanAndGrid, parseUtc } from "./sources";
import type { DemoObservation } from "./demo-observations";

const CSV_PATH = process.env.CONDUIT_CSV_PATH
  ? path.resolve(process.env.CONDUIT_CSV_PATH)
  : path.join(process.cwd(), "data", "conduit_master_2025_2026.csv");

// If the requested anchor falls further before the file's earliest row than
// this, the archive doesn't meaningfully cover it, let the caller fall
// through to the synthetic generator instead of serving a misleading window.
const MAX_LOOKBACK_BEYOND_RANGE_MS = 60 * 86400_000;
const MIN_ROWS_FOR_WINDOW = 20;

interface CsvRow {
  tsMs: number;
  rec: Record<string, unknown>;
}

interface CsvCache {
  mtimeMs: number;
  rows: CsvRow[]; // ascending by tsMs
  minMs: number;
  maxMs: number;
}

let cache: CsvCache | null = null;

// From 1 July 2025 the Conduit records carry the UV index in rg2tt, and
// si1145_uv reads 0: gauge 2's running total is not in them at all (its
// prior-day total, rg2tp, still is). The first row showing it is
// 2025-07-01T04:17:38Z. Records in the old layout return for 3 to 5 July
// and interleave with the new ones on 6 July.
const NEW_LAYOUT_FROM = Date.parse("2025-07-01T00:00:00Z");
const OLD_LAYOUT_AGAIN = [Date.parse("2025-07-03T00:00:00Z"), Date.parse("2025-07-06T00:00:00Z")];
const MIXED_DAY_END = Date.parse("2025-07-07T00:00:00Z");

/** A Conduit record with the UV index in its own column and no stand-in for gauge 2's running total. */
export function fixUvRainColumns(rec: Record<string, unknown>, tsMs: number): Record<string, unknown> {
  if (!(tsMs >= NEW_LAYOUT_FROM) || (tsMs >= OLD_LAYOUT_AGAIN[0] && tsMs < OLD_LAYOUT_AGAIN[1])) return rec;
  // On the mixed day a new-layout row is one whose UV column reads 0 while rg2tt reads more.
  if (tsMs >= OLD_LAYOUT_AGAIN[1] && tsMs < MIXED_DAY_END && !(Number(rec.si1145_uv) === 0 && Number(rec.rg2tt) > 0)) {
    return rec;
  }
  return { ...rec, si1145_uv: rec.rg2tt, rg2tt: null };
}

function loadCsv(): CsvCache | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(CSV_PATH);
  } catch {
    return null; // no CSV present, caller falls back further
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache;

  const text = fs.readFileSync(CSV_PATH, "utf8");
  const lines = text.split("\n");
  const header = lines[0]?.split(",").map((h) => h.trim());
  if (!header?.length || header[0] !== "ts") {
    console.warn(`[afya] Conduit CSV at ${CSV_PATH} has an unexpected header, ignoring`);
    return null;
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;
    const cols = line.split(",");
    if (cols.length < header.length) continue;
    const tsMs = parseUtc(cols[0]);
    if (!Number.isFinite(tsMs)) continue;
    const rec: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]] = cols[c];
    rows.push({ tsMs, rec: fixUvRainColumns(rec, tsMs) });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.tsMs - b.tsMs);

  cache = { mtimeMs: stat.mtimeMs, rows, minMs: rows[0].tsMs, maxMs: rows[rows.length - 1].tsMs };
  return cache;
}

/** Index of the first row at or after `ms`. */
function firstAtOrAfter(rows: CsvRow[], ms: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].tsMs < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Archive records for [fromMs, toMs], plus the one just before, which the
 * rain gauges' running totals need to tell how much fell in the first slot.
 */
export function getCsvRows(fromMs: number, toMs: number): Record<string, unknown>[] {
  const loaded = loadCsv();
  if (!loaded || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];
  const start = Math.max(0, firstAtOrAfter(loaded.rows, fromMs) - 1);
  const end = firstAtOrAfter(loaded.rows, toMs + 1);
  return loaded.rows.slice(start, end).map((r) => r.rec);
}

/** The grid for [fromMs, toMs], without the slots of the record read before it. */
function gridBetween(fromMs: number, toMs: number): DemoObservation[] {
  const firstSlot = Math.floor(fromMs / 900_000) * 900_000;
  return cleanAndGrid(getCsvRows(fromMs, toMs)).filter((o) => Date.parse(o.ts) >= firstSlot);
}

export interface CsvSeriesResult {
  series: DemoObservation[];
  // true when the requested anchor is beyond the file's latest row, i.e. this
  // is standing in for "now" rather than serving a historical replay.
  realtime: boolean;
}

export function getCsvSeries(anchorIso: string, lookbackHours: number): CsvSeriesResult | null {
  const loaded = loadCsv();
  if (!loaded) return null;

  const requestedMs = new Date(anchorIso).getTime();
  if (!Number.isFinite(requestedMs)) return null;
  if (requestedMs < loaded.minMs - MAX_LOOKBACK_BEYOND_RANGE_MS) return null;

  const realtime = requestedMs > loaded.maxMs;
  const effectiveAnchorMs = Math.min(requestedMs, loaded.maxMs);
  const windowStartMs = effectiveAnchorMs - lookbackHours * 3600_000;

  const grid = gridBetween(windowStartMs, effectiveAnchorMs);
  if (grid.length < MIN_ROWS_FOR_WINDOW) return null;

  return { series: grid, realtime };
}

/** The CSV archive's actual date coverage, for bounding a date-range picker. */
export function getCsvCoverage(): { minIso: string; maxIso: string } | null {
  const loaded = loadCsv();
  if (!loaded) return null;
  return { minIso: new Date(loaded.minMs).toISOString(), maxIso: new Date(loaded.maxMs).toISOString() };
}

/**
 * Real recorded observations for an arbitrary [from, to] range (inclusive),
 * for the history views and the model fit; unlike getCsvSeries, this isn't
 * anchored to "now" or a fixed lookback.
 */
export function getCsvRange(fromIso: string, toIso: string): DemoObservation[] {
  const fromMs = parseUtc(fromIso);
  const toMs = parseUtc(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return [];
  return gridBetween(fromMs, toMs);
}
