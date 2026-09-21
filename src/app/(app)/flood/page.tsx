"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { useLanguage } from "@/lib/contexts/language";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { RISK_META } from "@/lib/afya/constants";
import { AlertTriangle, Droplets, Waves } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CountyProps {
  name: string;
  name_sw: string;
  rain_24h_mm: number;
  soil_moisture: number;
  flood_risk: "LOW" | "ELEVATED" | "HIGH";
  sources: string[];
}
interface CountyFeature { properties: CountyProps }
interface MapResponse { counties: { features: CountyFeature[] } }

const RISK_RANK: Record<string, number> = { HIGH: 2, ELEVATED: 1, LOW: 0 };

export default function FloodRiskPage() {
  const { t, lang } = useLanguage();
  const { data, isLoading } = useSWR<MapResponse>("/api/map", fetcher, { refreshInterval: 5 * 60_000 });

  useEffect(() => {
    document.title = `${t("nav_flood")} | AFYA MAZINGIRA`;
  }, [t]);

  const counties = (data?.counties.features ?? [])
    .map((f) => f.properties)
    .sort((a, b) => RISK_RANK[b.flood_risk] - RISK_RANK[a.flood_risk]);

  const highCount = counties.filter((c) => c.flood_risk === "HIGH").length;
  const elevatedCount = counties.filter((c) => c.flood_risk === "ELEVATED").length;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("nav_flood")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("flood_subtitle")}</p>
      </div>

      {/* Honesty note — what this is and, importantly, what it is not */}
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
          <div className="text-3xl font-bold text-afya-charcoal">{counties.length}</div>
          <div className="text-xs text-afya-muted mt-1">{t("flood_counties_monitored")}</div>
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
            const meta = RISK_META[c.flood_risk];
            return (
              <Card key={c.name} className="!p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${meta.color}15` }}>
                    <Waves className="w-5 h-5" style={{ color: meta.color }} strokeWidth={1.8} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <div className="font-semibold text-afya-charcoal text-sm">{lang === "sw" ? c.name_sw : c.name}</div>
                    <div className="flex items-center gap-3 text-xs text-afya-muted mt-0.5">
                      <span className="flex items-center gap-1">
                        <Droplets className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                        {c.rain_24h_mm.toFixed(1)} mm/24h
                      </span>
                      <span>{t("flood_soil_moisture")}: {Math.round(c.soil_moisture * 100)}%</span>
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold shrink-0"
                    style={{ backgroundColor: `${meta.color}15`, color: meta.color }}
                  >
                    {lang === "sw" ? meta.sw : meta.en}
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
