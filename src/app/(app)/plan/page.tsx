"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { useAuth } from "@/lib/contexts/auth";
import { ACTIVITY_PROFILES, RISK_META } from "@/lib/afya/constants";
import { usePreferredActivity } from "@/lib/contexts/situation";
import { fmtDate, fmtTime, fmtWindow } from "@/lib/afya/format";
import { tf } from "@/lib/afya/i18n";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { RiskChip } from "@/components/ui/RiskChip";
import {
  CheckCircle2, Save, Trash2, Edit3, Copy, RefreshCw,
  ChevronRight, AlertTriangle, Clock, Zap, Info, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BestTimeResult, QualityStatus } from "@/lib/afya/types";
import type { SavedResult } from "@/lib/afya/activity-plan";

const DURATIONS = [30, 60, 90, 120, 180];
// From this hour little daylight is left, so the form starts on tomorrow.
const LATE_HOUR = 17;
const EAT_OFFSET_MS = 3 * 3600 * 1000;

interface SavedPlan {
  id: number;
  name: string;
  activity_type: string;
  activity_label?: string;
  duration_minutes: number;
  available_start: string;
  available_end: string;
  last_result?: SavedResult | null;
  updated_at: string;
}

// The request a shown result answers, so a save always stores the range it was found for.
interface PlanRequest {
  activity: string;
  duration: number;
  start: string;
  end: string;
}

interface ApiError {
  error?: string;
  message?: string;
  details?: Record<string, string>;
}

// Helper: build an available-time ISO string in EAT, optionally for a future day
function todayAt(hourEAT: number, minuteEAT = 0, dayOffset = 0): string {
  const now = new Date();
  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  eat.setUTCDate(eat.getUTCDate() + dayOffset);
  eat.setUTCHours(hourEAT, minuteEAT, 0, 0);
  return new Date(eat.getTime() - EAT_OFFSET_MS).toISOString();
}

const eatHour = (iso: string) => new Date(Date.parse(iso) + EAT_OFFSET_MS).getUTCHours();
const eatDay = (ms: number) => Math.floor((ms + EAT_OFFSET_MS) / 86400_000);

function subscribeMinute(onChange: () => void) {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
}

/** The hour on the EAT clock, or null before the page runs in the browser. */
function useEatHour(): number | null {
  return useSyncExternalStore(subscribeMinute, () => eatHour(new Date().toISOString()), () => null);
}

export default function PlanPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const nowHour = useEatHour();

  // Form state. Day and start hour follow the clock until they are chosen;
  // the activity starts from the default saved on the Profile page.
  const preferred = usePreferredActivity();
  const [pickedActivity, setActivity] = useState<string | null>(null);
  const activity = pickedActivity
    ?? (preferred && ACTIVITY_PROFILES.some((p) => p.key === preferred) ? preferred : "outdoor_work");
  const [duration, setDuration] = useState(90);
  const [chosenStart, setChosenStart] = useState<number | null>(null);
  const [endHour, setEndHour] = useState(18);
  const [chosenDay, setChosenDay] = useState<number | null>(null); // 0 = today, 1 = tomorrow
  const [planName, setPlanName] = useState("");

  const dayOffset = chosenDay ?? (nowHour !== null && nowHour >= LATE_HOUR ? 1 : 0);
  const startHour = chosenStart ?? (dayOffset === 0 && nowHour !== null ? Math.min(Math.max(8, nowHour), LATE_HOUR) : 8);

  // Result state
  const [result, setResult] = useState<SavedResult | null>(null);
  const [resultFor, setResultFor] = useState<PlanRequest | null>(null);
  const [stationQuality, setStationQuality] = useState<QualityStatus | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Saved plans
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<SavedPlan | null>(null);
  const [rerunning, setRerunning] = useState<number | null>(null);

  const profileOf = (key: string) => ACTIVITY_PROFILES.find((p) => p.key === key) ?? ACTIVITY_PROFILES[0];
  const labelOf = (key: string) => (lang === "sw" ? profileOf(key).label_sw : profileOf(key).label_en);
  const bandLabel = (level: keyof typeof RISK_META) => (lang === "sw" ? RISK_META[level].sw : RISK_META[level].en);

  useEffect(() => {
    document.title = `${t("nav_plan")} | AFYA MAZINGIRA`;
    if (user) loadPlans();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadPlans() {
    setPlansLoading(true);
    try {
      const res = await fetch("/api/plans", { credentials: "include" });
      if (res.ok) setPlans(await res.json());
    } finally {
      setPlansLoading(false);
    }
  }

  // A shown result belongs to the form it was found for; changing the form clears it.
  function changed<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setResult(null);
      setResultFor(null);
      setEvalError(null);
    };
  }

  function errorText(data: ApiError): string {
    if (data.error === "quality_poor") return t("quality_poor_message");
    const key = `plan_error_${data.error}`;
    if (data.error && t(key) !== key) {
      const times = Object.fromEntries(Object.entries(data.details ?? {}).map(([k, v]) => [k, fmtTime(v)]));
      return tf(lang, key, times);
    }
    return data.message ?? t("error_generic");
  }

  async function evaluate() {
    setEvaluating(true);
    setResult(null);
    setResultFor(null);
    setEvalError(null);
    const request: PlanRequest = {
      activity,
      duration,
      start: todayAt(startHour, 0, dayOffset),
      end: todayAt(endHour, 0, dayOffset),
    };
    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity: request.activity,
          duration_minutes: request.duration,
          window_start: request.start,
          window_end: request.end,
        }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setEvalError(errorText(data));
      } else {
        setResult(data.result);
        setResultFor(request);
        setStationQuality(data.situation?.quality?.status ?? null);
      }
    } catch {
      setEvalError(t("error_generic"));
    } finally {
      setEvaluating(false);
    }
  }

  async function savePlan() {
    if (!user || !result || !resultFor) return;
    setSavingPlan(true);
    setSaveError(null);
    try {
      const res = await fetch(editingPlan ? `/api/plans/${editingPlan.id}` : "/api/plans", {
        method: editingPlan ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: planName.trim() || `${labelOf(resultFor.activity)} · ${resultFor.duration} ${t("minutes")}`,
          activity_type: resultFor.activity,
          activity_label: labelOf(resultFor.activity),
          duration_minutes: resultFor.duration,
          available_start: resultFor.start,
          available_end: resultFor.end,
          last_result: result,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        setSaveError(t("plan_save_failed"));
        return;
      }
      setSaveOk(editingPlan ? t("plan_updated") : t("plan_saved"));
      setTimeout(() => setSaveOk(null), 3000);
      setEditingPlan(null);
      loadPlans();
    } catch {
      setSaveError(t("plan_save_failed"));
    } finally {
      setSavingPlan(false);
    }
  }

  async function deletePlan(id: number) {
    await fetch(`/api/plans/${id}`, { method: "DELETE", credentials: "include" });
    if (editingPlan?.id === id) setEditingPlan(null);
    loadPlans();
  }

  async function duplicatePlan(id: number) {
    await fetch(`/api/plans/${id}/duplicate`, { method: "POST", credentials: "include" });
    loadPlans();
  }

  // Puts a saved plan's activity, length and hours into the form.
  function showPlanInForm(plan: SavedPlan, shown: SavedResult | null) {
    if (ACTIVITY_PROFILES.some((p) => p.key === plan.activity_type)) setActivity(plan.activity_type);
    setDuration(plan.duration_minutes);
    setChosenStart(eatHour(plan.available_start));
    setEndHour(eatHour(plan.available_end));
    setChosenDay(Math.min(1, Math.max(0, eatDay(Date.parse(plan.available_start)) - eatDay(Date.now()))));
    setPlanName(plan.name);
    setResult(shown);
    setResultFor(shown ? {
      activity: plan.activity_type,
      duration: plan.duration_minutes,
      start: plan.available_start,
      end: plan.available_end,
    } : null);
    setStationQuality(null);
    setEvalError(null);
    setSaveError(null);
  }

  async function rerunPlan(plan: SavedPlan) {
    setRerunning(plan.id);
    setEvalError(null);
    try {
      const res = await fetch(`/api/plans/${plan.id}/rerun`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok && data.result) {
        setEditingPlan(null);
        showPlanInForm(plan, data.result);
        setStationQuality(data.situation?.quality?.status ?? null);
      } else {
        setEvalError(`${plan.name}: ${errorText(data)}`);
      }
    } catch {
      setEvalError(t("error_generic"));
    } finally {
      setRerunning(null);
      loadPlans();
    }
  }

  function loadPlanIntoEditor(plan: SavedPlan) {
    setEditingPlan(plan);
    showPlanInForm(plan, plan.last_result?.recommended ? plan.last_result : null);
  }

  const coverageText = (r: SavedResult) => {
    if (!r.coverage) return null;
    const end = r.coverage.forecast_to;
    if (r.source === "regional") {
      return tf(lang, "plan_coverage_regional", { points: r.coverage.points, end: `${fmtDate(end)} ${fmtTime(end)}` });
    }
    return tf(lang, "plan_coverage_station", { points: r.coverage.points, step: r.coverage.step_minutes, end: fmtTime(end) });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("plan_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("plan_subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* LEFT: Form */}
        <div className="lg:col-span-2 space-y-4">
          {editingPlan && (
            <div className="rounded-xl border border-afya-green/40 bg-afya-green/5 px-4 py-3 flex items-start gap-3" role="status">
              <Edit3 className="w-4 h-4 text-afya-green shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
              <p className="flex-1 text-sm text-afya-charcoal">{tf(lang, "plan_editing", { name: editingPlan.name })}</p>
              <button
                onClick={() => setEditingPlan(null)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-afya-muted hover:text-afya-charcoal"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                {t("cancel_edit")}
              </button>
            </div>
          )}

          <Card>
            <CardTitle>{t("what_planning")}</CardTitle>
            <div className="grid grid-cols-2 gap-2">
              {ACTIVITY_PROFILES.map((p) => (
                <button
                  key={p.key}
                  onClick={() => changed(setActivity)(p.key)}
                  aria-pressed={activity === p.key}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium text-left transition-all",
                    activity === p.key
                      ? "border-afya-green bg-afya-green/8 text-afya-green"
                      : "border-afya-border text-afya-charcoal hover:border-afya-green/50",
                  )}
                >
                  {lang === "sw" ? p.label_sw : p.label_en}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle>{t("how_long")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => changed(setDuration)(d)}
                  aria-pressed={duration === d}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
                    duration === d
                      ? "border-afya-green bg-afya-green text-white"
                      : "border-afya-border text-afya-charcoal hover:border-afya-green/50",
                  )}
                >
                  {d} {t("minutes")}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle>{t("when_available")}</CardTitle>
            <div className="flex gap-2 mb-3">
              {[0, 1].map((offset) => (
                <button
                  key={offset}
                  onClick={() => changed(setChosenDay)(offset)}
                  aria-pressed={dayOffset === offset}
                  className={cn(
                    "flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition-all",
                    dayOffset === offset
                      ? "border-afya-green bg-afya-green text-white"
                      : "border-afya-border text-afya-charcoal hover:border-afya-green/50",
                  )}
                >
                  {offset === 0 ? t("plan_day_today") : t("plan_day_tomorrow")}
                </button>
              ))}
            </div>
            {dayOffset === 1 && (
              <p className="text-xs text-afya-muted mb-3">{t("plan_day_tomorrow_note")}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-afya-muted block mb-1.5">{t("start_time")}</label>
                <select
                  value={startHour}
                  onChange={(e) => changed(setChosenStart)(Number(e.target.value))}
                  className="w-full rounded-lg border border-afya-border bg-white px-3 py-2 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
                  aria-label={t("start_time")}
                >
                  {Array.from({ length: 18 }, (_, i) => i + 5).map((h) => (
                    <option key={h} value={h} disabled={dayOffset === 0 && nowHour !== null && h < nowHour}>
                      {`${String(h).padStart(2, "0")}:00`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-afya-muted block mb-1.5">{t("end_time")}</label>
                <select
                  value={endHour}
                  onChange={(e) => changed(setEndHour)(Number(e.target.value))}
                  className="w-full rounded-lg border border-afya-border bg-white px-3 py-2 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
                  aria-label={t("end_time")}
                >
                  {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
                    <option key={h} value={h} disabled={h <= startHour}>{`${String(h).padStart(2, "0")}:00`}</option>
                  ))}
                </select>
              </div>
            </div>
            {user && (
              <div className="mt-3">
                <label className="text-xs text-afya-muted block mb-1.5">{t("plan_name_label")}</label>
                <input
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder={t("plan_name_placeholder")}
                  className="w-full rounded-lg border border-afya-border bg-white px-3 py-2 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green placeholder:text-afya-muted/50"
                />
              </div>
            )}
          </Card>

          <button
            onClick={evaluate}
            disabled={evaluating}
            className="w-full rounded-xl bg-afya-green px-6 py-3.5 text-sm font-bold text-white hover:bg-afya-green/90 disabled:opacity-50 transition-colors"
          >
            {evaluating
              ? <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />
                  {t("running_evaluation")}
                </span>
              : t("find_best_time")
            }
          </button>

          {evalError && (
            <div className="rounded-xl border border-afya-red/30 bg-afya-red/8 p-4 flex gap-3" role="alert">
              <AlertTriangle className="w-5 h-5 text-afya-red shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <p className="text-sm text-afya-charcoal">{evalError}</p>
            </div>
          )}
        </div>

        {/* RIGHT: Results */}
        <div className="lg:col-span-3 space-y-4">

          {/* Evaluating skeleton */}
          {evaluating && (
            <Card>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-afya-muted text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.8} aria-hidden="true" />
                  <span>{t("running_evaluation")}</span>
                </div>
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-8 w-2/3 rounded-lg" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
            </Card>
          )}

          {/* Result */}
          {!evaluating && result && (
            <>
              {/* Regional-model notice: the station's own forecast could not
                  answer this window, so a coarser forecast with no station
                  quality check did. */}
              {result.source === "regional" && (
                <div className="rounded-xl border border-afya-gold/40 bg-afya-gold/8 px-4 py-3 flex gap-2" role="status">
                  <AlertTriangle className="w-4 h-4 text-afya-gold shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
                  <p className="text-sm text-afya-charcoal">{t("plan_regional_notice")}</p>
                </div>
              )}

              {result.searched_from && (
                <div className="rounded-xl border border-afya-border bg-afya-canvas px-4 py-3 flex gap-2" role="status">
                  <Info className="w-4 h-4 text-afya-muted shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
                  <p className="text-sm text-afya-charcoal">{tf(lang, "plan_searched_from", { time: fmtTime(result.searched_from) })}</p>
                </div>
              )}

              {/* Best window hero */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: "linear-gradient(135deg, #006B3C 0%, #054f2d 100%)" }}
              >
                <div className="p-6 sm:p-7 text-white">
                  <div className="text-xs font-bold text-white/60 uppercase tracking-widest mb-3">
                    {t("best_window_result")}
                  </div>
                  <div
                    className="text-4xl sm:text-5xl font-bold mb-1"
                    aria-label={t("best_window")}
                  >
                    {fmtWindow(result.recommended.start, result.recommended.end)}
                  </div>
                  <div className="text-white/60 text-sm mb-4">
                    {labelOf(result.activity)} · {result.duration_minutes} {t("minutes")} · {fmtDate(result.recommended.start)}
                  </div>

                  {result.recommended.risk && result.recommended.peak_wbgt_c !== undefined && (
                    <div className="flex flex-wrap items-center gap-2 mb-5">
                      <RiskChip level={result.recommended.risk} size="sm" onDark />
                      <span className="text-sm text-white/85">
                        {tf(lang, "plan_window_peak", {
                          wbgt: result.recommended.peak_wbgt_c.toFixed(1),
                          band: bandLabel(result.recommended.risk),
                        })}
                      </span>
                    </div>
                  )}

                  {/* Why */}
                  {result.recommended.reasons.length > 0 && (
                    <div className="space-y-1.5 mb-5">
                      {result.recommended.reasons.map((r) => (
                        <div key={r} className="flex items-center gap-2 text-sm text-white/85">
                          <CheckCircle2
                            className="w-4 h-4 shrink-0"
                            strokeWidth={2}
                            aria-hidden="true"
                            style={{ color: "#F2B705" }}
                          />
                          {t(r)}
                        </div>
                      ))}
                    </div>
                  )}

                  {result.alternative && (
                    <div className="rounded-xl bg-white/10 border border-white/15 px-4 py-3">
                      <div className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1">
                        {t("alternative_window")}
                      </div>
                      <div className="text-xl font-bold text-white/85">
                        {fmtWindow(result.alternative.start, result.alternative.end)}
                      </div>
                    </div>
                  )}
                </div>
                <div className="h-1" style={{ background: "#F2B705" }} aria-hidden="true" />
              </div>

              {coverageText(result) && (
                <p className="text-xs text-afya-muted flex items-start gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0 mt-px" strokeWidth={1.8} aria-hidden="true" />
                  {coverageText(result)}
                </p>
              )}

              {/* Actions */}
              {user && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={savePlan}
                    disabled={savingPlan || !resultFor}
                    className="inline-flex items-center gap-2 rounded-xl bg-afya-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-afya-deep/90 disabled:opacity-50 transition-colors"
                  >
                    {saveOk
                      ? <CheckCircle2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                      : <Save className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
                    }
                    {saveOk ?? (editingPlan ? t("update_plan") : t("save_plan"))}
                  </button>
                  <a
                    href="#ai-section-plan"
                    className="inline-flex items-center gap-2 rounded-xl border border-afya-border px-4 py-2.5 text-sm font-semibold text-afya-charcoal hover:bg-afya-canvas transition-colors"
                  >
                    {t("why_this_time")}
                  </a>
                  {saveError && <span className="text-sm text-afya-red" role="alert">{saveError}</span>}
                </div>
              )}
              {!user && (
                <div className="rounded-xl border border-afya-gold/40 bg-afya-gold/8 p-4 space-y-2">
                  <p className="text-sm font-semibold text-afya-charcoal">{t("protected_route")}</p>
                  <div className="flex gap-3">
                    <a href="/sign-in" className="text-sm font-semibold text-afya-green hover:underline">{t("sign_in")}</a>
                    <a href="/sign-up" className="text-sm font-semibold text-afya-green hover:underline">{t("sign_up")}</a>
                  </div>
                </div>
              )}

              {/* Quality note: station forecasts only */}
              {result.source === "station" && stationQuality === "DEGRADED" && (
                <div className="rounded-xl border border-afya-gold/40 bg-afya-gold/8 px-4 py-3 flex gap-2" role="alert">
                  <AlertTriangle className="w-4 h-4 text-afya-gold shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
                  <p className="text-sm text-afya-charcoal">{t("quality_degraded_message")}</p>
                </div>
              )}
            </>
          )}

          {/* Empty state */}
          {!evaluating && !result && !evalError && (
            <Card>
              <div className="text-center py-10 space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-afya-green/10 flex items-center justify-center mx-auto" aria-hidden="true">
                  <Zap className="w-7 h-7 text-afya-green" strokeWidth={1.5} />
                </div>
                <p className="font-semibold text-afya-charcoal">{t("best_window_result")}</p>
                <p className="text-sm text-afya-muted max-w-xs mx-auto">{t("plan_empty")}</p>
              </div>
            </Card>
          )}

          {/* Saved plans */}
          <div>
            <h2 className="text-base font-semibold text-afya-charcoal mb-3">{t("saved_plans")}</h2>
            {!user ? (
              <Card>
                <div className="text-center py-6 space-y-2">
                  <p className="text-sm text-afya-muted">{t("protected_route")}</p>
                  <a href="/sign-in" className="text-sm font-semibold text-afya-green hover:underline">{t("sign_in")}</a>
                </div>
              </Card>
            ) : plansLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            ) : plans.length === 0 ? (
              <Card>
                <div className="text-center py-8 space-y-3">
                  <p className="font-semibold text-afya-charcoal">{t("no_saved_plans")}</p>
                  <p className="text-sm text-afya-muted max-w-xs mx-auto">{t("no_saved_plans_sub")}</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {plans.map((plan) => {
                  const saved = plan.last_result?.recommended ? plan.last_result : null;
                  return (
                  <Card key={plan.id} className={cn("!p-4", editingPlan?.id === plan.id && "ring-2 ring-afya-green/40")}>
                    <div className="flex items-start gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-afya-charcoal text-sm truncate">{plan.name}</span>
                          <span className="text-xs text-afya-muted">{plan.duration_minutes} {t("minutes")}</span>
                        </div>
                        {saved && (
                          <div className="flex items-center gap-2 flex-wrap mt-1">
                            <span className="text-xs text-afya-green font-semibold">
                              <Clock className="w-3 h-3 inline-block mr-1" aria-hidden="true" />
                              {fmtDate(saved.recommended.start)} · {fmtWindow(saved.recommended.start, saved.recommended.end)}
                            </span>
                            {saved.recommended.risk && <RiskChip level={saved.recommended.risk} size="sm" />}
                            {saved.source === "regional" && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-afya-gold">
                                {t("plan_source_regional")}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => rerunPlan(plan)}
                          disabled={rerunning === plan.id}
                          title={t("rerun_forecast")}
                          className="p-2 rounded-lg text-afya-muted hover:bg-afya-canvas hover:text-afya-charcoal transition-colors disabled:opacity-50"
                          aria-label={t("rerun_forecast")}
                        >
                          <RefreshCw className={cn("w-4 h-4", rerunning === plan.id && "animate-spin")} strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => loadPlanIntoEditor(plan)}
                          title={t("edit")}
                          className="p-2 rounded-lg text-afya-muted hover:bg-afya-canvas hover:text-afya-charcoal transition-colors"
                          aria-label={t("edit")}
                          aria-pressed={editingPlan?.id === plan.id}
                        >
                          <Edit3 className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => duplicatePlan(plan.id)}
                          title={t("duplicate")}
                          className="p-2 rounded-lg text-afya-muted hover:bg-afya-canvas hover:text-afya-charcoal transition-colors"
                          aria-label={t("duplicate")}
                        >
                          <Copy className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => deletePlan(plan.id)}
                          title={t("delete")}
                          className="p-2 rounded-lg text-afya-muted hover:bg-afya-red/10 hover:text-afya-red transition-colors"
                          aria-label={t("delete")}
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>
                  </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Why section */}
      <div id="ai-section-plan">
        {/* AiPanel embedded below */}
        <PlanWhySection result={result} lang={lang} t={t} />
      </div>
    </div>
  );
}


// Inline Why section for plan results
function PlanWhySection({ result, lang, t }: {
  result: BestTimeResult | null; lang: string; t: (k: string) => string;
}) {
  const [aiText, setAiText] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  if (!result) return null;

  async function askWhy() {
    if (!result) return;
    const win = fmtWindow(result.recommended.start, result.recommended.end);
    setLoadingAi(true);
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lang,
          question: lang === "sw"
            ? `Kwa nini ${win} ndio dirisha bora?`
            : `Why is ${win} the recommended window?`,
          context: "plan",
          window_start: result.recommended.start,
          window_end: result.recommended.end,
          activity: result.activity,
          duration_minutes: result.duration_minutes,
          reasons: result.recommended.reasons,
        }),
      });
      const data = await res.json();
      setAiText(data.explanation);
    } catch {
      setAiText(t("no_ai"));
    } finally {
      setLoadingAi(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-afya-charcoal mb-1">{t("why_this_time")}</h3>
          <div className="flex flex-wrap gap-2">
            {result.recommended.reasons.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 text-xs text-afya-green font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                {t(r)}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={askWhy}
          disabled={loadingAi}
          className="inline-flex items-center gap-1.5 rounded-lg border border-afya-border px-3 py-2 text-xs font-semibold text-afya-muted hover:border-afya-green hover:text-afya-green transition-colors shrink-0 disabled:opacity-40"
        >
          {loadingAi
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
            : <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
          }
          {t("why")}
        </button>
      </div>
      {aiText && (
        <div className="mt-3 rounded-xl bg-afya-canvas border border-afya-border px-4 py-3 text-sm text-afya-charcoal leading-relaxed">
          {aiText}
        </div>
      )}
    </Card>
  );
}
