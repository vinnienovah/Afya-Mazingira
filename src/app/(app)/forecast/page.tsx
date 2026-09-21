"use client";

import { useState } from "react";
import Link from "next/link";
import { useForecast } from "@/lib/contexts/situation";
import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import { fmtTime } from "@/lib/afya/format";
import ForecastChart from "@/components/charts/ForecastChart";
import { Card, CardTitle, CardMeta } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ChevronRight, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useSituation } from "@/lib/contexts/situation";

export default function ForecastPage() {
  const { forecast, isLoading, error } = useForecast();
  const { situation } = useSituation();
  const { t, lang } = useLanguage();
  const [showTechnical, setShowTechnical] = useState(false);
  const [showState, setShowState] = useState(true);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <SkeletonCard height="h-64" />
        <SkeletonCard height="h-40" />
      </div>
    );
  }

  if (error || !forecast) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-afya-gold shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
            <div>
              <p className="font-semibold text-afya-charcoal">{t("error_generic")}</p>
              <p className="text-sm text-afya-muted mt-1">{t("error_conduit")}</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const { forecast: horizons, forecast_series, expected_peak, quality, data_source, demo_mode } = forecast;
  const f1h = horizons.find((h) => h.horizon === "1h");
  const f3h = horizons.find((h) => h.horizon === "3h");
  const f6h = horizons.find((h) => h.horizon === "6h");
  const f9h = horizons.find((h) => h.horizon === "9h");

  const trend = f6h && situation
    ? f6h.value > situation.current.wbgt_c + 0.5 ? "up" : f6h.value < situation.current.wbgt_c - 0.5 ? "down" : "flat"
    : "flat";

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("forecast_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("forecast_subtitle")}</p>
      </div>

      {/* Quality warning */}
      {quality.status !== "GOOD" && (
        <div className={`rounded-xl border p-4 ${quality.status === "DEGRADED" ? "border-afya-gold/40 bg-afya-gold/8" : "border-afya-red/40 bg-afya-red/8"}`} role="alert">
          <p className="text-sm font-medium text-afya-charcoal">
            {quality.status === "DEGRADED" ? t("quality_degraded_message") : t("quality_poor_message")}
          </p>
        </div>
      )}

      {/* Signature chart */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <CardTitle className="mb-0">
              {lang === "sw" ? "Chati ya Utabiri" : "WBGT-like Exposure Forecast"}
            </CardTitle>
            <CardMeta>
              {expected_peak
                ? `${t("peak_marker")}: ${fmtTime(expected_peak.time)} · ${expected_peak.wbgt_c.toFixed(1)}°C`
                : ""}
            </CardMeta>
          </div>
          <div className="flex items-center gap-2">
            {trend === "up" && <TrendingUp className="w-4 h-4 text-afya-orange" strokeWidth={2} aria-hidden="true" />}
            {trend === "down" && <TrendingDown className="w-4 h-4 text-afya-teal" strokeWidth={2} aria-hidden="true" />}
            {trend === "flat" && <Minus className="w-4 h-4 text-afya-muted" strokeWidth={2} aria-hidden="true" />}
            <span className="text-xs text-afya-muted">
              {trend === "up" ? t("exposure_rising") : trend === "down" ? t("exposure_falling") : t("exposure_stable")}
            </span>
          </div>
        </div>
        <ForecastChart
          forecastSeries={forecast_series}
          stateHistory={situation?.state_history_24h ?? []}
          height={300}
        />
      </Card>

      {/* Horizon cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { h: f1h, key: "horizon_1h", mae: "0.57" },
          { h: f3h, key: "horizon_3h", mae: "0.93" },
          { h: f6h, key: "horizon_6h", mae: "1.23" },
          { h: f9h, key: "horizon_9h", mae: "1.58" },
        ].map(({ h, key, mae }) => h ? (
          <Card key={key}>
            <div className="flex items-start justify-between mb-2">
              <span className="font-semibold text-afya-charcoal text-sm">{t(key)}</span>
              <div className="text-right">
                <span className="text-[10px] text-afya-muted border border-afya-border rounded px-1.5 py-0.5">{h.model}</span>
                <div className="text-[9px] text-afya-muted/60 mt-0.5">MAE {mae}°C</div>
              </div>
            </div>
            <div className="text-3xl font-bold text-afya-charcoal">{h.value.toFixed(1)}°C</div>
            <div className="text-xs text-afya-muted mt-1">
              {h.lower.toFixed(1)}°C – {h.upper.toFixed(1)}°C
            </div>
          </Card>
        ) : null)}
      </div>

      {/* State background band toggle */}
      {situation && situation.state_history_24h.length > 0 && (
        <Card padding={false}>
          <button
            className="w-full flex items-center justify-between px-5 py-4 text-left"
            onClick={() => setShowState((v) => !v)}
            aria-expanded={showState}
          >
            <span className="text-sm font-semibold text-afya-charcoal">{t("state_timeline")}</span>
            <ChevronRight
              className={`w-4 h-4 text-afya-muted transition-transform ${showState ? "rotate-90" : ""}`}
              strokeWidth={2} aria-hidden="true"
            />
          </button>
          {showState && (
            <div className="px-5 pb-5 border-t border-afya-border pt-4 space-y-2">
              {situation.state_history_24h.map((seg, i) => {
                const meta = STATES[seg.state_id];
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: meta.color }}
                      aria-hidden="true"
                    />
                    <span className="text-sm flex-1">{lang === "sw" ? meta.name_sw : meta.name}</span>
                    <span className="text-xs text-afya-muted font-mono">{fmtTime(seg.start)}–{fmtTime(seg.end)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Uncertainty by horizon — real data (upper - lower per horizon),
          not fabricated. Replaces a previous "secondary charts" section that
          derived fake temperature/humidity/IR/wind values from the WBGT
          forecast number via arbitrary formulas — that was never real data,
          so it's been removed rather than kept for the sake of having more
          charts on the page. */}
      <Card padding={false}>
        <button
          className="w-full flex items-center justify-between px-5 py-4 text-left"
          onClick={() => setShowTechnical((v) => !v)}
          aria-expanded={showTechnical}
          aria-controls="uncertainty-detail"
        >
          <span className="text-sm font-semibold text-afya-charcoal">{t("uncertainty_by_horizon")}</span>
          <ChevronRight
            className={`w-4 h-4 text-afya-muted transition-transform ${showTechnical ? "rotate-90" : ""}`}
            strokeWidth={2} aria-hidden="true"
          />
        </button>
        {showTechnical && (
          <div id="uncertainty-detail" className="border-t border-afya-border px-5 pb-5 pt-4">
            <p className="text-xs text-afya-muted mb-4">{t("uncertainty_by_horizon_note")}</p>
            <div className="space-y-3">
              {[f1h, f3h, f6h, f9h].filter(Boolean).map((h) => {
                const width = h!.upper - h!.lower;
                const maxWidth = Math.max(...[f1h, f3h, f6h, f9h].filter(Boolean).map((x) => x!.upper - x!.lower));
                return (
                  <div key={h!.horizon}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-afya-charcoal font-medium">+{h!.horizon}</span>
                      <span className="text-afya-muted">±{(width / 2).toFixed(1)}°C</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-afya-canvas overflow-hidden">
                      <div
                        className="h-full rounded-full bg-afya-green/60"
                        style={{ width: `${(width / maxWidth) * 100}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Explore further — points to the dedicated Climate History dashboard
          rather than duplicating fake variable charts here. */}
      <Link
        href="/climate"
        className="flex items-center justify-between rounded-2xl border border-afya-border bg-white px-5 py-4 hover:border-afya-green/50 transition-colors group"
      >
        <div>
          <p className="text-sm font-semibold text-afya-charcoal">{t("explore_climate_history")}</p>
          <p className="text-xs text-afya-muted mt-0.5">{t("explore_climate_history_note")}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-afya-muted group-hover:text-afya-green transition-colors shrink-0" strokeWidth={2} aria-hidden="true" />
      </Link>

      {/* Model contributors — real ranked order from the pipeline, no
          fabricated percentage-importance numbers (those weren't computed
          from anything; the underlying deterministic model gives an order,
          not a magnitude). */}
      {forecast.contributors?.length > 0 && (
        <Card>
          <CardTitle>{t("contributor_title")}</CardTitle>
          <p className="text-xs text-afya-muted mb-4">{t("contributor_note")}</p>
          <div className="space-y-2">
            {forecast.contributors.slice(0, 4).map((c, i) => {
              const labels_en: Record<string, string> = {
                temp_rising: "Temperature rising", temp_falling: "Temperature falling",
                high_radiation: "High solar radiation", low_ventilation: "Weak ventilation",
                humidity_falling: "Humidity falling", peak_radiation: "Peak radiation period",
              };
              const labels_sw: Record<string, string> = {
                temp_rising: "Joto linaongezeka", temp_falling: "Joto linapungua",
                high_radiation: "Mionzi mikali ya jua", low_ventilation: "Uingizaji hewa mdogo",
                humidity_falling: "Unyevu unapungua", peak_radiation: "Kipindi cha mionzi ya juu",
              };
              return (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-afya-border bg-afya-canvas/50 px-3 py-2.5">
                  <span className="w-5 h-5 rounded-full bg-afya-deep/10 text-afya-deep text-[11px] font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm text-afya-charcoal">
                    {lang === "sw" ? labels_sw[c.feature] ?? c.feature : labels_en[c.feature] ?? c.feature}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Provenance note — reflects the real data source behind this forecast,
          not a hardcoded "demo data" claim regardless of what's actually live. */}
      <p className="text-[11px] text-afya-muted/60 text-center">
        {lang === "sw"
          ? `Utabiri unatolewa kutoka mfumo wa kisayansi wa AFYA MAZINGIRA. ${
              demo_mode
                ? "Data ya mfano inatumika sasa."
                : data_source === "CONDUIT_ARCHIVE"
                  ? "Umejengwa kwenye hifadhidata halisi ya Conduit."
                  : "Umejengwa kwenye data halisi ya moja kwa moja ya Conduit."
            }`
          : `Forecasts are generated by the AFYA MAZINGIRA deterministic pipeline, built on ${
              demo_mode
                ? "demo data (no live station data available right now)"
                : data_source === "CONDUIT_ARCHIVE"
                  ? "the real Conduit station archive"
                  : "real, live Conduit station observations"
            }.`}
      </p>
    </div>
  );
}
