"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSituation } from "@/lib/contexts/situation";
import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import { fmtTime, fmtWindow } from "@/lib/afya/format";
import { StateChip } from "@/components/ui/StateChip";
import { RiskChip } from "@/components/ui/RiskChip";
import { QualityDot } from "@/components/ui/QualityDot";
import { SkeletonState, SkeletonCard } from "@/components/ui/Skeleton";
import ForecastChart from "@/components/charts/ForecastChart";
import StateTimeline from "@/components/charts/StateTimeline";
import MeasurementStrip from "@/components/ui/MeasurementStrip";
import { Card, CardTitle, CardMeta } from "@/components/ui/Card";
import AiPanel from "@/components/ai/AiPanel";
import {
  ChevronRight, Clock, AlertTriangle, TrendingUp, CheckCircle2, Printer,
} from "lucide-react";

// ─── Section header — quiet rhythm for the decision-first hierarchy ──────────
function ActHeader({
  titleKey, t,
}: {
  titleKey: string;
  t: (k: string) => string;
}) {
  return (
    <div className="pt-2">
      <div className="flex items-center gap-3">
        <span className="h-3.5 w-1 rounded-full bg-afya-green" aria-hidden="true" />
        <h2 className="text-[12px] font-bold uppercase tracking-[0.18em] text-afya-muted">
          {t(titleKey)}
        </h2>
        <div className="h-px flex-1 bg-afya-border/70" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function SituationPage() {
  const { situation, isLoading, error } = useSituation();
  const { t, lang } = useLanguage();
  const [showTechnical, setShowTechnical] = useState(false);

  useEffect(() => {
    document.title = `${t("nav_situation")} | AFYA MAZINGIRA`;
  }, [t]);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <SkeletonState />
        <SkeletonCard height="h-48" />
      </div>
    );
  }

  if (error || !situation) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Card>
          <div className="text-center py-8 space-y-3">
            <AlertTriangle className="w-10 h-10 text-afya-gold mx-auto" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-afya-charcoal font-semibold">{t("error_generic")}</p>
            <p className="text-sm text-afya-muted">{t("error_conduit")}</p>
          </div>
        </Card>
      </div>
    );
  }

  const { state, current, forecast, quality, risk, best_time, expected_peak, state_history_24h, forecast_series, contributors } = situation;
  const stateMeta = STATES[state.state_id];
  const stateName = lang === "sw" ? stateMeta.name_sw : stateMeta.name;

  const f1h = forecast.find((f) => f.horizon === "1h");
  const f3h = forecast.find((f) => f.horizon === "3h");
  const f6h = forecast.find((f) => f.horizon === "6h");
  const f9h = forecast.find((f) => f.horizon === "9h");

  const exposureTrend = f3h && f3h.value > current.wbgt_c + 0.3
    ? "rising"
    : f3h && f3h.value < current.wbgt_c - 0.3
    ? "falling"
    : "stable";

  const transition = state.transition_likelihood;

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* ━━━ SITUATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ActHeader titleKey="act_situation" t={t} />

      {/* ── HERO: Current Situation ─────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: `linear-gradient(135deg, #103D2C 0%, #0e2e22 100%)` }}
        role="region"
        aria-label={t("current_state")}
      >
        <div className="p-6 sm:p-8 text-white">
          {/* Ground + Regional Intelligence tier — JKUAT/Juja is the flagship
              ground-intelligence site (real Conduit station), distinct from
              the regional-only intelligence available elsewhere (see /map). */}
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-afya-gold/40 bg-afya-gold/10 px-2.5 py-1 text-[10px] font-bold tracking-wide text-afya-gold">
            <span className="w-1.5 h-1.5 rounded-full bg-afya-gold" aria-hidden="true" />
            {t("ground_regional_intelligence")}
          </div>

          {/* State chip + quality */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <StateChip stateId={state.state_id} size="md" />
            <QualityDot
              status={quality.status}
              freshnessMinutes={quality.freshness_minutes}
              compact
            />
            {situation.demo_mode && (
              <span className="text-[11px] text-white/50 italic">{t("demo_notice")}</span>
            )}
            {situation.data_source === "CONDUIT_ARCHIVE" && (
              <span className="text-[11px] text-white/50 italic">{t("archive_notice")}</span>
            )}
          </div>

          {/* State name — large */}
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-2">
            {stateName}
          </h1>

          {/* Trend statement */}
          <p className="text-white/70 text-base sm:text-lg mb-6">
            {exposureTrend === "rising" && t("exposure_rising")}
            {exposureTrend === "falling" && t("exposure_falling")}
            {exposureTrend === "stable" && t("exposure_stable")}
            {expected_peak && (
              <> · {t("expected_peak")}: <strong className="text-white">{fmtTime(expected_peak.time)}</strong></>
            )}
          </p>

          {/* Key metrics strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
            {/* Exposure */}
            <div className="rounded-xl bg-white/8 border border-white/10 p-3">
              <div className="text-[11px] text-white/50 mb-1">{t("thermal_exposure")}</div>
              <RiskChip level={risk.thermal} size="sm" />
              <div className="text-xs text-white/60 mt-1.5">{current.wbgt_c.toFixed(1)}°C WBGT</div>
            </div>
            {/* Expected peak */}
            <div className="rounded-xl bg-white/8 border border-white/10 p-3">
              <div className="text-[11px] text-white/50 mb-1">{t("expected_peak")}</div>
              <div className="text-xl font-bold text-white">
                {expected_peak ? fmtTime(expected_peak.time) : "—"}
              </div>
              {expected_peak && (
                <div className="text-xs text-white/60">{expected_peak.wbgt_c.toFixed(1)}°C WBGT</div>
              )}
            </div>
            {/* +3h forecast */}
            <div className="rounded-xl bg-white/8 border border-white/10 p-3">
              <div className="text-[11px] text-white/50 mb-1">{t("horizon_3h")}</div>
              <div className="text-xl font-bold text-white">
                {f3h ? `${f3h.value.toFixed(1)}°C` : "—"}
              </div>
              {f3h && (
                <div className="text-xs text-white/60">
                  {f3h.lower.toFixed(1)}–{f3h.upper.toFixed(1)}°C
                </div>
              )}
            </div>
            {/* Transition */}
            <div className="rounded-xl bg-white/8 border border-white/10 p-3">
              <div className="text-[11px] text-white/50 mb-1">{t("next_transition")}</div>
              {transition ? (
                <>
                  <div className="text-sm font-bold" style={{ color: STATES[transition.state_id].color }}>
                    {lang === "sw" ? STATES[transition.state_id].name_sw : STATES[transition.state_id].name}
                  </div>
                  <div className="text-xs text-white/60">
                    ~{Math.round(transition.probability * 100)}%
                  </div>
                </>
              ) : "—"}
            </div>
          </div>

          {/* Recommended action — omitted when quality is POOR; the
              standalone "Data quality notice" panel below already covers
              that case, so we don't show a second, less-detailed message. */}
          {quality.status !== "POOR" && (
            <div className="rounded-xl bg-white/10 border border-white/15 p-4 mb-6">
              <div className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                {t("recommended_action")}
              </div>
              <p className="text-white text-base font-medium leading-relaxed">
                {best_time
                  ? lang === "sw"
                    ? `Kwa shughuli za nje, muda bora zaidi ni ${fmtWindow(best_time.recommended.start, best_time.recommended.end)}.`
                    : `For a 60-minute outdoor activity, the best available window is ${fmtWindow(best_time.recommended.start, best_time.recommended.end)}.`
                  : lang === "sw"
                  ? "Hali ya data ni nzuri kwa shughuli nyingi za nje."
                  : "Current conditions are favourable for most outdoor activities."}
              </p>
              {best_time && (
                <div
                  className="mt-3 text-3xl sm:text-4xl font-bold"
                  style={{ color: "#F2B705" }}
                  aria-label={t("best_window")}
                >
                  {fmtWindow(best_time.recommended.start, best_time.recommended.end)}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Link
              href="/plan"
              className="inline-flex items-center gap-2 rounded-xl bg-afya-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-afya-green/90 transition-colors"
            >
              {t("plan_activity")}
            </Link>
            <Link
              href="/forecast"
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-5 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors"
            >
              {t("view_forecast")}
            </Link>
            <a
              href="#ai-section"
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-5 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors"
            >
              {t("why")}
            </a>
            <Link
              href="/briefing"
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-5 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors"
            >
              <Printer className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
              {t("briefing_title")}
            </Link>
          </div>
        </div>

        {/* Best-Time gold accent bar */}
        {best_time && (
          <div
            className="h-1"
            style={{ background: "linear-gradient(90deg, #F2B705 0%, #e0a800 100%)" }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Data-quality warning (part of the situation, not a footnote) */}
      {quality.status !== "GOOD" && (
        <div
          className={`rounded-xl border p-4 flex gap-3 ${quality.status === "DEGRADED" ? "border-afya-gold/40 bg-afya-gold/8" : "border-afya-red/40 bg-afya-red/8"}`}
          role="alert"
        >
          <AlertTriangle
            className={`w-5 h-5 shrink-0 mt-0.5 ${quality.status === "DEGRADED" ? "text-afya-gold" : "text-afya-red"}`}
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-afya-charcoal text-sm">{t("quality_warning_title")}</p>
            <p className="text-sm text-afya-muted mt-0.5">
              {quality.status === "DEGRADED" ? t("quality_degraded_message") : t("quality_poor_message")}
              {" "}
              <span className="font-medium">{t("last_reliable")} {fmtTime(quality.updated_at)}</span>
            </p>
          </div>
        </div>
      )}

      {/* ━━━ TRAJECTORY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ActHeader titleKey="act_trajectory" t={t} />

      {/* ── FORECAST CHART ──────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
          <div>
            <CardTitle className="mb-0">{t("next_6h")}</CardTitle>
            <CardMeta>WBGT-like · {t("measured")} + {t("predicted")} + {t("uncertainty")}</CardMeta>
          </div>
          {expected_peak && (
            <div className="flex items-center gap-1.5 text-xs text-afya-muted">
              <Clock className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
              {t("peak_marker")}: <strong>{fmtTime(expected_peak.time)} · {expected_peak.wbgt_c.toFixed(1)}°C</strong>
            </div>
          )}
        </div>
        <ForecastChart
          forecastSeries={forecast_series}
          stateHistory={state_history_24h}
          height={240}
        />
      </Card>

      {/* ── HORIZON CARD STRIP ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { f: f1h, key: "horizon_1h", model: "ExtraTrees" },
          { f: f3h, key: "horizon_3h", model: "CatBoost" },
          { f: f6h, key: "horizon_6h", model: "ExtraTrees" },
          { f: f9h, key: "horizon_9h", model: "CatBoost" },
        ].map(({ f, key, model }) => f ? (
          <Card key={key}>
            <div className="flex items-start justify-between mb-3">
              <span className="text-sm font-semibold text-afya-charcoal">{t(key)}</span>
              <span className="text-[10px] text-afya-muted/60 border border-afya-border rounded px-1.5 py-0.5">
                {model}
              </span>
            </div>
            <div className="text-3xl font-bold text-afya-charcoal mb-1">
              {f.value.toFixed(1)}°C
            </div>
            <div className="text-xs text-afya-muted mb-3">
              {t("uncertainty")}: {f.lower.toFixed(1)}–{f.upper.toFixed(1)}°C
            </div>
            {/* Uncertainty bar */}
            <div className="relative h-2 rounded-full bg-afya-canvas overflow-hidden" aria-hidden="true">
              <div
                className="absolute inset-y-0 rounded-full bg-afya-green/20"
                style={{ left: "10%", right: "10%" }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-afya-green border-2 border-white"
                style={{ left: "calc(50% - 5px)" }}
              />
            </div>
          </Card>
        ) : null)}
      </div>

      {/* ── STATE HISTORY TIMELINE ──────────────────────────────────────── */}
      <Card>
        <CardTitle>{t("state_timeline")}</CardTitle>
        <StateTimeline segments={state_history_24h} />
      </Card>

      {/* ━━━ MEANING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ActHeader titleKey="act_meaning" t={t} />

      {/* ── MODEL CONTRIBUTORS ──────────────────────────────────────────── */}
      {contributors.length > 0 && (
        <Card>
          <CardTitle>{t("contributor_title")}</CardTitle>
          <p className="text-xs text-afya-muted mb-4">{t("contributor_note")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {contributors.map((c, i) => {
              const colors: Record<string, string> = {
                temp_rising: "#E27832",
                temp_falling: "#247B78",
                high_radiation: "#F2B705",
                low_ventilation: "#3786B5",
                humidity_falling: "#6B8F71",
                peak_radiation: "#E27832",
              };
              const labels_en: Record<string, string> = {
                temp_rising: "Temperature rising",
                temp_falling: "Temperature falling",
                high_radiation: "High solar radiation",
                low_ventilation: "Weak ventilation (low wind speed)",
                humidity_falling: "Humidity falling",
                peak_radiation: "Peak radiation period",
              };
              const labels_sw: Record<string, string> = {
                temp_rising: "Joto linaongezeka",
                temp_falling: "Joto linapungua",
                high_radiation: "Mionzi mikali ya jua",
                low_ventilation: "Uingizaji hewa mdogo (upepo mdogo)",
                humidity_falling: "Unyevu unapungua",
                peak_radiation: "Kipindi cha mionzi ya juu",
              };
              return (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border border-afya-border bg-afya-canvas/50 px-3 py-2.5">
                  {c.direction === "increasing"
                    ? <TrendingUp className="w-4 h-4 shrink-0" style={{ color: colors[c.feature] ?? "#68756f" }} strokeWidth={2} aria-hidden="true" />
                    : <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: colors[c.feature] ?? "#68756f" }} strokeWidth={2} aria-hidden="true" />
                  }
                  <span className="text-sm text-afya-charcoal">
                    {lang === "sw" ? labels_sw[c.feature] ?? c.feature : labels_en[c.feature] ?? c.feature}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── WHY? AI PANEL ───────────────────────────────────────────────── */}
      <div id="ai-section">
        <AiPanel context="situation" />
      </div>

      {/* ━━━ TECHNICAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ActHeader titleKey="act_technical" t={t} />

      {/* ── TECHNICAL MEASUREMENTS (collapsible) ────────────────────────── */}
      <Card padding={false}>
        <button
          className="w-full flex items-center justify-between px-5 py-4 text-left"
          onClick={() => setShowTechnical((v) => !v)}
          aria-expanded={showTechnical}
          aria-controls="technical-details"
        >
          <span className="text-sm font-semibold text-afya-charcoal">{t("technical_measurements")}</span>
          <ChevronRight
            className={`w-4 h-4 text-afya-muted transition-transform ${showTechnical ? "rotate-90" : ""}`}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
        {showTechnical && (
          <div id="technical-details" className="px-5 pb-5 border-t border-afya-border pt-4">
            <MeasurementStrip obs={current} freshnessMinutes={quality.freshness_minutes} />
          </div>
        )}
      </Card>
    </div>
  );
}
