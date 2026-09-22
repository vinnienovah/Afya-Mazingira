"use client";

import { useMemo, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { SituationResult } from "@/lib/afya/types";
import { stationWbgtSeries, type ClimateSeriesResponse } from "@/lib/afya/display";
import { readPreferredActivity, situationUrl, subscribePreferredActivity } from "@/lib/preferred-activity";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
});

/** The default activity saved on the Profile page, or null. */
export function usePreferredActivity(): string | null {
  return useSyncExternalStore(subscribePreferredActivity, readPreferredActivity, () => null);
}

// Every component asks for the same address, so the whole app shows one
// situation; the saved default activity only changes the recommended window.
export function useSituation() {
  const url = situationUrl(usePreferredActivity());
  const { data, error, isLoading, mutate } = useSWR<SituationResult>(url, fetcher, {
    refreshInterval: 60_000, // refresh every minute
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  return { situation: data, error, isLoading, refresh: mutate };
}

const NO_POINTS: { time: string; wbgt: number | null }[] = [];

/**
 * The station's measured shade WBGT over the twelve hours up to the
 * situation's latest reading. Fetched again only when that reading changes,
 * so the measured line and the forecast share one "now".
 */
export function useStationWbgt(situation: SituationResult | undefined) {
  const key = situation && situation.data_source !== "DEMO"
    ? ["/api/climate-series", situation.generated_at]
    : null;
  const { data } = useSWR<ClimateSeriesResponse>(key, ([url]: [string]) => fetcher(url), {
    revalidateOnFocus: false,
  });
  return useMemo(
    () => (situation && data ? stationWbgtSeries(data, situation) : NO_POINTS),
    [situation, data],
  );
}
