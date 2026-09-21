"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import { fmtTime, fmtWindow } from "@/lib/afya/format";
import { Card, CardTitle } from "@/components/ui/Card";
import { StateChip } from "@/components/ui/StateChip";
import { RiskChip } from "@/components/ui/RiskChip";
import ForecastChart from "@/components/charts/ForecastChart";
import StateTimeline from "@/components/charts/StateTimeline";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import type { ReplayStep } from "@/lib/afya/pipeline";
import {
  RotateCcw, ChevronsLeft, Play, Pause, ChevronsRight,
  Eye, EyeOff, AlertTriangle, Info,
} from "lucide-react";

// Replay runs on the recorded station archive, so only its days are offered.
const ARCHIVE_FIRST_DAY = "2025-06-01";
const ARCHIVE_LAST_DAY = "2026-09-08";
const DEFAULT_DATE = "2026-09-01";

// Historical Replay now lives as a tab on the consolidated Dashboard
// (/climate) rather than its own page, this redirects any existing link
// or bookmark straight there instead of leaving a dangling duplicate page.
export default function ReplayPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/climate?tab=replay");
  }, [router]);
  return null;
}

// Exported as a plain component (not just a page default export) so the
// Dashboard's "Replay" tab can render it inline, merging Historical Replay
// into the consolidated Dashboard without duplicating this logic.
export function ReplayContent() {
  const { t, lang } = useLanguage();
  const [date, setDate] = useState(DEFAULT_DATE);
  const [result, setResult] = useState<{ date: string; steps: ReplayStep[]; message: string | null } | null>(null);
  const [stepIdx, setStepIdx] = useState(2); // start at 08:00 EAT
  const [playing, setPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          setResult({ date, steps: [], message: data.message ?? "" });
          return;
        }
        // What happened afterwards is the station's own reading at each later
        // step of the same day, so the reveal compares the forecast with data.
        const all: ReplayStep[] = data.steps;
        const steps = all.map((step, i) => ({
          ...step,
          actual_after: all.slice(i + 1).map((later) => ({
            time: later.situation.current.time,
            wbgt: later.situation.current.wbgt_c,
          })),
        }));
        setResult({ date, steps, message: null });
      })
      .catch(() => {
        if (active) setResult({ date, steps: [], message: "" });
      });
    return () => {
      active = false;
    };
  }, [date]);

  const loading = result?.date !== date;
  const steps = loading ? [] : result.steps;
  const error = loading || result.message === null ? null : result.message || t("error_generic");

  function chooseDate(next: string) {
    setDate(next);
    setStepIdx(2);
    setRevealed(false);
    setPlaying(false);
  }

  // Auto-advance when playing
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStepIdx((i) => {
        if (i >= steps.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [playing, steps.length]);


  const currentStep = steps[stepIdx] ?? null;
  const simTimeEAT = currentStep
    ? new Date(new Date(currentStep.sim_time).getTime() + 3 * 3600 * 1000).getUTCHours().toString().padStart(2, "0") + ":00"
    : "--:00";

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("replay_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("replay_subtitle")}</p>
      </div>

      {/* Replay banner */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, #103D2C 0%, #0a2a1e 100%)" }}
        role="region"
        aria-label={t("replay_banner")}
      >
        <div className="px-6 py-5 text-white">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="rounded-full bg-afya-gold/15 border border-afya-gold/40 px-3 py-1 text-xs font-bold text-afya-gold">
              {t("replay_banner")}
            </span>
            <span className="text-sm text-white/60 ml-auto">{t("replay_hidden")}</span>
          </div>

          {/* Simulated clock */}
          <div className="flex flex-wrap items-baseline gap-4 mb-5">
            <div className="text-5xl font-bold text-white tabular-nums" aria-live="polite">
              {simTimeEAT}
            </div>
            <div className="text-white/60 text-sm">
              {date} · EAT
            </div>
            {currentStep && (
              <div className="ml-auto flex items-center gap-3 flex-wrap">
                <StateChip stateId={currentStep.situation.state.state_id} size="md" />
                {currentStep.situation.best_time && (
                  <div className="rounded-xl bg-afya-gold/10 border border-afya-gold/40 px-3 py-1">
                    <span className="text-[10px] text-white/50 block">{t("best_window")}</span>
                    <span className="text-sm font-bold text-afya-gold">
                      {fmtWindow(currentStep.situation.best_time.recommended.start, currentStep.situation.best_time.recommended.end)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => chooseDate(e.target.value)}
              min={ARCHIVE_FIRST_DAY}
              max={ARCHIVE_LAST_DAY}
              className="rounded-lg bg-white/15 border border-white/20 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-afya-gold"
              aria-label="Replay date"
            />
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setStepIdx(0); setPlaying(false); }}
                className="p-2.5 rounded-lg bg-white/15 text-white hover:bg-white/25 transition-colors"
                aria-label={t("restart")}
                title={t("restart")}
              >
                <RotateCcw className="w-4 h-4" strokeWidth={2} />
              </button>
              <button
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                disabled={stepIdx === 0}
                className="p-2.5 rounded-lg bg-white/15 text-white hover:bg-white/25 disabled:opacity-30 transition-colors"
                aria-label={t("prev_step")}
              >
                <ChevronsLeft className="w-4 h-4" strokeWidth={2} />
              </button>
              <button
                onClick={() => setPlaying((p) => !p)}
                className="p-2.5 rounded-lg bg-white/15 text-white hover:bg-white/25 transition-colors"
                aria-label={playing ? t("pause") : t("play")}
                aria-pressed={playing}
              >
                {playing ? <Pause className="w-4 h-4" strokeWidth={2} /> : <Play className="w-4 h-4" strokeWidth={2} />}
              </button>
              <button
                onClick={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}
                disabled={stepIdx >= steps.length - 1}
                className="p-2.5 rounded-lg bg-white/15 text-white hover:bg-white/25 disabled:opacity-30 transition-colors"
                aria-label={t("next_step")}
              >
                <ChevronsRight className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
            {/* Time step selector */}
            <div className="flex gap-1 flex-wrap">
              {steps.map((step, i) => {
                const hr = new Date(new Date(step.sim_time).getTime() + 3 * 3600 * 1000).getUTCHours();
                return (
                  <button
                    key={i}
                    onClick={() => { setStepIdx(i); setPlaying(false); }}
                    aria-pressed={stepIdx === i}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
                      stepIdx === i
                        ? "bg-afya-gold text-afya-deep"
                        : "bg-white/15 text-white/70 hover:bg-white/25",
                    )}
                  >
                    {String(hr).padStart(2, "0")}:00
                  </button>
                );
              })}
            </div>

            {/* Reveal button */}
            {!revealed ? (
              <button
                onClick={() => setRevealed(true)}
                className="ml-auto inline-flex items-center gap-2 rounded-xl bg-afya-gold px-4 py-2.5 text-sm font-bold text-afya-deep hover:bg-afya-gold/90 transition-colors"
              >
                <Eye className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                {t("reveal_actual")}
              </button>
            ) : (
              <button
                onClick={() => setRevealed(false)}
                className="ml-auto inline-flex items-center gap-2 rounded-xl border border-white/30 px-4 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/10 transition-colors"
              >
                <EyeOff className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                {t("replay_hidden")}
              </button>
            )}
          </div>

          {/* Gold accent bar */}
          <div className="h-1 mt-5 rounded-full" style={{ background: "#F2B705" }} aria-hidden="true" />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-afya-muted text-sm" aria-live="polite">
            <span className="inline-block w-4 h-4 rounded-full border-2 border-afya-green border-t-transparent animate-spin" />
            {t("loading")}
          </div>
          <SkeletonCard height="h-48" />
        </div>
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

      {/* Current step situation */}
      {currentStep && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left: current situation at sim time */}
          <div className="space-y-4">
            <Card>
              <CardTitle>
                {lang === "sw" ? "Hali ya Sasa (wakati ulioigizwa)" : "Current Situation (simulated time)"}
              </CardTitle>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-afya-muted">{t("environmental_state")}</span>
                  <StateChip stateId={currentStep.situation.state.state_id} size="md" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-afya-muted">{t("thermal_exposure")}</span>
                  <RiskChip level={currentStep.situation.risk.thermal} size="md" />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-afya-muted">{t("horizon_3h")}</span>
                  <span className="font-bold text-afya-charcoal">
                    {currentStep.situation.forecast[1]?.value.toFixed(1)}°C
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-afya-muted">{t("expected_peak")}</span>
                  <span className="font-bold text-afya-charcoal">
                    {currentStep.situation.expected_peak
                      ? `${fmtTime(currentStep.situation.expected_peak.time)} · ${currentStep.situation.expected_peak.wbgt_c.toFixed(1)}°C`
                      : "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-afya-muted">{t("data_quality")}</span>
                  <span className="font-semibold text-afya-green">{currentStep.situation.quality.status}</span>
                </div>
              </div>
            </Card>

            {/* Best-Time at this sim step */}
            {currentStep.situation.best_time && (
              <Card>
                <CardTitle>{t("best_window")}</CardTitle>
                <div className="text-3xl font-bold text-afya-charcoal mb-2">
                  {fmtWindow(
                    currentStep.situation.best_time.recommended.start,
                    currentStep.situation.best_time.recommended.end,
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {currentStep.situation.best_time.recommended.reasons.slice(0, 3).map((r) => (
                    <span key={r} className="text-xs text-afya-green flex items-center gap-1">
                      <Info className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                      {t(r)}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* State history so far */}
            {currentStep.situation.state_history_24h.length > 0 && (
              <Card>
                <CardTitle>{t("state_timeline")}</CardTitle>
                <StateTimeline segments={currentStep.situation.state_history_24h} height={36} />
              </Card>
            )}
          </div>

          {/* Right: forecast vs actual */}
          <div className="space-y-4">
            <Card>
              <CardTitle>
                {lang === "sw" ? "Utabiri (kutoka wakati ulioigizwa)" : "Forecast (from simulated time)"}
              </CardTitle>
              <ForecastChart
                forecastSeries={currentStep.situation.forecast_series}
                height={200}
              />
            </Card>

            {/* Comparison: recommendation vs actual */}
            {revealed && steps.length > stepIdx + 1 && (
              <Card>
                <CardTitle>{t("recommended_vs_actual")}</CardTitle>
                {(() => {
                  // Compare recommendation vs naive midday window using later steps
                  const laterSteps = steps.slice(stepIdx + 1);
                  if (!laterSteps.length || !currentStep.situation.best_time) {
                    return <p className="text-sm text-afya-muted">{lang === "sw" ? "Data haitoshi" : "Insufficient data to compare"}</p>;
                  }

                  // Actual peak in recommendation window
                  const recStart = new Date(currentStep.situation.best_time.recommended.start).getTime();
                  const recEnd = new Date(currentStep.situation.best_time.recommended.end).getTime();

                  // Find actual exposure in the recommendation window from the last step's forecast
                  const lastStep = steps[steps.length - 1];
                  const allPoints = lastStep.situation.forecast_series;
                  const recPoints = allPoints.filter((p) => {
                    const t = new Date(p.time).getTime();
                    return t >= recStart && t < recEnd;
                  });
                  const middayPoints = allPoints.filter((p) => {
                    const t = new Date(p.time).getTime();
                    const eat = new Date(t + 3 * 3600 * 1000);
                    const hr = eat.getUTCHours();
                    return hr >= 12 && hr < 14;
                  });

                  const recPeak = recPoints.length ? Math.max(...recPoints.map((p) => p.value)) : null;
                  const naivePeak = middayPoints.length ? Math.max(...middayPoints.map((p) => p.value)) : null;

                  if (!recPeak || !naivePeak) return (
                    <p className="text-sm text-afya-muted">{lang === "sw" ? "Data haitoshi" : "Insufficient data"}</p>
                  );

                  const improvement = naivePeak - recPeak;

                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border-2 border-afya-green/30 bg-afya-green/5 px-4 py-3">
                          <div className="text-[10px] font-bold text-afya-green uppercase mb-1">
                            {t("afya_recommended")}
                          </div>
                          <div className="text-sm font-semibold text-afya-charcoal mb-1">
                            {fmtWindow(recStart.toString(), recEnd.toString())}
                          </div>
                          <div className="text-xl font-bold text-afya-charcoal">{recPeak.toFixed(1)}°C</div>
                          <div className="text-xs text-afya-muted">{t("actual_exposure_in_window")}</div>
                        </div>
                        <div className="rounded-xl border border-afya-border px-4 py-3">
                          <div className="text-[10px] font-bold text-afya-muted uppercase mb-1">
                            {t("naive_window")}
                          </div>
                          <div className="text-sm font-semibold text-afya-charcoal mb-1">12:00–14:00</div>
                          <div className="text-xl font-bold text-afya-charcoal">{naivePeak.toFixed(1)}°C</div>
                          <div className="text-xs text-afya-muted">
                            {lang === "sw" ? "Kupatwa halisi dirisha la mchana" : "Actual exposure, midday window"}
                          </div>
                        </div>
                      </div>
                      <div className={cn(
                        "rounded-xl px-4 py-3 text-sm font-semibold",
                        improvement > 0.5 ? "bg-afya-green/10 text-afya-green" : "bg-afya-canvas text-afya-muted",
                      )}>
                        {improvement > 0.5
                          ? lang === "sw"
                            ? `AFYA MAZINGIRA ilipunguza kupatwa na joto kwa ${improvement.toFixed(1)}°C ikilinganishwa na dirisha la kawaida.`
                            : `AFYA MAZINGIRA reduced peak thermal exposure by ${improvement.toFixed(1)}°C vs the fixed midday window.`
                          : lang === "sw"
                            ? "Tofauti ndogo, hali ilikuwa imara siku hii."
                            : "Marginal difference, conditions were relatively stable that day."
                        }
                      </div>
                    </div>
                  );
                })()}
              </Card>
            )}

            {/* Progress indicator */}
            <Card>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-afya-muted">
                  <span>{t("replay_simulated_time")}: {simTimeEAT}</span>
                  <span>{stepIdx + 1} / {steps.length} {lang === "sw" ? "hatua" : "steps"}</span>
                </div>
                {/* Progress bar */}
                <div className="h-2 rounded-full bg-afya-canvas overflow-hidden">
                  <div
                    className="h-full bg-afya-gold rounded-full transition-all duration-300"
                    style={{ width: `${((stepIdx + 1) / Math.max(steps.length, 1)) * 100}%` }}
                    role="progressbar"
                    aria-valuenow={stepIdx + 1}
                    aria-valuemin={0}
                    aria-valuemax={steps.length}
                  />
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
