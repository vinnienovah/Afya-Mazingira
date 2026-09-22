"use client";

import { useState } from "react";
import { useSituation } from "@/lib/contexts/situation";
import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import { fmtTime } from "@/lib/afya/format";
import { Card, CardTitle } from "@/components/ui/Card";
import { StateChip } from "@/components/ui/StateChip";
import { RiskChip } from "@/components/ui/RiskChip";
import { QualityDot } from "@/components/ui/QualityDot";
import StateTimeline from "@/components/charts/StateTimeline";
import { SkeletonCard, Skeleton } from "@/components/ui/Skeleton";
import {
  Building2, AlertTriangle, CheckCircle2, Clock, TrendingUp,
  Plus, Save, Trash2, Archive, Wind, Satellite, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { assessActivity, type PlannedActivity } from "@/lib/afya/operations";

// A starting list so the page is not empty. Each one is judged live against
// the forecast below; the names and hours are examples, not a real schedule.
const EXAMPLE_ACTIVITIES: PlannedActivity[] = [
  { id: 1, name: "Outdoor Sports Training", start_hour: 14, end_hour: 16, activity_type: "sports" },
  { id: 2, name: "Field Maintenance Work", start_hour: 9, end_hour: 12, activity_type: "outdoor_work" },
  { id: 3, name: "Campus Event Setup", start_hour: 13, end_hour: 17, activity_type: "outdoor_event" },
  { id: 4, name: "Agricultural Field Work", start_hour: 7, end_hour: 11, activity_type: "field_work" },
];

export default function OperationsPage() {
  const { situation, isLoading, error } = useSituation();
  const { t, lang } = useLanguage();
  const [activities, setActivities] = useState<PlannedActivity[]>(EXAMPLE_ACTIVITIES);
  const [newActivity, setNewActivity] = useState("");
  const [newStart, setNewStart] = useState(9);
  const [newEnd, setNewEnd] = useState(12);

  function addActivity() {
    if (!newActivity.trim()) return;
    const act: PlannedActivity = {
      id: Date.now(),
      name: newActivity,
      start_hour: newStart,
      end_hour: newEnd,
      activity_type: "general",
    };
    setActivities((a) => [...a, act]);
    setNewActivity("");
  }

  function deleteActivity(id: number) {
    setActivities((a) => a.filter((x) => x.id !== id));
  }

  function archiveActivity(id: number) {
    setActivities((a) => a.filter((x) => x.id !== id));
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height="h-28" />)}
        </div>
        <SkeletonCard height="h-48" />
      </div>
    );
  }

  const stateMeta = situation ? STATES[situation.state.state_id] : null;
  const f3h = situation?.forecast.find((f) => f.horizon === "3h");
  const peakTime = situation?.expected_peak?.time ?? null;
  const transition = situation?.state.transition_likelihood;
  const alerts = [
    ...(situation && situation.risk.thermal === "HIGH" || situation?.risk.thermal === "VERY_HIGH"
      ? [{ severity: "high", text_en: `Thermal exposure ${situation.risk.thermal} in forecast`, text_sw: `Kupatwa na joto ${situation.risk.thermal} katika utabiri` }]
      : []),
    ...(situation && situation.quality.status !== "GOOD"
      ? [{ severity: "medium", text_en: `Data quality is ${situation.quality.status}`, text_sw: `Ubora wa data ni ${situation.quality.status}` }]
      : []),
    ...(situation && situation.risk.rain_probability > 0.4
      ? [{ severity: "medium", text_en: "Elevated rain signal in forecast", text_sw: "Ishara iliyoongezeka ya mvua katika utabiri" }]
      : []),
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-afya-charcoal">{t("ops_title")}</h1>
          <p className="text-sm text-afya-muted mt-0.5">{t("ops_subtitle")}</p>
        </div>
        {situation?.demo_mode && (
          <span className="text-[11px] text-afya-muted/60 italic">{t("demo_notice")}</span>
        )}
        {situation?.data_source === "CONDUIT_ARCHIVE" && (
          <span className="text-[11px] text-afya-muted/60 italic">{t("archive_notice")}</span>
        )}
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Station status */}
        <Card>
          <div className="flex items-center gap-2 mb-2" aria-hidden="true">
            <Activity className="w-5 h-5 text-afya-green" strokeWidth={1.8} />
          </div>
          <CardTitle className="mb-1 text-xs">{t("station_status")}</CardTitle>
          {situation?.quality.status === "GOOD" ? (
            <span className="text-sm font-bold text-afya-green">{t("station_online")}</span>
          ) : situation?.quality.status === "DEGRADED" ? (
            <span className="text-sm font-bold text-afya-gold">{t("station_degraded")}</span>
          ) : (
            <span className="text-sm font-bold text-afya-red">{t("station_offline")}</span>
          )}
          {situation && (
            <div className="mt-1">
              <QualityDot status={situation.quality.status} freshnessMinutes={situation.quality.freshness_minutes} compact />
            </div>
          )}
        </Card>

        {/* Current state */}
        <Card>
          <div className="text-xs text-afya-muted mb-1">{t("current_state")}</div>
          {stateMeta && situation ? (
            <StateChip stateId={situation.state.state_id} size="sm" />
          ) : <Skeleton className="h-6 w-32 rounded-full" />}
          {situation && (
            <div className="mt-1.5 text-[11px] text-afya-muted">
              {t("state_since")}: {fmtTime(situation.state.since)}
            </div>
          )}
        </Card>

        {/* Next transition */}
        <Card>
          <div className="text-xs text-afya-muted mb-1">{t("next_transition")}</div>
          {transition && (
            <>
              <div className="text-sm font-bold" style={{ color: STATES[transition.state_id].color }}>
                {lang === "sw" ? STATES[transition.state_id].name_sw : STATES[transition.state_id].name}
              </div>
              <div className="text-[11px] text-afya-muted mt-1">
                ~{Math.round((transition.probability ?? 0) * 100)}% {lang === "sw" ? "uwezekano" : "likelihood"}
              </div>
            </>
          )}
        </Card>

        {/* +3h outlook */}
        <Card>
          <div className="text-xs text-afya-muted mb-1">{t("horizon_3h")}</div>
          <div className="text-2xl font-bold text-afya-charcoal">{f3h ? `${f3h.value.toFixed(1)}°C` : "-"}</div>
          {f3h && (
            <div className="text-[11px] text-afya-muted mt-0.5">
              {f3h.lower.toFixed(1)}–{f3h.upper.toFixed(1)}°C · {situation?.risk.thermal}
            </div>
          )}
        </Card>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Left column */}
        <div className="space-y-5">
          {/* Alerts */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-afya-gold" strokeWidth={1.8} aria-hidden="true" />
              <CardTitle className="mb-0">{t("active_alerts")}</CardTitle>
              {alerts.length > 0 && (
                <span className="ml-auto rounded-full bg-afya-red/10 text-afya-red text-xs font-bold px-2 py-0.5">
                  {alerts.length}
                </span>
              )}
            </div>
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-afya-green">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                {t("no_alerts")}
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <div key={i} className={cn(
                    "rounded-xl border px-4 py-3 flex gap-3",
                    a.severity === "high" ? "border-afya-red/40 bg-afya-red/8" : "border-afya-gold/40 bg-afya-gold/8",
                  )}>
                    <AlertTriangle
                      className={cn("w-4 h-4 shrink-0 mt-0.5", a.severity === "high" ? "text-afya-red" : "text-afya-gold")}
                      strokeWidth={2} aria-hidden="true"
                    />
                    <p className="text-sm text-afya-charcoal">{lang === "sw" ? a.text_sw : a.text_en}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Best operational windows */}
          <Card>
            <CardTitle>{t("best_operational_windows")}</CardTitle>
            {situation?.best_time && situation.quality.status !== "POOR" ? (
              <div className="space-y-3">
                <div
                  className="rounded-xl border-2 border-afya-green/40 bg-afya-green/5 px-4 py-4"
                  role="region"
                  aria-label={t("best_window")}
                >
                  <div className="text-[11px] font-bold text-afya-green uppercase tracking-wider mb-2">
                    {t("best_window_result")}
                  </div>
                  <div className="text-3xl font-bold text-afya-charcoal">
                    {fmtTime(situation.best_time.recommended.start)}–{fmtTime(situation.best_time.recommended.end)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {situation.best_time.recommended.reasons.slice(0, 3).map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 text-xs text-afya-green">
                        <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                        {t(r)}
                      </span>
                    ))}
                  </div>
                </div>
                {situation.best_time.alternative && (
                  <div className="rounded-xl border border-afya-border px-4 py-3">
                    <div className="text-[10px] text-afya-muted mb-1">{t("alternative_window")}</div>
                    <div className="text-lg font-bold text-afya-charcoal">
                      {fmtTime(situation.best_time.alternative.start)}–{fmtTime(situation.best_time.alternative.end)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-afya-muted">
                {situation?.best_time_note === "no_daylight_window"
                  ? lang === "sw"
                    ? "Hakuna muda wa mchana uliobaki katika utabiri wa saa 9."
                    : "No daylight window is left in the 9-hour forecast."
                  : t("quality_suppressed")}
              </p>
            )}
          </Card>

          {/* Regional summary */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Satellite className="w-4 h-4 text-afya-teal" strokeWidth={1.8} aria-hidden="true" />
              <CardTitle className="mb-0">{t("regional_summary")}</CardTitle>
            </div>
            {situation && (
              <div className="space-y-2">
                <p className="text-xs text-afya-muted">
                  {!situation.era5.available
                    ? t("era5_unavailable")
                    : lang === "sw"
                      ? `Tofauti ya joto dhidi ya ERA5 (~km 28): ${situation.era5.local_temp_anomaly_c >= 0 ? "+" : ""}${situation.era5.local_temp_anomaly_c}°C. Unyevu wa udongo wa ERA5 (sm 0-7): ${(situation.era5.era5_soil_moisture * 100).toFixed(0)}%.`
                      : `Local temp anomaly vs ERA5 (~28 km): ${situation.era5.local_temp_anomaly_c >= 0 ? "+" : ""}${situation.era5.local_temp_anomaly_c}°C. ERA5 soil moisture (0-7 cm): ${(situation.era5.era5_soil_moisture * 100).toFixed(0)}%.`}
                </p>
                <Link
                  href="/map"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-afya-green hover:underline"
                >
                  {t("map_title")}
                  <TrendingUp className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                </Link>
              </div>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Planned activities */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <CardTitle className="mb-0">{t("planned_activities")}</CardTitle>
              <span className="text-xs text-afya-muted">
                {activities.length} {lang === "sw" ? "shughuli · mifano, ongeza zako" : "activities · examples, add your own"}
              </span>
            </div>
            <div className="space-y-2.5">
              {activities.map((act) => {
                const check = situation ? assessActivity(act, situation.forecast_series, Date.parse(situation.generated_at)) : null;
                return (
                <div
                  key={act.id}
                  className={cn(
                    "rounded-xl border px-4 py-3",
                    check?.affected ? "border-afya-orange/40 bg-afya-orange/5" : "border-afya-border",
                  )}
                >
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-afya-charcoal">{act.name}</span>
                        {check?.affected && (
                          <span className="rounded-full bg-afya-orange/10 text-afya-orange text-[10px] font-bold px-2 py-0.5">
                            {lang === "sw" ? "INAATHIRIWA" : "AFFECTED"}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-afya-muted mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" strokeWidth={1.8} aria-hidden="true" />
                        {String(act.start_hour).padStart(2, "0")}:00–{String(act.end_hour).padStart(2, "0")}:00
                      </div>
                      <p className="text-xs text-afya-muted mt-1 leading-relaxed">
                        {check ? (lang === "sw" ? check.text_sw : check.text_en) : null}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => archiveActivity(act.id)}
                        className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-canvas hover:text-afya-charcoal transition-colors"
                        aria-label="Archive"
                      >
                        <Archive className="w-4 h-4" strokeWidth={1.8} />
                      </button>
                      <button
                        onClick={() => deleteActivity(act.id)}
                        className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-red/10 hover:text-afya-red transition-colors"
                        aria-label={t("delete")}
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            {/* Add new activity */}
            <div className="mt-4 rounded-xl border border-afya-border border-dashed px-4 py-3">
              <p className="text-xs font-semibold text-afya-muted mb-2">
                {lang === "sw" ? "Ongeza shughuli mpya" : "Add operational activity"}
              </p>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={newActivity}
                  onChange={(e) => setNewActivity(e.target.value)}
                  placeholder={lang === "sw" ? "Jina la shughuli" : "Activity name"}
                  className="flex-1 min-w-[120px] rounded-lg border border-afya-border bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-afya-green"
                />
                <select
                  value={newStart}
                  onChange={(e) => setNewStart(Number(e.target.value))}
                  className="rounded-lg border border-afya-border bg-white px-2 py-1.5 text-xs"
                  aria-label="Start hour"
                >
                  {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
                <select
                  value={newEnd}
                  onChange={(e) => setNewEnd(Number(e.target.value))}
                  className="rounded-lg border border-afya-border bg-white px-2 py-1.5 text-xs"
                  aria-label="End hour"
                >
                  {Array.from({ length: 17 }, (_, i) => i + 7).map((h) => (
                    <option key={h} value={h}>{String(Math.min(h, 22)).padStart(2, "0")}:00</option>
                  ))}
                </select>
                <button
                  onClick={addActivity}
                  className="px-3 py-1.5 rounded-lg bg-afya-green text-white text-xs font-bold hover:bg-afya-green/90 transition-colors flex items-center gap-1"
                  aria-label="Add activity"
                >
                  <Plus className="w-3 h-3" strokeWidth={2.5} />
                  {lang === "sw" ? "Ongeza" : "Add"}
                </button>
              </div>
            </div>
          </Card>

          {/* State history */}
          {situation && (
            <Card>
              <CardTitle>{t("state_history_ops")}</CardTitle>
              <StateTimeline segments={situation.state_history_24h} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
