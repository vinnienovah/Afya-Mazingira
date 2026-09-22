"use client";

import { useMemo } from "react";
import useSWR from "swr";
import type { SituationResult } from "@/lib/afya/types";
import { stationWbgtSeries, type ClimateSeriesResponse } from "@/lib/afya/display";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
});

export function useSituation() {
  const { data, error, isLoading, mutate } = useSWR<SituationResult>("/api/situation", fetcher, {
    refreshInterval: 60_000, // refresh every minute
    revalidateOnFocus: true,
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
