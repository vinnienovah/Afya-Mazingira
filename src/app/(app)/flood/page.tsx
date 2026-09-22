"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { useLanguage } from "@/lib/contexts/language";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { RISK_META } from "@/lib/afya/constants";
import { NO_DATA_COLOUR } from "@/lib/afya/map-scales";
import { AlertTriangle, Droplets, Waves } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CountyProps {
  name: string;
  name_sw: string;
  rain_today_mm: number | null;
  soil_moisture: number | null;
  // Null when the rain or soil value it needs is missing
  flood_risk: "LOW" | "ELEVATED" | "HIGH" | null;
  sources: string[];
}
interface CountyFeature { properties: CountyProps }
interface MapResponse { counties: { features: CountyFeature[] } }

const RISK_RANK: Record<string, number> = { HIGH: 2, ELEVATED: 1, LOW: 0 };
const rank = (risk: CountyProps["flood_risk"]) => (risk ? RISK_RANK[risk] : -1);

export default function FloodRiskPage() {
  const { t, lang } = useLanguage();
  const { data, isLoading } = useSWR<MapResponse>("/api/map", fetcher, { refreshInterval: 5 * 60_000 });

  useEffect(() => {
    document.title = `${t("nav_flood")} | AFYA MAZINGIRA`;
  }, [t]);

  const counties = (data?.counties?.features ?? [])
    .map((f) => f.properties)
    .sort((a, b) => rank(b.flood_risk) - rank(a.flood_risk));

  const highCount = counties.filter((c) => c.flood_risk === "HIGH").length;
  const elevatedCount = counties.filter((c) => c.flood_risk === "ELEVATED").length;
  const withData = counties.filter((c) => c.flood_risk != null).length;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("nav_flood")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("flood_subtitle")}</p>
      </div>

      {/* Honesty note, what this is and, importantly, what it is not */}
      <div className="rounded-xl border border-afya-gold/40 bg-afya-gold/8 p-4 flex gap-3" role="note">
        <AlertTriangle className="w-5 h-5 text-afya-gold shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
        <p className="text-sm text-afya-charcoal">{t("flood_honesty_note")}</p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <div className="text-3xl font-bold" style={{ color: RISK_META.HIGH.color }}>{highCount}</div>
          <div className="text-xs text-afya-muted mt-1">{t("flood_high_count")}</div>
        </Card>
        <Card>
          <div className="text-3xl font-bold" style={{ color: RISK_META.ELEVATED.color }}>{elevatedCount}</div>
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
            const meta = c.flood_risk ? RISK_META[c.flood_risk] : null;
            const colour = meta?.color ?? "#68756F";
            return (
              <Card key={c.name} className="!p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: meta ? `${meta.color}15` : NO_DATA_COLOUR }}
                  >
                    <Waves className="w-5 h-5" style={{ color: colour }} strokeWidth={1.8} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <div className="font-semibold text-afya-charcoal text-sm">{lang === "sw" ? c.name_sw : c.name}</div>
                    <div className="flex items-center gap-3 flex-wrap text-xs text-afya-muted mt-0.5">
                      <span className="flex items-center gap-1">
                        <Droplets className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                        {c.rain_today_mm != null
                          ? `${c.rain_today_mm.toFixed(1)} ${t("flood_mm_today")}`
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
                    style={{ backgroundColor: meta ? `${meta.color}15` : NO_DATA_COLOUR, color: meta ? meta.color : "#17211C" }}
                  >
                    {meta ? (lang === "sw" ? meta.sw : meta.en) : t("data_unavailable")}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-afya-muted/60 text-center">{t("flood_data_note")}</p>
    </div>
  );
}
