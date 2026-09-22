"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/language";
import {
  BALANCE_DAYS, CROP_PROFILES, type Et0Source, type FarmAdvisory, type GrowthStage, type IrrigationAction,
  type MmRange, type RainSource,
} from "@/lib/afya/farm-engine";
import { tf } from "@/lib/afya/i18n";
import { fmtWindow } from "@/lib/afya/format";
import { Card, CardTitle, CardMeta } from "@/components/ui/Card";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import { QualityDot } from "@/components/ui/QualityDot";
import AiPanel from "@/components/ai/AiPanel";
import { cn } from "@/lib/utils";
import {
  Droplets, Sprout, SprayCan, Sun, CloudRain, Thermometer,
  AlertTriangle, CheckCircle2, Clock, RefreshCw, Leaf, Info, TrendingDown,
} from "lucide-react";

const STAGES: { key: GrowthStage; en: string; sw: string }[] = [
  { key: "establishment", en: "Establishment", sw: "Kuota" },
  { key: "vegetative", en: "Vegetative", sw: "Kukua" },
  { key: "flowering", en: "Flowering", sw: "Kutoa maua" },
  { key: "maturity", en: "Maturity", sw: "Kukomaa" },
];

const ACTION_STYLE: Record<IrrigationAction, { bg: string; border: string; text: string; dot: string }> = {
  IRRIGATE_NOW: { bg: "bg-[#C62828]/8", border: "border-[#C62828]/40", text: "text-[#C62828]", dot: "#C62828" },
  HOLD_RAIN_EXPECTED: { bg: "bg-[#3786B5]/8", border: "border-[#3786B5]/40", text: "text-[#3786B5]", dot: "#3786B5" },
  NO_IRRIGATION: { bg: "bg-[#006B3C]/8", border: "border-[#006B3C]/40", text: "text-[#006B3C]", dot: "#006B3C" },
  DATA_TOO_THIN: { bg: "bg-[#F2B705]/10", border: "border-[#F2B705]/50", text: "text-[#8A6A00]", dot: "#F2B705" },
};

const ET0_SOURCE_KEY: Record<Et0Source, string> = {
  station: "farm_src_station_24h",
  regional_forecast: "farm_src_regional_forecast",
};

const RAIN_SOURCE_KEY: Record<RainSource, string> = {
  station_gauge: "farm_src_station_gauge",
  regional_model: "farm_src_regional_model",
};

const QUALITY_STYLE: Record<string, { color: string; bg: string }> = {
  GOOD: { color: "#006B3C", bg: "bg-[#006B3C]/10" },
  MARGINAL: { color: "#F2B705", bg: "bg-[#F2B705]/15" },
  AVOID: { color: "#C62828", bg: "bg-[#C62828]/10" },
};

const STRESS_STYLE: Record<string, string> = {
  NONE: "#006B3C", MILD: "#F2B705", MODERATE: "#E27832", SEVERE: "#C62828",
};

interface FarmResponse {
  advisory: FarmAdvisory;
  situation: {
    quality: { status: string; freshness_minutes: number };
    current: { temperature_c: number; humidity_pct: number; wind_speed_ms: number };
    demo_mode: boolean;
    best_time_note?: "no_daylight_window" | null;
  };
}

/** "16 Sep" from a YYYY-MM-DD date. */
function fmtDay(date: string, lang: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === "sw" ? "sw-KE" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function FarmPage() {
  const { t, lang } = useLanguage();
  const [crop, setCrop] = useState("maize");
  const [stage, setStage] = useState<GrowthStage>("vegetative");
  // One result, tagged with the crop and stage it answers, so a slow reply
  // for an earlier choice never shows under a later one.
  const [result, setResult] = useState<{ key: string; data: FarmResponse | null; unavailable: boolean } | null>(null);
  const key = `${crop}|${stage}`;

  useEffect(() => {
    let active = true;
    const answering = `${crop}|${stage}`;
    fetch("/api/farm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crop, stage }),
    })
      .then(async (res) => ({
        data: res.ok ? ((await res.json()) as FarmResponse) : null,
        unavailable: res.status === 503,
      }))
      .catch(() => ({ data: null, unavailable: false }))
      .then(({ data, unavailable }) => {
        if (active) setResult({ key: answering, data, unavailable });
      });
    return () => {
      active = false;
    };
  }, [crop, stage]);

  const loading = result?.key !== key;
  const data = loading ? null : result.data;
  const error = loading || data ? null : result.unavailable ? t("farm_unavailable") : t("error_generic");

  useEffect(() => {
    document.title = `${t("farm_title")} | AFYA MAZINGIRA`;
  }, [t]);

  const adv = data?.advisory;
  const wb = adv?.water_balance;
  const irr = adv?.irrigation;
  const actionStyle = irr ? ACTION_STYLE[irr.action] : ACTION_STYLE.NO_IRRIGATION;
  const fmtRange = (r: MmRange) =>
    r.low === r.high ? `${r.low}` : `${r.low} ${lang === "sw" ? "hadi" : "to"} ${r.high}`;
  const unavailable = t("data_unavailable");

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-afya-charcoal flex items-center gap-2">
            <Sprout className="w-6 h-6 text-afya-green" strokeWidth={1.8} aria-hidden="true" />
            {t("farm_title")}
          </h1>
          <p className="text-sm text-afya-muted mt-0.5">{t("farm_sub")}</p>
        </div>
        {data && (
          <QualityDot
            status={data.situation.quality.status as "GOOD" | "DEGRADED" | "POOR"}
            freshnessMinutes={data.situation.quality.freshness_minutes}
          />
        )}
      </div>

      {/* Crop + stage selector */}
      <Card>
        <CardTitle>{t("farm_select_crop")}</CardTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CROP_PROFILES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCrop(c.key)}
              aria-pressed={crop === c.key}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-sm font-medium text-left transition-all",
                crop === c.key
                  ? "border-afya-green bg-afya-green/8 text-afya-green"
                  : "border-afya-border text-afya-charcoal hover:border-afya-green/50",
              )}
            >
              {lang === "sw" ? c.label_sw : c.label_en}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-afya-muted mb-2">{t("farm_growth_stage")}</p>
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStage(s.key)}
                aria-pressed={stage === s.key}
                className={cn(
                  "rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all",
                  stage === s.key
                    ? "border-afya-green bg-afya-green text-white"
                    : "border-afya-border text-afya-charcoal hover:border-afya-green/50",
                )}
              >
                {lang === "sw" ? s.sw : s.en}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Loading */}
      {loading && (
        <>
          <SkeletonCard height="h-32" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SkeletonCard height="h-24" />
            <SkeletonCard height="h-24" />
            <SkeletonCard height="h-24" />
          </div>
        </>
      )}

      {/* Error */}
      {error && !loading && (
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-afya-gold shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
            <p className="text-sm text-afya-muted">{error}</p>
          </div>
        </Card>
      )}

      {/* IRRIGATION DECISION (hero) */}
      {!loading && adv && irr && wb && (
        <>
          <div
            className={cn("rounded-2xl border-2 overflow-hidden", actionStyle.border, actionStyle.bg)}
            role="region"
            aria-label={t("farm_irrigation")}
          >
            <div className="p-6 sm:p-7">
              <div className="flex flex-wrap items-center gap-2.5 mb-3">
                <Droplets className="w-5 h-5" style={{ color: actionStyle.dot }} strokeWidth={1.8} aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-afya-muted">
                  {t("farm_irrigation")}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                  style={{ background: `${actionStyle.dot}18`, color: actionStyle.dot }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: actionStyle.dot }} aria-hidden="true" />
                  {t(`farm_conf_${irr.confidence.toLowerCase()}`)}
                </span>
              </div>

              <h2 className={cn("text-3xl sm:text-4xl font-bold mb-2", actionStyle.text)}>
                {t(`farm_action_${irr.action.toLowerCase()}`)}
              </h2>

              {irr.action === "IRRIGATE_NOW" ? (
                <p className="text-afya-charcoal text-base mb-4">
                  {t("farm_apply")}{" "}
                  <strong className="text-xl tabular-nums">{irr.depth_mm} mm</strong>
                  <span className="text-afya-muted"> · {irr.depth_mm} {t("farm_litres_m2")}</span>
                </p>
              ) : irr.action === "HOLD_RAIN_EXPECTED" ? (
                <p className="text-afya-charcoal text-base mb-4">
                  {t("farm_forecast_rain_48h")}:{" "}
                  <strong className="text-xl tabular-nums">{wb.forecast_rain_48h_mm} mm</strong>
                  <span className="text-afya-muted"> · {t("farm_depletion")} {wb.depletion_mm} mm</span>
                </p>
              ) : irr.action === "DATA_TOO_THIN" ? (
                <p className="text-afya-charcoal text-base mb-4">
                  {t("farm_weekly_requirement")}:{" "}
                  <strong className="text-xl tabular-nums">{wb.weekly_requirement_mm} mm</strong>
                  <span className="text-afya-muted"> · {t("farm_weekly_requirement_hint")}</span>
                </p>
              ) : (
                <p className="text-afya-muted text-base mb-4">
                  {t("farm_no_water_needed")}
                  {irr.days_until_irrigation !== null && (
                    <>
                      {" "}
                      <span className="text-afya-charcoal">
                        {irr.days_until_irrigation === 1
                          ? t("farm_next_irrigation_tomorrow")
                          : tf(lang, "farm_next_irrigation", { days: irr.days_until_irrigation })}
                      </span>
                    </>
                  )}
                </p>
              )}

              {/* Reasons */}
              <ul className="space-y-1.5">
                {irr.reason_keys.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-sm text-afya-charcoal">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: actionStyle.dot }} strokeWidth={2} aria-hidden="true" />
                    {t(r)}
                  </li>
                ))}
              </ul>

              {wb.balance_available && (
                <div className="mt-4 flex items-start gap-2" role="note">
                  <Droplets className="w-3.5 h-3.5 text-afya-muted shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
                  <p className="text-xs text-afya-muted leading-relaxed">
                    {tf(lang, "farm_rain_only_note", { dr: wb.depletion_mm })}
                  </p>
                </div>
              )}

              <div className="mt-3 flex items-start gap-2" role="note">
                <Info className="w-3.5 h-3.5 text-afya-muted shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
                <p className="text-xs text-afya-muted leading-relaxed">{t("farm_indicative_note")}</p>
              </div>
            </div>
          </div>

          {/* ROOT-ZONE DEPLETION, the figure the decision is made on */}
          <Card>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <CardTitle className="mb-0">{t("farm_depletion")}</CardTitle>
                <CardMeta>{tf(lang, "farm_depletion_sub", { days: wb.balance_days })}</CardMeta>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-afya-muted/70 border border-afya-border rounded px-2 py-1">
                FAO-56 · ch. 8
              </span>
            </div>

            {wb.balance_available ? (
              <>
                <div className="rounded-xl border border-afya-border bg-white p-4">
                  <div className="flex justify-between gap-3 text-xs mb-2">
                    <span className="text-afya-muted">
                      {t("farm_depletion")}:{" "}
                      <strong className={cn("tabular-nums", wb.depletion_mm >= wb.readily_available_mm ? "text-afya-orange" : "text-afya-green")}>
                        {wb.depletion_mm} mm
                      </strong>
                    </span>
                    <span className="text-afya-muted text-right">
                      {t("farm_refill_point")}: <strong className="text-afya-charcoal tabular-nums">{wb.readily_available_mm} mm</strong>
                    </span>
                  </div>
                  <div
                    className="relative h-3 rounded-full bg-afya-canvas overflow-hidden"
                    role="img"
                    aria-label={`${t("farm_depletion")}: ${wb.depletion_mm} mm / ${wb.taw_mm} mm`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${Math.min(100, (wb.depletion_mm / Math.max(1, wb.taw_mm)) * 100)}%`,
                        background: wb.depletion_mm >= wb.readily_available_mm ? "#C62828" : "#006B3C",
                      }}
                    />
                    <div
                      className="absolute inset-y-0 w-0.5 bg-afya-charcoal/60"
                      style={{ left: `${Math.min(100, (wb.readily_available_mm / Math.max(1, wb.taw_mm)) * 100)}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="flex justify-between gap-3 mt-2 text-[11px] text-afya-muted tabular-nums">
                    <span>{t("farm_root_zone_full")} · 0 mm</span>
                    <span>TAW {wb.taw_mm} mm · p {wb.depletion_fraction_adjusted}</span>
                  </div>
                </div>
                {wb.balance_days_with_rain < wb.balance_days && (
                  <p className="text-xs text-afya-muted mt-3">
                    {tf(lang, "farm_balance_gaps", {
                      missing: wb.balance_days - wb.balance_days_with_rain,
                      days: wb.balance_days,
                    })}
                  </p>
                )}
                {wb.balance_days < BALANCE_DAYS && (
                  <p className="text-xs text-afya-muted mt-2">
                    {tf(lang, "farm_balance_short_window", { days: wb.balance_days, full: BALANCE_DAYS })}
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-afya-border bg-afya-canvas/50 p-4">
                <div className="text-lg font-bold tabular-nums text-afya-charcoal">{wb.weekly_requirement_mm} mm</div>
                <div className="text-[11px] text-afya-muted">{t("farm_weekly_requirement")}</div>
                <p className="text-xs text-afya-muted mt-2 leading-relaxed">
                  {tf(lang, "farm_balance_short_window", { days: wb.balance_days, full: BALANCE_DAYS })}{" "}
                  {t("farm_weekly_requirement_hint")}
                </p>
              </div>
            )}
          </Card>

          {/* WATER BALANCE */}
          <Card>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <CardTitle className="mb-0">{t("farm_water_balance")}</CardTitle>
                <CardMeta>{t("farm_water_balance_sub")}</CardMeta>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-afya-muted/70 border border-afya-border rounded px-2 py-1">
                FAO-56 · Hargreaves
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                {
                  label: t("farm_et0"),
                  value: `${wb.et0_mm_day} mm`,
                  sub: `${t("farm_per_day")} · ${wb.et0_tmax_c}° / ${wb.et0_tmin_c}°C`,
                  source: t(ET0_SOURCE_KEY[wb.et0_source]),
                  icon: <Sun className="w-4 h-4" />,
                },
                {
                  label: t("farm_et0_regional"),
                  value: wb.regional_et0_mm_day != null ? `${wb.regional_et0_mm_day} mm` : unavailable,
                  sub: t("farm_per_day"),
                  source: t("farm_src_regional_forecast"),
                  icon: <Sun className="w-4 h-4" />,
                },
                {
                  label: t("farm_etc"),
                  value: `${wb.etc_mm_day} mm`,
                  sub: `${t("farm_per_day")} · Kc ${wb.kc}`,
                  source: "FAO-56",
                  icon: <Leaf className="w-4 h-4" />,
                },
                {
                  label: t("farm_rain_7d"),
                  value: `${wb.rain_7d_mm} mm`,
                  sub: `${wb.rain_7d_days_with_data}/7 ${t("farm_days_with_data")}`,
                  source: t(RAIN_SOURCE_KEY[wb.rain_source]),
                  icon: <CloudRain className="w-4 h-4" />,
                },
              ].map((m, i) => (
                <div key={i} className="rounded-xl border border-afya-border bg-afya-canvas/50 p-3">
                  <span className="text-afya-muted" aria-hidden="true">{m.icon}</span>
                  <div className="text-lg font-bold tabular-nums text-afya-charcoal mt-1">{m.value}</div>
                  <div className="text-[11px] text-afya-muted">{m.label}</div>
                  <div className="text-[10px] text-afya-muted/80 tabular-nums">{m.sub}</div>
                  <div className="text-[9px] uppercase tracking-wide text-afya-muted/60 mt-0.5">{m.source}</div>
                </div>
              ))}
            </div>

            {/* 7-day balance bar */}
            <div className="rounded-xl border border-afya-border bg-white p-4">
              <div className="flex justify-between gap-3 text-xs mb-2">
                <span className="text-afya-muted">{t("farm_demand_7d")}: <strong className="text-afya-charcoal tabular-nums">{wb.demand_7d_mm} mm</strong></span>
                <span className="text-afya-muted text-right">{t("farm_supply_7d")}: <strong className="text-afya-charcoal tabular-nums">{wb.effective_rain_7d_mm} mm</strong></span>
              </div>
              <div className="relative h-3 rounded-full bg-afya-canvas overflow-hidden" role="img"
                aria-label={`${t("farm_balance")}: ${wb.balance_7d_mm} mm`}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.min(100, (wb.effective_rain_7d_mm / Math.max(1, wb.demand_7d_mm)) * 100)}%`,
                    background: wb.balance_7d_mm >= 0 ? "#006B3C" : "#E27832",
                  }}
                />
              </div>
              <div className="flex justify-between items-center gap-3 mt-2">
                <span className="text-xs text-afya-muted">
                  {t("farm_balance")}:{" "}
                  <strong className={cn("tabular-nums", wb.balance_7d_mm >= 0 ? "text-afya-green" : "text-afya-orange")}>
                    {wb.balance_7d_mm >= 0 ? "+" : ""}{wb.balance_7d_mm} mm
                  </strong>
                </span>
                <span className="text-xs text-afya-muted text-right">
                  {t("farm_shortfall_7d")}: <strong className="tabular-nums text-afya-charcoal">{wb.net_irrigation_7d_mm} mm</strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <div className="rounded-xl border border-afya-border bg-afya-canvas/50 p-3">
                <div className="text-[11px] text-afya-muted">{t("farm_forecast_rain_48h")}</div>
                <div className="text-base font-bold tabular-nums text-afya-charcoal mt-0.5">
                  {wb.forecast_rain_48h_mm != null ? `${wb.forecast_rain_48h_mm} mm` : unavailable}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-afya-muted/60 mt-0.5">{t("farm_src_regional_forecast")}</div>
              </div>
              <div className="rounded-xl border border-afya-border bg-afya-canvas/50 p-3">
                <div className="text-[11px] text-afya-muted">{t("farm_root_zone")}</div>
                <div className="text-base font-bold tabular-nums text-afya-charcoal mt-0.5">{wb.root_depth_m} m</div>
                <div className="text-[10px] text-afya-muted/80 tabular-nums">
                  {t("farm_root_zone_holds")} {fmtRange(wb.total_available_range_mm)} mm
                </div>
              </div>
              <div className="rounded-xl border border-afya-border bg-afya-canvas/50 p-3">
                <div className="text-[11px] text-afya-muted">{t("farm_soil_rank")}</div>
                <div className="text-base font-bold tabular-nums text-afya-charcoal mt-0.5">
                  {wb.soil_percentile != null ? `${wb.soil_percentile} / 100` : unavailable}
                </div>
                <div className="text-[10px] text-afya-muted/80">{t("farm_soil_rank_hint")}</div>
                {wb.soil_date && (
                  <div className="text-[9px] uppercase tracking-wide text-afya-muted/60 mt-0.5">
                    ERA5-Land · 7–28 cm · {fmtDay(wb.soil_date, lang)}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* OPERATION WINDOWS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Spray window */}
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <SprayCan className="w-4 h-4 text-afya-muted" strokeWidth={1.8} aria-hidden="true" />
                <CardTitle className="mb-0">{t("farm_spray_window")}</CardTitle>
              </div>
              <div
                className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold mb-3", QUALITY_STYLE[adv.spray_window.quality].bg)}
                style={{ color: QUALITY_STYLE[adv.spray_window.quality].color }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: QUALITY_STYLE[adv.spray_window.quality].color }} aria-hidden="true" />
                {t(`farm_window_${adv.spray_window.quality.toLowerCase()}`)}
              </div>
              <ul className="space-y-1">
                {adv.spray_window.reason_keys.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-xs text-afya-muted">
                    <span className="mt-1 w-1 h-1 rounded-full bg-afya-muted shrink-0" aria-hidden="true" />
                    {t(r)}
                  </li>
                ))}
              </ul>
            </Card>

            {/* Field work window */}
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-afya-muted" strokeWidth={1.8} aria-hidden="true" />
                <CardTitle className="mb-0">{t("farm_fieldwork_window")}</CardTitle>
              </div>
              {adv.field_work_window ? (
                <>
                  <div className="text-2xl font-bold tabular-nums text-afya-charcoal mb-2">
                    {fmtWindow(adv.field_work_window.start, adv.field_work_window.end)}
                  </div>
                  <ul className="space-y-1">
                    {adv.field_work_window.reasons.slice(0, 3).map((r) => (
                      <li key={r} className="flex items-start gap-2 text-xs text-afya-green">
                        <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                        {t(r)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-afya-muted">
                  {data?.situation.best_time_note === "no_daylight_window"
                    ? lang === "sw"
                      ? "Hakuna muda wa mchana uliobaki katika utabiri wa saa 9."
                      : "No daylight window is left in the 9-hour forecast."
                    : t("quality_suppressed")}
                </p>
              )}
            </Card>
          </div>

          {/* CROP STRESS + PLANTING */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Heat stress */}
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Thermometer className="w-4 h-4 text-afya-muted" strokeWidth={1.8} aria-hidden="true" />
                <CardTitle className="mb-0">{t("farm_crop_stress")}</CardTitle>
              </div>
              <div className="flex items-baseline gap-3 mb-3">
                <span className="text-2xl font-bold" style={{ color: STRESS_STYLE[adv.stress.level] }}>
                  {t(`farm_stress_${adv.stress.level.toLowerCase()}`)}
                </span>
                <span className="text-sm tabular-nums text-afya-muted">
                  {t("farm_peak_temp")} {adv.stress.peak_temp_c}°C
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-wide text-afya-muted/60 -mt-2 mb-1">
                {t(adv.stress.peak_source === "station" ? "farm_peak_src_station" : "farm_peak_src_regional")}
              </p>
              <p className="text-xs text-afya-muted mb-3">
                {tf(lang, "farm_stress_threshold", { temp: adv.stress.mild_threshold_c })}
              </p>
              <ul className="space-y-1">
                {adv.stress.reason_keys.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-xs text-afya-muted">
                    <span className="mt-1 w-1 h-1 rounded-full bg-afya-muted shrink-0" aria-hidden="true" />
                    {t(r)}
                  </li>
                ))}
              </ul>
            </Card>

            {/* Planting outlook */}
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Sprout className="w-4 h-4 text-afya-muted" strokeWidth={1.8} aria-hidden="true" />
                <CardTitle className="mb-0">{t("farm_planting_outlook")}</CardTitle>
              </div>
              <div className="flex items-center gap-2 mb-2">
                {adv.planting.favourable
                  ? <CheckCircle2 className="w-5 h-5 text-afya-green" strokeWidth={2} aria-hidden="true" />
                  : <TrendingDown className="w-5 h-5 text-afya-orange" strokeWidth={2} aria-hidden="true" />}
                <span className={cn("text-base font-bold", adv.planting.favourable ? "text-afya-green" : "text-afya-orange")}>
                  {adv.planting.favourable ? t("farm_plant_yes") : t("farm_plant_wait")}
                </span>
              </div>
              <p className="text-sm text-afya-muted mb-3">{t(adv.planting.message_key)}</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { v: `${adv.planting.rain_30d_mm}`, l: t("farm_rain_30d"), u: "mm" },
                  { v: `${adv.planting.required_mm}`, l: t("farm_required"), u: "mm" },
                  { v: `${adv.planting.wetting_mm}`, l: t("farm_wetting"), u: "mm" },
                  { v: `${adv.planting.dry_spell_days}`, l: t("farm_dry_spell"), u: lang === "sw" ? "siku" : "days" },
                ].map((s, i) => (
                  <div key={i} className="rounded-lg border border-afya-border bg-afya-canvas/50 px-2 py-2">
                    <div className="text-base font-bold tabular-nums text-afya-charcoal">{s.v}</div>
                    <div className="text-[9px] text-afya-muted">{s.u}</div>
                    <div className="text-[10px] text-afya-muted mt-0.5">{s.l}</div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-afya-muted/80 mt-2">
                {t("farm_wetting")}: {t("farm_wetting_hint")} ({adv.planting.wetting_required_mm} mm)
              </p>
              <p className="text-[9px] uppercase tracking-wide text-afya-muted/60 mt-1">
                {t(RAIN_SOURCE_KEY[adv.planting.rain_source])} · {adv.planting.rain_days_with_data}/30 {t("farm_days_with_data")}
              </p>
            </Card>
          </div>

          {/* AI EXPLANATION */}
          <AiPanel
            context="farm"
            extraParams={{ crop, stage }}
            initialQuestions={lang === "sw"
              ? ["Je, nimwagilie leo?", "Ni wakati gani mzuri wa kunyunyizia dawa?", "Hali ya mvua ikoje wiki hii?"]
              : ["Should I irrigate today?", "When is the best time to spray?", "How is the rainfall this week?"]}
          />

          {/* METHOD + LIMITATIONS */}
          <Card>
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-afya-muted shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-afya-charcoal mb-1">{t("farm_method")}</p>
                <p className="text-xs text-afya-muted leading-relaxed">{t("farm_method_body")}</p>
                <p className="text-xs text-afya-muted/80 leading-relaxed mt-2 italic">{t("farm_disclaimer")}</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
