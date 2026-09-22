import type { DemoObservation } from "./demo-observations";

export interface StationHistory {
  series: DemoObservation[];
  source: "live" | "csv" | "mixed";
  from: string;
  to: string;
}

// Cleaned 15-minute grid covering [endIso - days, endIso] (endIso defaults to now): archive where it covers, live feeds beyond. Cached. Null when nothing covers the range.
export async function getStationHistory(days: number, endIso?: string): Promise<StationHistory | null> {
  void days;
  void endIso;
  return null;
}

export interface DailyRain {
  date: string;
  mm: number | null;
} // date = YYYY-MM-DD in Africa/Nairobi; null = no gauge data that day

// Gauge-1 rain per Nairobi day from the station's own counters, for the `days` days ending the day before endIso's day (plus today so far as the last element). Null when unavailable.
export async function getStationDailyRain(days: number, endIso?: string): Promise<DailyRain[] | null> {
  void days;
  void endIso;
  return null;
}
