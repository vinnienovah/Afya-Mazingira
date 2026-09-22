// What the farm advice is worked out from: the station first, and Open-Meteo's
// regional model wherever the station has too little of its own. The rules
// that pick between them live in farm-engine.ts; this module only fetches.

import { getObservationSeries } from "./sources";
import { dailyRainFrom, getStationHistory } from "./station-history";
import { STATION_HISTORY_WAIT_MS, within } from "./wait";
import {
  getRegionalDaily,
  getRegionalSoilMoisture,
  regionalRainAhead,
  regionalRainDays,
  type RegionalDaily,
  type RegionalSoilMoisture,
} from "./sources-external";
import {
  BALANCE_DAYS,
  chooseRainRecord,
  computeEt0,
  estimateEt0,
  measuredDailyRanges,
  measuredTempRange,
  MIN_MEASURED_HOURS,
  type DayEt0,
  type FarmInputs,
  type RainDay,
  type TempSlot,
} from "./farm-engine";
import { datesEnding, dayOfYear, nairobiDate } from "./nairobi-time";

// The root-zone balance is carried over BALANCE_DAYS, so the rain record and
// the past ET₀ have to reach that far back. Days the station cannot cover take
// the regional model, which holds a month.
const RAIN_DAYS = BALANCE_DAYS;
const HISTORY_DAYS = BALANCE_DAYS + 1;

export interface FarmSources {
  /** Station 15-minute slots, oldest first. Never the synthetic demo series. */
  station: TempSlot[] | null;
  /** Gauge-1 rain per Nairobi day, the last element today so far */
  stationRain: RainDay[] | null;
  regional: RegionalDaily | null;
  soil: RegionalSoilMoisture | null;
}

/** The farm inputs at `nowMs`; null when there is no temperature range or no
 * rain record to work from. */
export function assembleFarmInputs(nowMs: number, sources: FarmSources): FarmInputs | null {
  const today = nairobiDate(nowMs);
  const regionalByDate = new Map((sources.regional?.days ?? []).map((d) => [d.date, d]));
  const station = sources.station ?? [];

  const et0 = estimateEt0(
    today,
    measuredTempRange(station, new Date(nowMs).toISOString()),
    regionalByDate.get(today) ?? null,
  );

  const stationDays = measuredDailyRanges(station);
  const pastEt0: Record<string, DayEt0> = {};
  for (const date of datesEnding(today, RAIN_DAYS).slice(0, -1)) {
    const s = stationDays.get(date);
    const r = regionalByDate.get(date);
    if (s && s.measured_hours >= MIN_MEASURED_HOURS) {
      pastEt0[date] = { et0_mm: computeEt0(s.tmax_c, s.tmin_c, dayOfYear(date)), source: "station" };
    } else if (r?.tmax_c != null && r.tmin_c != null) {
      pastEt0[date] = { et0_mm: computeEt0(r.tmax_c, r.tmin_c, dayOfYear(date)), source: "regional_model" };
    }
  }

  const rain = chooseRainRecord(
    sources.stationRain?.slice(-RAIN_DAYS) ?? null,
    sources.regional ? regionalRainDays(sources.regional, nowMs, RAIN_DAYS) : null,
  );
  if (!et0 || !rain) return null;

  return {
    today,
    et0,
    past_et0: pastEt0,
    rain,
    regional_et0_mm_day: regionalByDate.get(today)?.et0_mm ?? null,
    forecast_rain_48h_mm: sources.regional ? regionalRainAhead(sources.regional, nowMs) : null,
    soil: sources.soil,
  };
}

export async function loadFarmInputs(nowIso: string = new Date().toISOString()): Promise<FarmInputs | null> {
  const nowMs = Date.parse(nowIso);
  // One history covers both the temperatures and the gauge: the daily rain is
  // read off the same 15-minute grid rather than fetched a second time.
  const [history, regional, soil] = await Promise.all([
    within(getStationHistory(HISTORY_DAYS, nowIso).catch(() => null), STATION_HISTORY_WAIT_MS),
    getRegionalDaily(),
    getRegionalSoilMoisture(),
  ]);
  const firstDay = datesEnding(nairobiDate(nowMs), RAIN_DAYS)[0];
  const stationRain: RainDay[] | null = history ? dailyRainFrom(history.series, firstDay, nowMs) : null;
  let station: TempSlot[] | null = history?.series ?? null;
  if (!station) {
    const live = await getObservationSeries(nowIso, 30).catch(() => null);
    station = live && live.source !== "demo" ? live.series : null;
  }
  return assembleFarmInputs(nowMs, { station, stationRain, regional, soil });
}
