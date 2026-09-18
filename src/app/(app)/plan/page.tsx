"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { useAuth } from "@/lib/contexts/auth";
import { ACTIVITY_PROFILES } from "@/lib/afya/constants";
import { fmtWindow } from "@/lib/afya/format";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  CheckCircle2, Save, Trash2, Edit3, Copy, RefreshCw,
  ChevronRight, AlertTriangle, Clock, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BestTimeResult } from "@/lib/afya/types";

const DURATIONS = [30, 60, 90, 120, 180];

interface SavedPlan {
  id: number;
  name: string;
  activity_type: string;
  activity_label?: string;
  duration_minutes: number;
  available_start: string;
  available_end: string;
  last_result?: BestTimeResult | null;
  updated_at: string;
}

// Helper: build today's available ISO strings in EAT
function todayAt(hourEAT: number, minuteEAT = 0): string {
  const now = new Date();
  const eat = new Date(now.getTime() + 3 * 3600 * 1000);
  eat.setUTCHours(hourEAT, minuteEAT, 0, 0);
  return new Date(eat.getTime() - 3 * 3600 * 1000).toISOString();
}

export default function PlanPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();

  // Form state
  const [activity, setActivity] = useState("outdoor_work");
  const [duration, setDuration] = useState(90);
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(18);
  const [planName, setPlanName] = useState("");

  // Result state
  const [result, setResult] = useState<BestTimeResult | null>(null);
  const [quality, setQuality] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Saved plans
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SavedPlan | null>(null);

  const profileMeta = ACTIVITY_PROFILES.find((p) => p.key === activity) ?? ACTIVITY_PROFILES[0];

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

  async function evaluate() {
    setEvaluating(true);
    setResult(null);
    setEvalError(null);
    const windowStart = todayAt(startHour);
    const windowEnd = todayAt(endHour);
    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity,
          duration_minutes: duration,
          window_start: windowStart,
          window_end: windowEnd,
        }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setEvalError(data.message ?? t("error_generic"));
      } else {
        setResult(data.result);
        setQuality(data.situation?.quality ?? null);
      }
    } catch {
      setEvalError(t("error_generic"));
    } finally {
      setEvaluating(false);
    }
  }

  async function savePlan() {
    if (!user || !result) return;
    setSavingPlan(true);
    try {
      await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: planName || (lang === "sw" ? profileMeta.label_sw : profileMeta.label_en) + ` · ${duration}${t("minutes")}`,
          activity_type: activity,
          activity_label: lang === "sw" ? profileMeta.label_sw : profileMeta.label_en,
          duration_minutes: duration,
          available_start: todayAt(startHour),
          available_end: todayAt(endHour),
          last_result: result,
        }),
        credentials: "include",
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
      loadPlans();
    } finally {
      setSavingPlan(false);
    }
  }

  async function deletePlan(id: number) {
    await fetch(`/api/plans/${id}`, { method: "DELETE", credentials: "include" });
    loadPlans();
  }

  async function duplicatePlan(id: number) {
    await fetch(`/api/plans/${id}/duplicate`, { method: "POST", credentials: "include" });
    loadPlans();
  }

  async function rerunPlan(plan: SavedPlan) {
    const res = await fetch(`/api/plans/${plan.id}/rerun`, { method: "POST", credentials: "include" });
    const data = await res.json();
    if (res.ok && data.result) {
      setResult(data.result);
    }
    loadPlans();
  }

  async function loadPlanIntoEditor(plan: SavedPlan) {
    setEditingPlan(plan);
    setActivity(plan.activity_type);
    setDuration(plan.duration_minutes);
    const s = new Date(plan.available_start);
    const e = new Date(plan.available_end);
    setStartHour(new Date(s.getTime() + 3 * 3600 * 1000).getUTCHours());
    setEndHour(new Date(e.getTime() + 3 * 3600 * 1000).getUTCHours());
    setPlanName(plan.name);
    if (plan.last_result) setResult(plan.last_result as BestTimeResult);
  }

  const reasonColors: Record<string, string> = {
    reason_lower_exposure: "text-afya-green",
    reason_radiation_declining: "text-afya-teal",
    reason_low_rain: "text-afya-rain",
    reason_uncertainty_ok: "text-afya-green",
    reason_quality_good: "text-afya-green",
    reason_avoids_peak: "text-afya-gold",
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("plan_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("plan_subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── LEFT: Form ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardTitle>{t("what_planning")}</CardTitle>
            <div className="grid grid-cols-2 gap-2">
              {ACTIVITY_PROFILES.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setActivity(p.key)}
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
                  onClick={() => setDuration(d)}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-afya-muted block mb-1.5">{t("start_time")}</label>
                <select
                  value={startHour}
                  onChange={(e) => setStartHour(Number(e.target.value))}
                  className="w-full rounded-lg border border-afya-border bg-white px-3 py-2 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
                  aria-label={t("start_time")}
                >
                  {Array.from({ length: 18 }, (_, i) => i + 5).map((h) => (
                    <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-afya-muted block mb-1.5">{t("end_time")}</label>
                <select
                  value={endHour}
                  onChange={(e) => setEndHour(Number(e.target.value))}
                  className="w-full rounded-lg border border-afya-border bg-white px-3 py-2 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
                  aria-label={t("end_time")}
                >
                  {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
                    <option key={h} value={h}>{`${String(Math.min(h, 23)).padStart(2, "0")}:00`}</option>
                  ))}
                </select>
              </div>
            </div>
            {user && (
              <div className="mt-3">
                <label className="text-xs text-afya-muted block mb-1.5">
                  {lang === "sw" ? "Jina la mpango (hiari)" : "Plan name (optional)"}
                </label>
                <input
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder={lang === "sw" ? "Mfano: kazi yangu ya nje" : "e.g. my outdoor work"}
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

        {/* ── RIGHT: Results ─────────────────────────────────────────── */}
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
                  <div className="text-white/60 text-sm mb-5">
                    {lang === "sw" ? profileMeta.label_sw : profileMeta.label_en} · {duration} {t("minutes")}
                  </div>

                  {/* Why */}
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

              {/* Actions */}
              {user && (
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={savePlan}
                    disabled={savingPlan}
                    className="inline-flex items-center gap-2 rounded-xl bg-afya-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-afya-deep/90 disabled:opacity-50 transition-colors"
                  >
                    {saveOk
                      ? <CheckCircle2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                      : <Save className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
                    }
                    {saveOk ? t("plan_saved") : t("save_plan")}
                  </button>
                  <a
                    href="#ai-section-plan"
                    className="inline-flex items-center gap-2 rounded-xl border border-afya-border px-4 py-2.5 text-sm font-semibold text-afya-charcoal hover:bg-afya-canvas transition-colors"
                  >
                    {t("why_this_time")}
                  </a>
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

              {/* Quality note */}
              {quality === "DEGRADED" && (
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
                <p className="text-sm text-afya-muted max-w-xs mx-auto">
                  {lang === "sw"
                    ? "Chagua shughuli, muda, na kipindi chako kinachopatikana. AFYA MAZINGIRA italinganisha madirisha yote."
                    : "Select your activity, duration, and available window. AFYA MAZINGIRA will rank every candidate window."}
                </p>
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
                {plans.map((plan) => (
                  <Card key={plan.id} className="!p-4">
                    <div className="flex items-start gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-afya-charcoal text-sm truncate">{plan.name}</span>
                          <span className="text-xs text-afya-muted">{plan.duration_minutes} {t("minutes")}</span>
                        </div>
                        {plan.last_result && (plan.last_result as BestTimeResult).recommended && (
                          <div className="text-xs text-afya-green font-semibold mt-0.5">
                            <Clock className="w-3 h-3 inline-block mr-1" aria-hidden="true" />
                            {fmtWindow(
                              (plan.last_result as BestTimeResult).recommended.start,
                              (plan.last_result as BestTimeResult).recommended.end,
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => rerunPlan(plan)}
                          title={t("rerun_forecast")}
                          className="p-2 rounded-lg text-afya-muted hover:bg-afya-canvas hover:text-afya-charcoal transition-colors"
                          aria-label={t("rerun_forecast")}
                        >
                          <RefreshCw className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => loadPlanIntoEditor(plan)}
                          title={t("edit")}
                          className="p-2 rounded-lg text-afya-muted hover:bg-afya-canvas hover:text-afya-charcoal transition-colors"
                          aria-label={t("edit")}
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
                ))}
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
