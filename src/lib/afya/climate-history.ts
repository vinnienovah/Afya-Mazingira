// Climate History: the station's record and ERA5 over a chosen range,
// bucketed by Nairobi day or by hour.

import type { DemoObservation } from "./demo-observations";
import { dailyRainFrom, slotRain } from "./station-history";
import { nairobiDate } from "./nairobi-day";

export type Granularity = "hourly" | "daily";

export interface HistoryPoint {
  time: string;
  temp_c: number | null;
  humidity_pct: number | null;
  wind_ms: number | null;
  rain_mm: number | null;
  pressure_hpa?: number | null;
  wbgt_c?: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (a: number[]) => (a.length ? r1(a.reduce((x, y) => x + y, 0) / a.length) : null);

/**
 * The station's slots as daily (Nairobi) or hourly points. Only measured
 * values count: a bucket where a variable was only filled in shows null for
 * it. Rain is gauge 1's, and a day's rain follows the station daily-rain rule
 * (read in 20 of its 24 hours, or 80 % of the hours so far today).
 */
export function aggregateStation(series: DemoObservation[], granularity: Granularity, endMs: number): HistoryPoint[] {
  const measured = (o: DemoObservation, ...fields: string[]) => !fields.some((f) => o.imputed?.includes(f));
  const keyFor = (ts: string) => (granularity === "daily" ? nairobiDate(ts) : `${ts.slice(0, 13)}:00:00Z`);

  const buckets = new Map<string, DemoObservation[]>();
  for (const o of series) {
    const key = keyFor(o.ts);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(o);
  }
  const dailyRain = granularity === "daily" && series.length
    ? new Map(dailyRainFrom(series, nairobiDate(series[0].ts), endMs).map((d) => [d.date, d.mm]))
    : null;

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([time, slots]) => {
      const values = (pick: (o: DemoObservation) => number, ...fields: string[]) =>
        slots.filter((o) => measured(o, ...fields)).map(pick);
      const rain = slots.map(slotRain).filter((mm): mm is number => mm !== null);
      return {
        time,
        temp_c: mean(values((o) => o.temp_sht, "temp_sht")),
        humidity_pct: mean(values((o) => o.humidity_sht, "humidity_sht")),
        wind_ms: mean(values((o) => o.wind_spd, "wind_spd")),
        pressure_hpa: mean(values((o) => o.press_bmx, "press_bmx")),
        wbgt_c: mean(values((o) => o.wet_bulb_globe_temp, "temp_sht", "wet_bulb_temp")),
        rain_mm: dailyRain ? dailyRain.get(time) ?? null : rain.length ? r1(rain.reduce((s, mm) => s + mm, 0)) : null,
      };
    });
}

/**
 * ERA5 points up to the last one that has any value, and none after `nowMs`.
 * ERA5 is published about five days late, so the latest days come back empty.
 */
export function clipToAvailable(points: HistoryPoint[], granularity: Granularity, nowMs: number): HistoryPoint[] {
  const today = nairobiDate(nowMs);
  const past = points.filter((p) => (granularity === "daily" ? p.time <= today : Date.parse(p.time) <= nowMs));
  let end = past.length;
  while (end > 0 && [past[end - 1].temp_c, past[end - 1].humidity_pct, past[end - 1].rain_mm, past[end - 1].wind_ms].every((v) => v === null)) end--;
  return past.slice(0, end);
}

/**
 * ERA5 reanalysis (the 0.25°, about 28 km, grid) from Open-Meteo's archive.
 * `models=era5` keeps it to ERA5 alone: without it the endpoint blends in
 * forecast-model data for the latest days. Daily values are Nairobi days.
 */
export async function fetchEra5History(
  lat: number,
  lng: number,
  from: string,
  to: string,
  granularity: Granularity,
  nowMs = Date.now(),
): Promise<HistoryPoint[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: from,
    end_date: to,
    models: "era5",
    timezone: granularity === "daily" ? "Africa/Nairobi" : "UTC",
  });
  if (granularity === "daily") {
    params.set("daily", "temperature_2m_mean,relative_humidity_2m_mean,precipitation_sum,wind_speed_10m_mean");
  } else {
    params.set("hourly", "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m");
  }

  const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ERA5 archive HTTP ${res.status}`);
  const json = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_mean?: (number | null)[];
      relative_humidity_2m_mean?: (number | null)[];
      precipitation_sum?: (number | null)[];
      wind_speed_10m_mean?: (number | null)[];
    };
    hourly?: {
      time?: string[];
      temperature_2m?: (number | null)[];
      relative_humidity_2m?: (number | null)[];
      precipitation?: (number | null)[];
      wind_speed_10m?: (number | null)[];
    };
  };

  const kmhToMs = (v: number | null | undefined) => (v == null ? null : r1(v / 3.6));
  let points: HistoryPoint[] = [];
  if (granularity === "daily") {
    const d = json.daily;
    points = (d?.time ?? []).map((t, i) => ({
      time: t,
      temp_c: d?.temperature_2m_mean?.[i] ?? null,
      humidity_pct: d?.relative_humidity_2m_mean?.[i] ?? null,
      rain_mm: d?.precipitation_sum?.[i] ?? null,
      wind_ms: kmhToMs(d?.wind_speed_10m_mean?.[i]),
    }));
  } else {
    const h = json.hourly;
    points = (h?.time ?? []).map((t, i) => ({
      time: t.endsWith("Z") ? t : `${t}Z`,
      temp_c: h?.temperature_2m?.[i] ?? null,
      humidity_pct: h?.relative_humidity_2m?.[i] ?? null,
      rain_mm: h?.precipitation?.[i] ?? null,
      wind_ms: kmhToMs(h?.wind_speed_10m?.[i]),
    }));
  }
  return clipToAvailable(points, granularity, nowMs);
}
