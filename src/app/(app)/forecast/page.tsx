"use client";

import { useState } from "react";
import Link from "next/link";
import { useSituation, useStationWbgt } from "@/lib/contexts/situation";
import { useLanguage } from "@/lib/contexts/language";
import { horizonScores } from "@/lib/afya/forecast-engine";
import { STATES } from "@/lib/afya/constants";
import { fmtAsOf, fmtTime } from "@/lib/afya/format";
import { modelName, tf } from "@/lib/afya/i18n";
import { exposureTrend, TREND_KEYS } from "@/lib/afya/display";
import ForecastChart from "@/components/charts/ForecastChart";
import { Card, CardTitle, CardMeta } from "@/components/ui/Card";
import { ContributorList } from "@/components/ui/ContributorList";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ChevronRight, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";

// The page reads the same /api/situation as the Situation page, so its cards,
// chart and trend describe the same reading.
export default function ForecastPage() {
  const { situation, isLoading, error } = useSituation();
  const measured = useStationWbgt(situation);
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

  if (error || !situation) {
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

  const {
    forecast: horizons, forecast_series, expected_peak, quality, data_source, demo_mode,
    current, contributors, state_history_24h,
  } = situation;
  const f1h = horizons.find((h) => h.horizon === "1h");
  const f3h = horizons.find((h) => h.horizon === "3h");
  const f6h = horizons.find((h) => h.horizon === "6h");
  const f9h = horizons.find((h) => h.horizon === "9h");
  const trend = exposureTrend(current.wbgt_c, horizons);

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("forecast_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("forecast_subtitle")}</p>
        <p className="text-xs text-afya-muted mt-1">
          {t("data_as_of")} {fmtAsOf(situation.generated_at, lang)}
        </p>
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
              {lang === "sw" ? "Chati ya Utabiri" : "WBGT Forecast (shade)"}
            </CardTitle>
            <CardMeta>
              {expected_peak
                ? `${t("peak_marker")}: ${fmtTime(expected_peak.time)} · ${expected_peak.wbgt_c.toFixed(1)}°C`
                : ""}
            </CardMeta>
          </div>
          <div className="flex items-center gap-2">
            {trend === "rising" && <TrendingUp className="w-4 h-4 text-afya-orange" strokeWidth={2} aria-hidden="true" />}
            {trend === "falling" && <TrendingDown className="w-4 h-4 text-afya-teal" strokeWidth={2} aria-hidden="true" />}
            {trend === "stable" && <Minus className="w-4 h-4 text-afya-muted" strokeWidth={2} aria-hidden="true" />}
            <span className="text-xs text-afya-muted">{t(TREND_KEYS[trend])}</span>
          </div>
        </div>
        <ForecastChart
          forecastSeries={forecast_series}
          measuredSeries={measured}
          stateHistory={state_history_24h}
          height={300}
        />
      </Card>

      {/* Horizon cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { h: f1h, key: "horizon_1h", horizon: "1h" },
          { h: f3h, key: "horizon_3h", horizon: "3h" },
          { h: f6h, key: "horizon_6h", horizon: "6h" },
          { h: f9h, key: "horizon_9h", horizon: "9h" },
        ] as const).map(({ h, key, horizon }) => h ? (
          <Card key={key}>
            <div className="flex items-start justify-between mb-2">
              <span className="font-semibold text-afya-charcoal text-sm">{t(key)}</span>
              <div className="text-right">
                <span className="text-[10px] text-afya-muted border border-afya-border rounded px-1.5 py-0.5">{modelName(lang, h.model)}</span>
                <div className="text-[9px] text-afya-muted/60 mt-0.5" title={lang === "sw" ? "Kwenye miezi ya majaribio" : "On the test months"}>
                  MAE {horizonScores(horizon).mae.toFixed(2)}°C
                </div>
              </div>
            </div>
            <div className="text-3xl font-bold text-afya-charcoal">{h.value.toFixed(1)}°C</div>
            <div className="text-xs text-afya-muted mt-1">
              {t("band_80")}: {h.lower.toFixed(1)}°C – {h.upper.toFixed(1)}°C
            </div>
            <div className="text-[10px] text-afya-muted/70 mt-0.5">
              {tf(lang, "band_80_measured", { pct: Math.round(horizonScores(horizon).coverage80 * 100) })}
            </div>
          </Card>
        ) : null)}
      </div>

      {/* State history list */}
      {state_history_24h.length > 0 && (
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
              {state_history_24h.map((seg, i) => {
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

      {/* Uncertainty by horizon, from each horizon's own band */}
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
                      <span className="text-afya-muted">
                        {t("band_80")} ±{(width / 2).toFixed(1)}°C · {Math.round(horizonScores(h!.horizon).coverage80 * 100)}%
                      </span>
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

      {/* Explore further on the Dashboard rather than duplicating variable charts here */}
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

      {contributors.length > 0 && (
        <Card>
          <CardTitle>{t("contributor_title")}</CardTitle>
          <ContributorList contributors={contributors} />
        </Card>
      )}

      {/* Provenance note, following the source actually behind this forecast */}
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
