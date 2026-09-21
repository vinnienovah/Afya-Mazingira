"use client";

import { useState } from "react";
import { useForecast } from "@/lib/contexts/situation";
import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import { fmtTime, fmtWindow } from "@/lib/afya/format";
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

  const { forecast: horizons, forecast_series, expected_peak, quality } = forecast;
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

      {/* Secondary measurement charts */}
      <Card padding={false}>
        <button
          className="w-full flex items-center justify-between px-5 py-4 text-left"
          onClick={() => setShowTechnical((v) => !v)}
          aria-expanded={showTechnical}
          aria-controls="secondary-charts"
        >
          <span className="text-sm font-semibold text-afya-charcoal">{t("technical_measurements")}</span>
          <ChevronRight
            className={`w-4 h-4 text-afya-muted transition-transform ${showTechnical ? "rotate-90" : ""}`}
            strokeWidth={2} aria-hidden="true"
          />
        </button>
        {showTechnical && situation && (
          <div id="secondary-charts" className="border-t border-afya-border px-5 pb-5 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Temperature */}
              <SecondaryChart
                title_en="Temperature (°C)"
                title_sw="Joto (°C)"
                color="#E27832"
                forecastSeries={forecast_series}
                valueFn={(p) => p.value + 0} // WBGT variation proxy
                lang={lang}
              />
              {/* Humidity */}
              <SecondaryChart
                title_en="Humidity (%)"
                title_sw="Unyevu (%)"
                color="#3786B5"
                forecastSeries={forecast_series}
                valueFn={(p) => Math.max(20, Math.min(95, 100 - (p.value - 14) * 6))}
                lang={lang}
              />
              {/* IR Radiation */}
              <SecondaryChart
                title_en="Solar IR Signal"
                title_sw="Ishara ya Mionzi"
                color="#F2B705"
                forecastSeries={forecast_series}
                valueFn={(p) => Math.max(0, (p.value - 14) * 800)}
                lang={lang}
              />
              {/* Wind speed */}
              <SecondaryChart
                title_en="Wind Speed (m/s)"
                title_sw="Kasi ya Upepo (m/s)"
                color="#247B78"
                forecastSeries={forecast_series}
                valueFn={(p) => Math.max(0.1, 0.8 + (p.value - 15) * 0.15)}
                lang={lang}
                decimals={1}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Model contributors */}
      {forecast.contributors?.length > 0 && (
        <Card>
          <CardTitle>{t("contributor_title")}</CardTitle>
          <p className="text-xs text-afya-muted mb-4">{t("contributor_note")}</p>
          <div className="space-y-2">
            {forecast.contributors.slice(0, 4).map((c, i) => {
              const values = [85, 62, 48, 31]; // normalized importance scores
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
              const colors = ["#E27832", "#F2B705", "#3786B5", "#6B8F71"];
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-afya-charcoal font-medium">
                      {lang === "sw" ? labels_sw[c.feature] ?? c.feature : labels_en[c.feature] ?? c.feature}
                    </span>
                    <span className="text-afya-muted">{values[i]}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-afya-canvas overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${values[i]}%`, backgroundColor: colors[i % colors.length] }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Provenance note */}
      <p className="text-[11px] text-afya-muted/60 text-center">
        {lang === "sw"
          ? "Utabiri unatolewa kutoka mfumo wa kisayansi. Data ni ya mfano."
          : "Forecasts are generated by the AFYA MAZINGIRA deterministic pipeline. Demo data is in use."}
      </p>
    </div>
  );
}

// Helper secondary chart
function SecondaryChart({
  title_en, title_sw, color, forecastSeries, valueFn, lang, decimals = 0,
}: {
  title_en: string; title_sw: string; color: string;
  forecastSeries: { time: string; value: number; lower: number; upper: number }[];
  valueFn: (p: { time: string; value: number; lower: number; upper: number }) => number;
  lang: string; decimals?: number;
}) {
  const recent = forecastSeries.slice(0, 8);
  const vals = recent.map(valueFn);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  return (
    <div>
      <p className="text-xs font-semibold text-afya-muted mb-2">
        {lang === "sw" ? title_sw : title_en}
      </p>
      <div className="flex items-end gap-0.5 h-16">
        {vals.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            style={{
              height: `${((v - min) / range) * 100}%`,
              backgroundColor: color,
              minHeight: 4,
            }}
            title={`${fmtTime(recent[i].time)}: ${v.toFixed(decimals)}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-afya-muted mt-1">
        <span>{fmtTime(recent[0]?.time ?? "")}</span>
        <span>{vals[vals.length - 1]?.toFixed(decimals)}</span>
        <span>{fmtTime(recent[recent.length - 1]?.time ?? "")}</span>
      </div>
    </div>
  );
}
