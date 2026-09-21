"use client";

import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { CROP_PROFILES, type GrowthStage, type FarmAdvisory } from "@/lib/afya/farm-engine";
import { fmtWindow, fmtTime } from "@/lib/afya/format";
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

const ACTION_STYLE: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  IRRIGATE_NOW: { bg: "bg-[#C62828]/8", border: "border-[#C62828]/40", text: "text-[#C62828]", dot: "#C62828" },
  IRRIGATE_SOON: { bg: "bg-[#E27832]/8", border: "border-[#E27832]/40", text: "text-[#E27832]", dot: "#E27832" },
  HOLD_RAIN_EXPECTED: { bg: "bg-[#3786B5]/8", border: "border-[#3786B5]/40", text: "text-[#3786B5]", dot: "#3786B5" },
  NO_IRRIGATION: { bg: "bg-[#006B3C]/8", border: "border-[#006B3C]/40", text: "text-[#006B3C]", dot: "#006B3C" },
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
    chirps: { chirps_7d_mm: number; chirps_30d_mm: number; chirps_percentile: number; chirps_dry_spell_days: number };
    era5: { era5_soil_moisture: number };
    demo_mode: boolean;
  };
}

export default function FarmPage() {
  const { t, lang } = useLanguage();
  const [crop, setCrop] = useState("maize");
  const [stage, setStage] = useState<GrowthStage>("vegetative");
  const [data, setData] = useState<FarmResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (c: string, s: GrowthStage) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/farm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crop: c, stage: s }),
      });
      if (!res.ok) throw new Error("failed");
      setData(await res.json());
    } catch {
      setError(t("error_generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    document.title = `${t("farm_title")} | AFYA MAZINGIRA`;
  }, [t]);

  useEffect(() => { load(crop, stage); }, [crop, stage, load]);

  const adv = data?.advisory;
  const wb = adv?.water_balance;
  const irr = adv?.irrigation;
  const actionStyle = irr ? ACTION_STYLE[irr.action] : ACTION_STYLE.NO_IRRIGATION;

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

              {irr.depth_mm > 0 ? (
                <p className="text-afya-charcoal text-base mb-4">
                  {t("farm_apply")}{" "}
                  <strong className="text-xl tabular-nums">{irr.depth_mm} mm</strong>
                  <span className="text-afya-muted"> · {irr.litres_per_m2} {t("farm_litres_m2")}</span>
                </p>
              ) : (
                <p className="text-afya-muted text-base mb-4">{t("farm_no_water_needed")}</p>
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
            </div>
          </div>

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
                { label: t("farm_et0"), value: `${wb.et0_mm_day} mm`, sub: t("farm_per_day"), icon: <Sun className="w-4 h-4" /> },
                { label: t("farm_etc"), value: `${wb.etc_mm_day} mm`, sub: `Kc ${wb.kc}`, icon: <Leaf className="w-4 h-4" /> },
                { label: t("farm_rain_7d"), value: `${wb.rain_7d_mm} mm`, sub: t("historical_label"), icon: <CloudRain className="w-4 h-4" /> },
                { label: t("farm_soil_moisture"), value: `${wb.soil_moisture_pct}%`, sub: t("regional_model_label"), icon: <Droplets className="w-4 h-4" /> },
              ].map((m, i) => (
                <div key={i} className="rounded-xl border border-afya-border bg-afya-canvas/50 p-3">
                  <span className="text-afya-muted" aria-hidden="true">{m.icon}</span>
                  <div className="text-lg font-bold tabular-nums text-afya-charcoal mt-1">{m.value}</div>
                  <div className="text-[11px] text-afya-muted">{m.label}</div>
                  <div className="text-[9px] uppercase tracking-wide text-afya-muted/60 mt-0.5">{m.sub}</div>
                </div>
              ))}
            </div>

            {/* 7-day balance bar */}
            <div className="rounded-xl border border-afya-border bg-white p-4">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-afya-muted">{t("farm_demand_7d")}: <strong className="text-afya-charcoal tabular-nums">{wb.demand_7d_mm} mm</strong></span>
                <span className="text-afya-muted">{t("farm_supply_7d")}: <strong className="text-afya-charcoal tabular-nums">{wb.rain_7d_mm} mm</strong></span>
              </div>
              <div className="relative h-3 rounded-full bg-afya-canvas overflow-hidden" role="img"
                aria-label={`${t("farm_balance")}: ${wb.balance_7d_mm} mm`}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.min(100, (wb.rain_7d_mm / Math.max(1, wb.demand_7d_mm)) * 100)}%`,
                    background: wb.balance_7d_mm >= 0 ? "#006B3C" : "#E27832",
                  }}
                />
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-afya-muted">
                  {t("farm_balance")}:{" "}
                  <strong className={cn("tabular-nums", wb.balance_7d_mm >= 0 ? "text-afya-green" : "text-afya-orange")}>
                    {wb.balance_7d_mm >= 0 ? "+" : ""}{wb.balance_7d_mm} mm
                  </strong>
                </span>
                <span className="text-xs text-afya-muted">
                  {t("farm_depletion")}: <strong className="tabular-nums text-afya-charcoal">{wb.depletion_pct}%</strong>
                </span>
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
                <p className="text-sm text-afya-muted">{t("quality_suppressed")}</p>
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
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { v: `${adv.planting.rain_30d_mm}`, l: t("farm_rain_30d"), u: "mm" },
                  { v: `${adv.planting.required_mm}`, l: t("farm_required"), u: "mm" },
                  { v: `${adv.planting.dry_spell_days}`, l: t("farm_dry_spell"), u: lang === "sw" ? "siku" : "days" },
                ].map((s, i) => (
                  <div key={i} className="rounded-lg border border-afya-border bg-afya-canvas/50 px-2 py-2">
                    <div className="text-base font-bold tabular-nums text-afya-charcoal">{s.v}</div>
                    <div className="text-[9px] text-afya-muted">{s.u}</div>
                    <div className="text-[10px] text-afya-muted mt-0.5">{s.l}</div>
                  </div>
                ))}
              </div>
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
