"use client";

import useSWR from "swr";
import type { SituationResult } from "@/lib/afya/types";

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

export function useForecast() {
  const { data, error, isLoading } = useSWR<{
    generated_at: string;
    data_source: string;
    demo_mode: boolean;
    forecast: import("@/lib/afya/types").HorizonForecast[];
    forecast_series: import("@/lib/afya/types").ForecastPoint[];
    expected_peak: { time: string; wbgt_c: number } | null;
    quality: import("@/lib/afya/types").DataQuality;
    state: import("@/lib/afya/types").EnvironmentalState;
    risk: import("@/lib/afya/types").RiskAssessment;
    contributors: import("@/lib/afya/types").Contributor[];
  }>("/api/forecast", fetcher, { refreshInterval: 60_000 });
  return { forecast: data, error, isLoading };
}
