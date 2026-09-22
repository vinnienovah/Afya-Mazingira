import type { DemoObservation } from "./demo-observations";

// Longer runs of station data than the pipeline's 30-hour window. Until the
// history is assembled from the archive and the live feeds, both return null
// and callers fall back to the archive.

export interface StationHistory {
  series: DemoObservation[];
  source: "live" | "csv" | "mixed";
  from: string;
  to: string;
}

/** Cleaned 15-minute grid covering [endIso - days, endIso] (endIso defaults to now). */
export async function getStationHistory(days: number, endIso?: string): Promise<StationHistory | null> {
  void days;
  void endIso;
  return null;
}

export interface DailyRain {
  date: string;
  mm: number | null;
}

/** Gauge-1 rain per Nairobi day for the `days` days ending the day before endIso's day, plus today so far. */
export async function getStationDailyRain(days: number, endIso?: string): Promise<DailyRain[] | null> {
  void days;
  void endIso;
  return null;
}
