"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { wbgtToRisk } from "@/lib/afya/constants";
import { fmtDate, fmtTime, fmtWindow } from "@/lib/afya/format";
import { tf } from "@/lib/afya/i18n";
import { lastReplayDay, REPLAY_FIRST_DAY, type HorizonSummary, type ReplayFrame } from "@/lib/afya/replay";
import { Card, CardTitle } from "@/components/ui/Card";
import { StateChip } from "@/components/ui/StateChip";
import { RiskChip } from "@/components/ui/RiskChip";
import ForecastChart from "@/components/charts/ForecastChart";
import StateTimeline from "@/components/charts/StateTimeline";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import {
  RotateCcw, ChevronsLeft, Play, Pause, ChevronsRight,
  Eye, EyeOff, AlertTriangle, Info, CheckCircle2,
} from "lucide-react";

// Replay runs on the station's recorded data, from the archive's first day to yesterday.
const DEFAULT_DATE = "2026-09-01";

const QUALITY_TEXT = { GOOD: "text-afya-green", DEGRADED: "text-afya-gold", POOR: "text-afya-red" } as const;
const HORIZON_LABEL = { "1h": "+1 h", "3h": "+3 h", "6h": "+6 h", "9h": "+9 h" } as const;

const noSubscription = () => () => {};

interface ReplayResult {
  date: string;
  steps: ReplayFrame[];
  summary: HorizonSummary[];
  // Set when the replay failed: the API's error code and message.
  error: { code?: string; message?: string } | null;
}

/** Historical Replay, shown as a tab on the Dashboard (/climate). */
export function ReplayContent() {
  const { t, lang } = useLanguage();
  const [date, setDate] = useState(DEFAULT_DATE);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [stepIdx, setStepIdx] = useState(2); // start at 08:00 EAT
  const [playing, setPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // Yesterday in Nairobi, known only in the browser.
  const lastDay = useSyncExternalStore(noSubscription, () => lastReplayDay(Date.now()), () => undefined);

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
          setResult({ date, steps: [], summary: [], error: { code: data.error, message: data.message } });
          return;
        }
        setResult({ date, steps: data.steps, summary: data.summary ?? [], error: null });
      })
      .catch(() => {
        if (active) setResult({ date, steps: [], summary: [], error: {} });
      });
    return () => {
      active = false;
    };
  }, [date]);

  const loading = result?.date !== date;
  const steps = loading ? [] : result.steps;
  const failure = loading ? null : result.error;
  const error = !failure
    ? null
    : failure.code === "invalid_date"
      ? tf(lang, "replay_invalid_date", { first: fmtDate(`${REPLAY_FIRST_DAY}T12:00:00Z`) })
      : failure.code === "no_station_data"
        ? tf(lang, "replay_no_data", { date: fmtDate(`${date}T12:00:00Z`) })
        : failure.message || t("error_generic");

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
  const simTimeEAT = currentStep ? fmtTime(currentStep.sim_time) : "--:00";
  const shown = currentStep?.available ? currentStep : null;

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
            {shown && (
              <div className="ml-auto flex items-center gap-3 flex-wrap">
                <StateChip stateId={shown.situation.state.state_id} size="md" />
                {shown.situation.best_time && (
                  <div className="rounded-xl bg-afya-gold/10 border border-afya-gold/40 px-3 py-1">
                    <span className="text-[10px] text-white/50 block">{t("best_window")}</span>
                    <span className="text-sm font-bold text-afya-gold">
                      {fmtWindow(shown.situation.best_time.recommended.start, shown.situation.best_time.recommended.end)}
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
              onChange={(e) => e.target.value && chooseDate(e.target.value)}
              min={REPLAY_FIRST_DAY}
              max={lastDay}
              className="rounded-lg bg-white/15 border border-white/20 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-afya-gold"
              aria-label={t("replay_date_label")}
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
              {steps.map((step, i) => (
                <button
                  key={i}
                  onClick={() => { setStepIdx(i); setPlaying(false); }}
                  aria-pressed={stepIdx === i}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
                    stepIdx === i
                      ? "bg-afya-gold text-afya-deep"
                      : "bg-white/15 text-white/70 hover:bg-white/25",
                    !step.available && "line-through opacity-50",
                  )}
                >
                  {fmtTime(step.sim_time)}
                </button>
              ))}
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

      {/* A step with no station data near its hour */}
      {currentStep && !shown && !loading && (
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-afya-gold shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
            <p className="text-sm text-afya-muted">
              {tf(lang, "replay_frame_unavailable", {
                time: simTimeEAT,
                observed: `${fmtDate(currentStep.observed_at)} ${fmtTime(currentStep.observed_at)}`,
              })}
            </p>
          </div>
        </Card>
      )}

      {/* Current step situation */}
      {shown && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left: current situation at sim time */}
          <div className="space-y-4">
            <Card>
              <CardTitle>{t("replay_current_sim")}</CardTitle>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-afya-muted">{t("environmental_state")}</span>
                  <StateChip stateId={shown.situation.state.state_id} size="md" />
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-afya-muted">{t("replay_measured_wbgt")}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-afya-charcoal">{shown.situation.current.wbgt_c.toFixed(1)}°C</span>
                    <RiskChip level={wbgtToRisk(shown.situation.current.wbgt_c)} size="sm" />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-afya-muted">{t("horizon_3h")}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-afya-charcoal">
                      {shown.situation.forecast[1]?.value.toFixed(1)}°C
                    </span>
                    <RiskChip level={shown.situation.risk.thermal} size="sm" />
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-afya-muted">{t("expected_peak")}</span>
                  <span className="font-bold text-afya-charcoal">
                    {shown.situation.expected_peak
                      ? `${fmtTime(shown.situation.expected_peak.time)} · ${shown.situation.expected_peak.wbgt_c.toFixed(1)}°C`
                      : "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-afya-muted">{t("data_quality")}</span>
                  <span className={cn("font-semibold", QUALITY_TEXT[shown.situation.quality.status])}>
                    {t(`quality_${shown.situation.quality.status.toLowerCase()}`)}
                  </span>
                </div>
              </div>
            </Card>

            {/* Best-Time at this sim step */}
            {shown.situation.best_time && (
              <Card>
                <CardTitle>{t("best_window")}</CardTitle>
                <div className="text-3xl font-bold text-afya-charcoal mb-2">
                  {fmtWindow(
                    shown.situation.best_time.recommended.start,
                    shown.situation.best_time.recommended.end,
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {shown.situation.best_time.recommended.reasons.slice(0, 3).map((r) => (
                    <span key={r} className="text-xs text-afya-green flex items-center gap-1">
                      <Info className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                      {t(r)}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* State history so far */}
            {shown.situation.state_history_24h.length > 0 && (
              <Card>
                <CardTitle>{t("state_timeline")}</CardTitle>
                <StateTimeline segments={shown.situation.state_history_24h} height={36} />
              </Card>
            )}
          </div>

          {/* Right: forecast, then what the station recorded */}
          <div className="space-y-4">
            <Card>
              <CardTitle>{t("replay_forecast_sim")}</CardTitle>
              <ForecastChart
                forecastSeries={shown.situation.forecast_series}
                height={200}
              />
            </Card>

            {revealed && (
              <Card>
                <CardTitle>{t("replay_check_title")}</CardTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-afya-muted text-left">
                        <th className="py-1.5 pr-3 font-semibold">{t("replay_col_ahead")}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t("replay_col_for")}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t("replay_col_forecast")}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t("replay_col_recorded")}</th>
                        <th className="py-1.5 font-semibold text-right">{t("replay_col_error")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.checks.map((c) => {
                        const inside = c.recorded !== null && c.recorded >= c.lower && c.recorded <= c.upper;
                        return (
                          <tr key={c.horizon} className="border-t border-afya-border">
                            <td className="py-2 pr-3 font-semibold text-afya-charcoal">{HORIZON_LABEL[c.horizon]}</td>
                            <td className="py-2 pr-3 text-afya-muted tabular-nums">{fmtTime(c.target)}</td>
                            <td className="py-2 pr-3 tabular-nums">
                              <span className="font-semibold text-afya-charcoal">{c.forecast.toFixed(1)}°C</span>
                              <span className="text-[11px] text-afya-muted ml-1">{c.lower.toFixed(1)}–{c.upper.toFixed(1)}</span>
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {c.recorded === null
                                ? <span className="text-afya-muted/70 italic">{t("replay_not_recorded")}</span>
                                : <span className="font-semibold text-afya-charcoal">{c.recorded.toFixed(1)}°C</span>}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {c.error === null ? "-" : (
                                <span className="inline-flex items-center gap-1 font-semibold text-afya-charcoal">
                                  {c.error > 0 ? "+" : ""}{c.error.toFixed(1)}
                                  {inside && <CheckCircle2 className="w-3.5 h-3.5 text-afya-green" strokeWidth={2} aria-hidden="true" />}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-afya-muted mt-2">{t("replay_band_note")}</p>
                {result && result.summary.some((s) => s.mae !== null) && (
                  <div className="mt-3 rounded-xl bg-afya-canvas border border-afya-border px-3 py-2.5">
                    <div className="text-[11px] font-semibold text-afya-muted mb-1.5">{t("replay_day_errors")}</div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {result.summary.map((s) => (
                        <div key={s.horizon}>
                          <div className="text-[10px] text-afya-muted">{HORIZON_LABEL[s.horizon]}</div>
                          <div className="text-sm font-bold text-afya-charcoal tabular-nums">
                            {s.mae === null ? "-" : `${s.mae.toFixed(1)}°C`}
                          </div>
                          <div className="text-[10px] text-afya-muted">n={s.n}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Recommendation against the fixed midday window, by the station's record */}
            {revealed && shown.recommended && shown.midday && (
              <Card>
                <CardTitle>{t("recommended_vs_actual")}</CardTitle>
                {shown.recommended.peak === null || shown.midday.peak === null ? (
                  <p className="text-sm text-afya-muted">{t("replay_window_unrecorded")}</p>
                ) : (() => {
                  const improvement = shown.midday.peak - shown.recommended.peak;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border-2 border-afya-green/30 bg-afya-green/5 px-4 py-3">
                          <div className="text-[10px] font-bold text-afya-green uppercase mb-1">
                            {t("afya_recommended")}
                          </div>
                          <div className="text-sm font-semibold text-afya-charcoal mb-1">
                            {fmtWindow(shown.recommended.start, shown.recommended.end)}
                          </div>
                          <div className="text-xl font-bold text-afya-charcoal">{shown.recommended.peak.toFixed(1)}°C</div>
                          <div className="text-xs text-afya-muted">{t("actual_exposure_in_window")}</div>
                        </div>
                        <div className="rounded-xl border border-afya-border px-4 py-3">
                          <div className="text-[10px] font-bold text-afya-muted uppercase mb-1">
                            {t("naive_window")}
                          </div>
                          <div className="text-sm font-semibold text-afya-charcoal mb-1">
                            {fmtWindow(shown.midday.start, shown.midday.end)}
                          </div>
                          <div className="text-xl font-bold text-afya-charcoal">{shown.midday.peak.toFixed(1)}°C</div>
                          <div className="text-xs text-afya-muted">{t("replay_midday_recorded")}</div>
                        </div>
                      </div>
                      <div className={cn(
                        "rounded-xl px-4 py-3 text-sm font-semibold",
                        improvement > 0.5 ? "bg-afya-green/10 text-afya-green" : "bg-afya-canvas text-afya-muted",
                      )}>
                        {improvement > 0.5
                          ? tf(lang, "replay_reduced", { diff: improvement.toFixed(1) })
                          : t("replay_marginal")}
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
                  <span>{stepIdx + 1} / {steps.length} {t("replay_steps")}</span>
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
