// ─── Conduit CSV archive adapter ──────────────────────────────────────────────
// Real recorded station data, downloaded by hand from the Conduit dashboard
// and dropped in data/*.csv, for use while direct API access is blocked
// (Imunify360 bot-protection on conduit.jhubafrica.com — see project notes).
// The CSV's columns are the exact raw Conduit row shape, so it goes through
// the SAME cleaning/gridding pipeline as the live API (sources.ts).
//
// Update the file at any time — it's picked up automatically (checked by
// mtime) without restarting the server.

import fs from "fs";
import path from "path";
import { cleanAndGrid } from "./sources";
import type { DemoObservation } from "./demo-observations";

const CSV_PATH = process.env.CONDUIT_CSV_PATH
  ? path.resolve(process.env.CONDUIT_CSV_PATH)
  : path.join(process.cwd(), "data", "conduit_master_2025_2026.csv");

// If the requested anchor falls further before the file's earliest row than
// this, the archive doesn't meaningfully cover it — let the caller fall
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

function loadCsv(): CsvCache | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(CSV_PATH);
  } catch {
    return null; // no CSV present — caller falls back further
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache;

  const text = fs.readFileSync(CSV_PATH, "utf8");
  const lines = text.split("\n");
  const header = lines[0]?.split(",").map((h) => h.trim());
  if (!header?.length || header[0] !== "ts") {
    console.warn(`[afya] Conduit CSV at ${CSV_PATH} has an unexpected header — ignoring`);
    return null;
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;
    const cols = line.split(",");
    if (cols.length < header.length) continue;
    const tsMs = Date.parse(cols[0]);
    if (!Number.isFinite(tsMs)) continue;
    const rec: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]] = cols[c];
    rows.push({ tsMs, rec });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.tsMs - b.tsMs);

  cache = { mtimeMs: stat.mtimeMs, rows, minMs: rows[0].tsMs, maxMs: rows[rows.length - 1].tsMs };
  return cache;
}

export interface CsvSeriesResult {
  series: DemoObservation[];
  // true when the requested anchor is beyond the file's latest row, i.e. this
  // is standing in for "now" rather than serving a genuine historical replay.
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

  // Rows are sorted ascending — a linear scan is simple and fast enough at
  // this size (tens of thousands of rows, filtered down to a ~30h window).
  const windowRows = loaded.rows
    .filter((r) => r.tsMs >= windowStartMs && r.tsMs <= effectiveAnchorMs)
    .map((r) => r.rec);
  if (windowRows.length < MIN_ROWS_FOR_WINDOW) return null;

  const grid = cleanAndGrid(windowRows);
  if (grid.length < MIN_ROWS_FOR_WINDOW) return null;

  return { series: grid, realtime };
}
