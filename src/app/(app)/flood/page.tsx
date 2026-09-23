"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { useLanguage } from "@/lib/contexts/language";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { fill, fmtAsOf } from "@/lib/afya/format";
import { NO_DATA_COLOUR } from "@/lib/afya/map-scales";
import { AlertTriangle, Clock, Droplets, Waves } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const GAUGE_SOURCE = "Conduit rain gauge";

interface CountyProps {
  name: string;
  name_sw: string;
  rain_today_mm: number | null;
  soil_moisture: number | null;
  // Null when the rain or soil value it needs is missing
  flood_risk: "LOW" | "ELEVATED" | "HIGH" | null;
  sources: string[];
}
interface FloodThresholds {
  high_rain_mm: number;
  elevated_rain_mm: number;
  wet_soil_rain_mm: number;
  wet_soil_m3: number;
}
interface CountyFeature { properties: CountyProps }
interface MapResponse {
  counties: { features: CountyFeature[] };
  weather_as_of: number | null;
  flood_thresholds: FloodThresholds;
}

type Condition = NonNullable<CountyProps["flood_risk"]>;

// Shades from the map's rain scale, so a county reads as wet ground and heavy
// rain rather than as a thermal risk band.
const CONDITION_META: Record<Condition, { colour: string; key: string }> = {
  HIGH: { colour: "#0F3A5C", key: "flood_cond_high" },
  ELEVATED: { colour: "#1E5A8A", key: "flood_cond_elevated" },
  LOW: { colour: "#3786B5", key: "flood_cond_low" },
};

const RANK: Record<Condition, number> = { HIGH: 2, ELEVATED: 1, LOW: 0 };
const rank = (c: CountyProps["flood_risk"]) => (c ? RANK[c] : -1);

export default function FloodConditionsPage() {
  const { t, lang } = useLanguage();
  const { data, isLoading } = useSWR<MapResponse>("/api/map", fetcher, { refreshInterval: 5 * 60_000 });

  useEffect(() => {
    document.title = `${t("flood_title")} | AFYA MAZINGIRA`;
  }, [t]);

  const counties = (data?.counties?.features ?? [])
    .map((f) => f.properties)
    .sort((a, b) => rank(b.flood_risk) - rank(a.flood_risk));

  const highCount = counties.filter((c) => c.flood_risk === "HIGH").length;
  const elevatedCount = counties.filter((c) => c.flood_risk === "ELEVATED").length;
  const withData = counties.filter((c) => c.flood_risk != null).length;
  const thresholds = data?.flood_thresholds;
  const heldAt = data?.weather_as_of ?? null;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("flood_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("flood_subtitle")}</p>
      </div>

      {/* Honesty note, what this is and, importantly, what it is not */}
      <div className="rounded-xl border border-afya-gold/40 bg-afya-gold/8 p-4 flex gap-3" role="note">
        <AlertTriangle className="w-5 h-5 text-afya-gold shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
        <p className="text-sm text-afya-charcoal">{t("flood_honesty_note")}</p>
      </div>

      {/* Only shown when the last refresh could not replace these readings */}
      {heldAt && (
        <div className="rounded-xl border border-afya-gold/40 bg-afya-gold/8 px-3.5 py-2.5 flex gap-2.5 items-start" role="status">
          <Clock className="w-4 h-4 text-afya-gold shrink-0 mt-px" strokeWidth={1.8} aria-hidden="true" />
          <p className="text-xs text-afya-charcoal">
            {fill(t("flood_held_reading"), { time: fmtAsOf(new Date(heldAt).toISOString(), lang) })}
          </p>
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <div className="text-3xl font-bold" style={{ color: CONDITION_META.HIGH.colour }}>{highCount}</div>
          <div className="text-xs text-afya-muted mt-1">{t("flood_high_count")}</div>
        </Card>
        <Card>
          <div className="text-3xl font-bold" style={{ color: CONDITION_META.ELEVATED.colour }}>{elevatedCount}</div>
          <div className="text-xs text-afya-muted mt-1">{t("flood_elevated_count")}</div>
        </Card>
        <Card>
          <div className="text-3xl font-bold text-afya-charcoal tabular-nums">
            {withData}<span className="text-lg text-afya-muted"> / {counties.length}</span>
          </div>
          <div className="text-xs text-afya-muted mt-1">{t("flood_counties_with_data")}</div>
        </Card>
      </div>

      {/* County list */}
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-2.5">
          {counties.map((c) => {
            const meta = c.flood_risk ? CONDITION_META[c.flood_risk] : null;
            const colour = meta?.colour ?? "#68756F";
            const gauged = c.sources.includes(GAUGE_SOURCE);
            return (
              <Card key={c.name} className="!p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: meta ? `${meta.colour}15` : NO_DATA_COLOUR }}
                  >
                    <Waves className="w-5 h-5" style={{ color: colour }} strokeWidth={1.8} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <div className="font-semibold text-afya-charcoal text-sm">{lang === "sw" ? c.name_sw : c.name}</div>
                    <div className="flex items-center gap-3 flex-wrap text-xs text-afya-muted mt-0.5">
                      <span className="flex items-center gap-1">
                        <Droplets className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                        {c.rain_today_mm != null
                          ? `${c.rain_today_mm.toFixed(1)} ${t(gauged ? "flood_mm_today_gauge" : "flood_mm_today")}`
                          : `${t("flood_rain_today")}: ${t("data_unavailable")}`}
                      </span>
                      <span>
                        {t("flood_soil_moisture")}:{" "}
                        {c.soil_moisture != null ? `${Math.round(c.soil_moisture * 100)}%` : t("data_unavailable")}
                      </span>
                    </div>
                  </div>
                  <span
                    className={
                      meta
                        ? "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold shrink-0"
                        : "inline-flex items-center rounded-full border border-dashed border-[#68756F] px-3 py-1 text-xs font-bold shrink-0"
                    }
                    style={{ backgroundColor: meta ? `${meta.colour}15` : NO_DATA_COLOUR, color: meta ? meta.colour : "#17211C" }}
                  >
                    {meta ? t(meta.key) : t("data_unavailable")}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* The thresholds themselves, as the code applies them */}
      {thresholds && (
        <Card>
          <CardTitle>{t("flood_levels_title")}</CardTitle>
          <dl className="space-y-2.5">
            {([
              ["HIGH", "flood_level_high_rule"],
              ["ELEVATED", "flood_level_elevated_rule"],
              ["LOW", "flood_level_low_rule"],
            ] as const).map(([level, ruleKey]) => (
              <div key={level} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <dt
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold shrink-0"
                  style={{ backgroundColor: `${CONDITION_META[level].colour}15`, color: CONDITION_META[level].colour }}
                >
                  {t(CONDITION_META[level].key)}
                </dt>
                <dd className="text-xs text-afya-muted flex-1 min-w-[200px]">
                  {fill(t(ruleKey), {
                    high: thresholds.high_rain_mm,
                    elevated: thresholds.elevated_rain_mm,
                    wet: thresholds.wet_soil_rain_mm,
                    soil: thresholds.wet_soil_m3.toFixed(2),
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <p className="text-[11px] text-afya-muted/60 text-center">{t("flood_data_note")}</p>
    </div>
  );
}
