"use client";

import Link from "next/link";
import { useSituation } from "@/lib/contexts/situation";
import { useLanguage } from "@/lib/contexts/language";
import { STATES, RISK_META } from "@/lib/afya/constants";
import { horizonScores, FORECAST_METHOD, FORECAST_MODEL_KIND, FORECAST_PERIODS } from "@/lib/afya/forecast-engine";
import evaluation from "@/lib/afya/model/forecast-evaluation.json";
import type { Lang } from "@/lib/afya/types";
import { fill, fmtAsOf, fmtDate, fmtDayMonth, fmtSigned, fmtTime, MONTH_NAMES } from "@/lib/afya/format";
import {
  calendarGapDays, contributorLabel, currentBand, nextStateNote, rainWindows, timeOfDayGapHours,
} from "@/lib/afya/display";
import { Card, CardTitle } from "@/components/ui/Card";
import { StateChip } from "@/components/ui/StateChip";
import { RiskChip } from "@/components/ui/RiskChip";
import { QualityDot } from "@/components/ui/QualityDot";
import { ContributorList } from "@/components/ui/ContributorList";
import MeasurementStrip from "@/components/ui/MeasurementStrip";
import StateTimeline from "@/components/charts/StateTimeline";
import AiPanel from "@/components/ai/AiPanel";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { AlertTriangle, Cpu, Globe, CloudRain, Satellite, Database, TrendingUp, Info, ChevronRight, CalendarRange } from "lucide-react";

const HORIZONS = ["1h", "3h", "6h", "9h"] as const;

// ERA5 compared at another time of day mostly shows the daily cycle.
const MAX_COMPARABLE_GAP_HOURS = 1.5;
// The reanalysis is published days behind, and the hours-of-day gap cannot see
// that: an anomaly against another calendar day is not a reading of now.
const MAX_COMPARABLE_GAP_DAYS = 0;

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

const UNCERTAINTY_SW = { LOW: "chini", MODERATE: "wastani", HIGH: "juu" } as const;

/** "2026-01" as "Jan 2026", or "Jan" without the year. */
function monthName(month: string, lang: Lang, withYear = true): string {
  const [year, m] = month.split("-");
  const name = MONTH_NAMES[lang][Number(m) - 1];
  return withYear ? `${name} ${year}` : name;
}

const SEASONS = [evaluation.seasons.hot, evaluation.seasons.other];
const HOT_MONTHS: string[] = evaluation.seasons.hot.months;
const TESTED_MONTHS: string[] = evaluation.months;

export default function IntelligencePage() {
  const { situation, isLoading, error } = useSituation();
  const { t, lang } = useLanguage();

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <SkeletonCard height="h-32" />
        <SkeletonCard height="h-48" />
        <SkeletonCard height="h-64" />
      </div>
    );
  }

  if (error || !situation) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-afya-gold shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
            <p className="text-sm text-afya-muted">{t("error_generic")}</p>
          </div>
        </Card>
      </div>
    );
  }

  const { current, state, forecast, quality, risk, era5, chirps, sentinel, contributors, state_history_24h } = situation;
  const era5Ok = era5.available !== false;
  const f3h = forecast.find((f) => f.horizon === "3h");
  const transition = state.transition_likelihood;
  const nowBand = currentBand(situation);
  const bandName = (level: keyof typeof RISK_META) => RISK_META[level][lang].toLowerCase();
  const stateName = (id: keyof typeof STATES) => (lang === "sw" ? STATES[id].name_sw : STATES[id].name);

  const era5Time = era5Ok && era5.valid_time ? era5.valid_time : null;
  const anomaly = era5Ok ? era5.local_temp_anomaly_c : null;
  const humidityAnomaly = era5Ok ? era5.local_humidity_anomaly : null;
  const hoursApart = era5Time ? timeOfDayGapHours(current.time, era5Time) : 0;
  const daysApart = era5Time ? calendarGapDays(current.time, era5Time) : 0;
  const rain = rainWindows(chirps);
  const rainOk = rain !== null;
  const days = (n: number) => (lang === "sw" ? `siku ${n}` : `${n} days`);

  const WHAT_WHY_NEXT = [
    {
      icon: <Info className="w-5 h-5 text-afya-teal" />,
      title_en: "WHAT?", title_sw: "NINI?",
      body: fill(t("why_what"), {
        state: stateName(state.state_id),
        wbgt: current.wbgt_c.toFixed(1),
        band_now: bandName(nowBand),
        wbgt_3h: f3h ? f3h.value.toFixed(1) : "-",
        band_3h: bandName(risk.thermal),
      }),
    },
    {
      icon: <TrendingUp className="w-5 h-5 text-afya-gold" />,
      title_en: "WHY?", title_sw: "KWA NINI?",
      body: contributors.length
        ? fill(t("why_why"), { list: contributors.slice(0, 3).map((c) => contributorLabel(c.feature, lang).toLowerCase()).join(", ") })
        : lang === "sw"
          ? "Hali ni sawa na muonekano wa hali ya mazingira ya sasa."
          : "Conditions are consistent with the current environmental state pattern.",
    },
    {
      icon: <Cpu className="w-5 h-5 text-afya-green" />,
      title_en: "WHAT NEXT?", title_sw: "NINI KINACHOFUATA?",
      body: [
        transition ? `${t("next_transition")}: ${stateName(transition.state_id)} (${nextStateNote(transition, lang)}).` : "",
        f3h ? `${t("horizon_3h")}: ${f3h.value.toFixed(1)}°C.` : "",
      ].filter(Boolean).join(" "),
    },
    {
      icon: <Database className="w-5 h-5 text-afya-rain" />,
      title_en: "HOW CERTAIN?", title_sw: "NI UHAKIKA KIASI GANI?",
      body: lang === "sw"
        ? `Ubora wa data: ${t(`quality_${quality.status.toLowerCase()}`)}. Utata wa utabiri: ${UNCERTAINTY_SW[risk.uncertainty]}. Kipindi cha +saa 3: ${f3h?.lower.toFixed(1)}–${f3h?.upper.toFixed(1)}°C. ${quality.status !== "GOOD" ? "Uhakika umepungua, mapendekezo madhubuti yamesitishwa." : ""}`
        : `Data quality: ${quality.status}. Forecast uncertainty: ${risk.uncertainty.toLowerCase()}. Interval for +3h: ${f3h?.lower.toFixed(1)}–${f3h?.upper.toFixed(1)}°C. ${quality.status !== "GOOD" ? "Confidence is reduced, strong recommendations are suppressed." : ""}`,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("intelligence_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("intelligence_subtitle")}</p>
        <p className="text-xs text-afya-muted mt-1">{t("data_as_of")} {fmtAsOf(situation.generated_at, lang)}</p>
      </div>

      {/* WHAT/WHY/WHAT NEXT/HOW CERTAIN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {WHAT_WHY_NEXT.map((item, i) => (
          <Card key={i}>
            <div className="flex items-center gap-2 mb-2" aria-hidden="true">{item.icon}</div>
            <div className="text-sm font-bold text-afya-charcoal mb-1">{lang === "sw" ? item.title_sw : item.title_en}</div>
            <p className="text-sm text-afya-muted leading-relaxed">{item.body}</p>
          </Card>
        ))}
      </div>

      {/* Current state + quality */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardTitle>{t("environmental_state")}</CardTitle>
          <StateChip stateId={state.state_id} size="lg" />
          {transition && (
            <div className="mt-3 text-xs text-afya-muted">
              {t("next_transition")}:{" "}
              <strong style={{ color: STATES[transition.state_id].color }}>
                {stateName(transition.state_id)}
              </strong>
              <div className="mt-0.5">{nextStateNote(transition, lang)}</div>
            </div>
          )}
        </Card>
        <Card>
          <CardTitle>{t("thermal_exposure")}</CardTitle>
          <RiskChip level={nowBand} size="lg" />
          <div className="mt-3 text-xs text-afya-muted">
            {t("wbgt_now")}: {current.wbgt_c.toFixed(1)}°C
          </div>
          {f3h && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-afya-muted">
              {t("horizon_3h_short")}: {f3h.value.toFixed(1)}°C
              <RiskChip level={risk.thermal} size="sm" />
            </div>
          )}
        </Card>
        <Card>
          <CardTitle>{t("data_quality")}</CardTitle>
          <QualityDot status={quality.status} freshnessMinutes={quality.freshness_minutes} />
          {quality.flags.length > 0 && (
            <div className="mt-2 space-y-1">
              {quality.flags.filter((f) => f !== "uv_signal_unusual").map((flag) => (
                <div key={flag} className="text-xs text-afya-muted rounded-lg bg-afya-canvas px-2 py-1 border border-afya-border">
                  {flag.replace(/_/g, " ")}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Measurements */}
      <Card>
        <CardTitle>{t("current_measurements")}</CardTitle>
        <MeasurementStrip
          obs={current}
          freshnessMinutes={quality.freshness_minutes}
          dataSource={situation.data_source}
          feed={situation.data_feed}
        />
      </Card>

      {/* Live climate variables now live on the consolidated Dashboard
          (/climate) alongside Climate History and Historical Replay,
          rather than duplicated here, this page stays focused on
          why/explanation. */}
      <Link
        href="/climate"
        className="flex items-center justify-between rounded-2xl border border-afya-border bg-white px-5 py-4 hover:border-afya-green/50 transition-colors group"
      >
        <div>
          <p className="text-sm font-semibold text-afya-charcoal">{t("explore_dashboard")}</p>
          <p className="text-xs text-afya-muted mt-0.5">{t("explore_dashboard_note")}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-afya-muted group-hover:text-afya-green transition-colors shrink-0" strokeWidth={2} aria-hidden="true" />
      </Link>

      {/* State history */}
      <Card>
        <CardTitle>{t("state_timeline")}</CardTitle>
        <StateTimeline segments={state_history_24h} />
      </Card>

      {/* Model versions */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Cpu className="w-5 h-5 text-afya-deep" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{t("model_version")}</CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="text-left text-xs text-afya-muted border-b border-afya-border">
                <th scope="col" className="pb-2 pr-4 font-semibold"></th>
                <th scope="col" className="pb-2 pr-4 font-semibold">{t("horizon_1h")}</th>
                <th scope="col" className="pb-2 pr-4 font-semibold">{t("horizon_3h")}</th>
                <th scope="col" className="pb-2 pr-4 font-semibold">{t("horizon_6h")}</th>
                <th scope="col" className="pb-2 font-semibold">{t("horizon_9h")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-afya-border/50">
              {[
                { label: lang === "sw" ? "Kosa la wastani (MAE)" : "Mean error (MAE)", vals: HORIZONS.map((h) => `${horizonScores(h).mae.toFixed(2)}°C`) },
                { label: lang === "sw" ? "Bila mabadiliko" : "No-change baseline", vals: HORIZONS.map((h) => `${horizonScores(h).persistence_mae.toFixed(2)}°C`) },
                { label: lang === "sw" ? "Upana wa bendi 80%" : "80% band", vals: HORIZONS.map((h) => `±${horizonScores(h).band80.toFixed(2)}°C`) },
                { label: lang === "sw" ? "Ndani ya bendi" : "Inside the band", vals: HORIZONS.map((h) => `${Math.round(horizonScores(h).coverage80 * 100)}%`) },
                { label: lang === "sw" ? "Kiwango cha hatari sawa" : "Same risk band as observed", vals: HORIZONS.map((h) => `${horizonScores(h).band_same_pct}%`) },
                { label: lang === "sw" ? "Kiwango cha chini kuliko halisi" : "Band lower than observed", vals: HORIZONS.map((h) => `${horizonScores(h).band_lower_pct}%`) },
              ].map((row, i) => (
                <tr key={i}>
                  <th scope="row" className="py-2 pr-4 text-xs font-semibold text-afya-muted text-left">{row.label}</th>
                  {row.vals.map((v, j) => (
                    <td key={j} className="py-2 pr-4 text-afya-charcoal font-medium">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-afya-muted">
          {lang === "sw"
            ? `${FORECAST_MODEL_KIND === "seasonal" ? t("forecast_method_seasonal") : FORECAST_METHOD}. Imefunzwa kwa data ya Conduit ${FORECAST_PERIODS.train[0]} hadi ${FORECAST_PERIODS.train[1]}. Bendi imewekwa kutoka ${FORECAST_PERIODS.calibration[0]} hadi ${FORECAST_PERIODS.calibration[1]}, na alama zote zimetoka ${FORECAST_PERIODS.test[0]} hadi ${FORECAST_PERIODS.test[1]}, miezi ambayo modeli haikuiona. Lengo ni WBGT kivulini.`
            : `${FORECAST_METHOD}. Fitted on Conduit data from ${FORECAST_PERIODS.train[0]} to ${FORECAST_PERIODS.train[1]}. The band is set from ${FORECAST_PERIODS.calibration[0]} to ${FORECAST_PERIODS.calibration[1]}, and every score comes from ${FORECAST_PERIODS.test[0]} to ${FORECAST_PERIODS.test[1]}, months the model never saw. The target is WBGT in shade.`}
        </p>
      </Card>

      {/* Month by month, so the hot season is scored on its own */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <CalendarRange className="w-5 h-5 text-afya-orange" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{lang === "sw" ? "Imejaribiwa mwezi kwa mwezi" : "Tested month by month"}</CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="text-left text-xs text-afya-muted border-b border-afya-border">
                <th scope="col" className="pb-2 pr-4 font-semibold"></th>
                <th scope="col" className="pb-2 pr-4 font-semibold">
                  {lang === "sw" ? "Msimu wa joto" : "Hot season"}
                  <span className="block font-normal">
                    {monthName(HOT_MONTHS[0], lang, false)} {lang === "sw" ? "hadi" : "to"} {monthName(HOT_MONTHS[HOT_MONTHS.length - 1], lang)}
                  </span>
                </th>
                <th scope="col" className="pb-2 font-semibold">
                  {lang === "sw" ? "Miezi mingine" : "Other months"}
                  <span className="block font-normal">
                    {lang === "sw"
                      ? `miezi ${evaluation.seasons.other.months.length}`
                      : `${evaluation.seasons.other.months.length} months`}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-afya-border/50">
              {[
                ...(["1h", "3h", "9h"] as const).map((h) => ({
                  label: `${lang === "sw" ? "Kosa la wastani" : "Mean error"}, ${t(`horizon_${h}`)}`,
                  vals: SEASONS.map((s) => `${s.horizons[h].mae.toFixed(2)}°C`),
                })),
                { label: `${lang === "sw" ? "Bila mabadiliko" : "No-change baseline"}, ${t("horizon_3h")}`, vals: SEASONS.map((s) => `${s.horizons["3h"].persistence_mae.toFixed(2)}°C`) },
                { label: `${lang === "sw" ? "Kiwango cha hatari sawa" : "Same risk band as observed"}, ${t("horizon_3h")}`, vals: SEASONS.map((s) => `${s.band_same_pct.toFixed(1)}%`) },
                { label: `${lang === "sw" ? "Kiwango cha chini kuliko halisi" : "Band lower than observed"}, ${t("horizon_3h")}`, vals: SEASONS.map((s) => `${s.band_lower_pct.toFixed(1)}%`) },
              ].map((row, i) => (
                <tr key={i}>
                  <th scope="row" className="py-2 pr-4 text-xs font-semibold text-afya-muted text-left">{row.label}</th>
                  {row.vals.map((v, j) => (
                    <td key={j} className="py-2 pr-4 text-afya-charcoal font-medium">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-3">
          <summary className="text-xs font-semibold text-afya-muted cursor-pointer">
            {lang === "sw" ? "Kila mwezi (msimu wa joto una kivuli)" : "Each month (hot season shaded)"}
          </summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs" role="table">
              <thead>
                <tr className="text-left text-afya-muted border-b border-afya-border">
                  <th scope="col" className="pb-2 pr-4 font-semibold">{lang === "sw" ? "Mwezi" : "Month"}</th>
                  <th scope="col" className="pb-2 pr-4 font-semibold">{lang === "sw" ? "Kosa" : "Error"}, {t("horizon_3h")}</th>
                  <th scope="col" className="pb-2 pr-4 font-semibold">{lang === "sw" ? "Kosa" : "Error"}, {t("horizon_9h")}</th>
                  <th scope="col" className="pb-2 pr-4 font-semibold">{lang === "sw" ? "Bila mabadiliko" : "No change"}, {t("horizon_3h")}</th>
                  <th scope="col" className="pb-2 pr-4 font-semibold">{lang === "sw" ? "Kiwango sawa" : "Same band"}, {t("horizon_3h")}</th>
                  <th scope="col" className="pb-2 font-semibold">{lang === "sw" ? "Utabiri" : "Forecasts"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-afya-border/50">
                {evaluation.by_month.map((m) => (
                  <tr key={m.month} className={HOT_MONTHS.includes(m.month) ? "bg-afya-orange/10" : undefined}>
                    <th scope="row" className="py-1.5 pr-4 font-semibold text-afya-muted text-left whitespace-nowrap">{monthName(m.month, lang)}</th>
                    <td className="py-1.5 pr-4 text-afya-charcoal">{m.horizons["3h"].mae.toFixed(2)}°C</td>
                    <td className="py-1.5 pr-4 text-afya-charcoal">{m.horizons["9h"].mae.toFixed(2)}°C</td>
                    <td className="py-1.5 pr-4 text-afya-charcoal">{m.horizons["3h"].persistence_mae.toFixed(2)}°C</td>
                    <td className="py-1.5 pr-4 text-afya-charcoal">{m.band_same_pct.toFixed(1)}%</td>
                    <td className="py-1.5 text-afya-muted">{m.horizons["3h"].n.toLocaleString("en")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="mt-3 text-xs text-afya-muted">
          {lang === "sw"
            ? `Kila mwezi kuanzia ${monthName(TESTED_MONTHS[0], lang)} hadi ${monthName(TESTED_MONTHS[TESTED_MONTHS.length - 1], lang)} umetabiriwa na modeli zilizofunzwa upya kwa data yote ya kituo iliyorekodiwa kabla ya mwezi huo kuanza, kwa hivyo kila alama inatoka kwa mwezi ambao modeli haikuuona. Jedwali lililo juu linatoka kwa modeli moja iliyofunzwa kwa data hadi ${FORECAST_PERIODS.train[1]}, kwa hivyo takwimu zake zinatofautiana kidogo.`
            : `Each month from ${monthName(TESTED_MONTHS[0], lang)} to ${monthName(TESTED_MONTHS[TESTED_MONTHS.length - 1], lang)} is forecast by models refitted on everything the station recorded before that month began, so every score comes from a month the fit had not seen. The table above comes from a single fit on data up to ${FORECAST_PERIODS.train[1]}, so its figures differ a little.`}
        </p>
      </Card>

      {/* ERA5 context */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-afya-rain" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{t("era5_context")}</CardTitle>
        </div>
        {era5Ok ? (
          <>
            {era5Time && (
              <p className="text-xs text-afya-muted mb-4">{fill(t("era5_valid"), { time: fmtAsOf(era5Time, lang) })}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { l_en: "ERA5 Temp", l_sw: "Joto la ERA5", v: isNum(era5.era5_temp_c) ? `${era5.era5_temp_c.toFixed(1)}°C` : "-" },
                { l_en: "ERA5 RH", l_sw: "Unyevu wa ERA5", v: isNum(era5.era5_relative_humidity) ? `${era5.era5_relative_humidity.toFixed(0)}%` : "-" },
                { l_en: "ERA5 Wind", l_sw: "Upepo wa ERA5", v: isNum(era5.era5_wind_speed_ms) ? `${era5.era5_wind_speed_ms.toFixed(1)} m/s` : "-" },
                { l_en: "ERA5 Solar", l_sw: "Mionzi ya ERA5", v: isNum(era5.era5_solar_wm2) ? `${era5.era5_solar_wm2.toFixed(0)} W/m²` : "-" },
              ].map((item, i) => (
                <div key={i} className="rounded-lg border border-afya-border bg-afya-canvas/50 px-3 py-2">
                  <div className="text-[10px] text-afya-muted">{lang === "sw" ? item.l_sw : item.l_en}</div>
                  <div className="text-sm font-bold text-afya-charcoal">{item.v}</div>
                  <div className="text-[9px] text-afya-muted/60 font-semibold uppercase">{t("regional_model_label")} · ERA5 · ~28 km</div>
                </div>
              ))}
            </div>
            {/* Local vs regional anomaly, with both times so the comparison can be judged */}
            <div className="rounded-xl border border-afya-border bg-afya-canvas/50 px-4 py-3">
              <p className="text-xs font-semibold text-afya-charcoal mb-2">{t("local_vs_regional")}</p>
              <div className="flex flex-wrap gap-6">
                <div>
                  <div
                    className="text-lg font-bold"
                    style={{ color: !isNum(anomaly) ? "#68756f" : anomaly >= 0 ? "#E27832" : "#247B78" }}
                  >
                    {isNum(anomaly) ? `${fmtSigned(anomaly)}°C` : "-"}
                  </div>
                  <div className="text-[10px] text-afya-muted">{lang === "sw" ? "Tofauti ya Joto" : "Temp anomaly"}</div>
                </div>
                <div>
                  <div
                    className="text-lg font-bold"
                    style={{ color: !isNum(humidityAnomaly) ? "#68756f" : humidityAnomaly >= 0 ? "#247B78" : "#E27832" }}
                  >
                    {isNum(humidityAnomaly) ? `${fmtSigned(humidityAnomaly)}%` : "-"}
                  </div>
                  <div className="text-[10px] text-afya-muted">{lang === "sw" ? "Tofauti ya Unyevu" : "RH anomaly"}</div>
                </div>
                <div className="flex-1 min-w-[12rem] text-[11px] text-afya-muted space-y-1">
                  {era5Time && (
                    <p>{fill(t("anomaly_compare"), { station: fmtAsOf(current.time, lang), era5: fmtAsOf(era5Time, lang) })}</p>
                  )}
                  {daysApart > MAX_COMPARABLE_GAP_DAYS && (
                    <p className="font-semibold text-afya-orange">{fill(t("anomaly_days_old"), { days: daysApart })}</p>
                  )}
                  {hoursApart > MAX_COMPARABLE_GAP_HOURS && (
                    <p className="font-semibold text-afya-orange">{t("anomaly_hours_differ")}</p>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-afya-muted">{t("context_unavailable")}</p>
        )}
      </Card>

      {/* Rainfall context, dated by the days each total covers */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <CloudRain className="w-5 h-5 text-afya-rain" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{t("chirps_context")}</CardTitle>
        </div>
        {rainOk ? (
          <>
            {chirps.through && (
              <p className="text-xs text-afya-muted mb-4">{fill(t("rain_model_note"), { time: fmtTime(chirps.through) })}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { l: fill(t("rain_on_day"), { day: fmtDayMonth(rain.day, lang) }), v: isNum(chirps.chirps_mm) ? `${chirps.chirps_mm.toFixed(1)} mm` : "-" },
                {
                  l: fill(t("rain_days_to"), { days: 7, day: fmtDayMonth(rain.week.to, lang) }),
                  sub: `${fmtDayMonth(rain.week.from, lang)}–${fmtDayMonth(rain.week.to, lang)}`,
                  v: isNum(chirps.chirps_7d_mm) ? `${chirps.chirps_7d_mm.toFixed(1)} mm` : "-",
                },
                {
                  l: fill(t("rain_days_to"), { days: 30, day: fmtDayMonth(rain.month.to, lang) }),
                  sub: `${fmtDayMonth(rain.month.from, lang)}–${fmtDayMonth(rain.month.to, lang)}`,
                  v: isNum(chirps.chirps_30d_mm) ? `${chirps.chirps_30d_mm.toFixed(1)} mm` : "-",
                },
                { l: fill(t("rain_percentile"), { day: fmtDayMonth(rain.day, lang) }), v: isNum(chirps.chirps_percentile) ? chirps.chirps_percentile.toFixed(0) : "-" },
                { l: fill(t("dry_spell_to"), { day: fmtDayMonth(rain.day, lang) }), v: isNum(chirps.chirps_dry_spell_days) ? days(chirps.chirps_dry_spell_days) : "-" },
                { l: fill(t("wet_spell_to"), { day: fmtDayMonth(rain.day, lang) }), v: isNum(chirps.chirps_wet_spell_days) ? days(chirps.chirps_wet_spell_days) : "-" },
              ].map((item, i) => (
                <div key={i} className="rounded-lg border border-afya-border bg-afya-canvas/50 px-3 py-2">
                  <div className="text-[10px] text-afya-muted">{item.l}</div>
                  <div className="text-sm font-bold text-afya-charcoal">{item.v}</div>
                  {item.sub && <div className="text-[10px] text-afya-muted">{item.sub}</div>}
                  <div className="text-[9px] text-afya-muted/60 font-semibold uppercase">{t("regional_model_label")} · OPEN-METEO</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-afya-muted">{t("context_unavailable")}</p>
        )}
      </Card>

      {/* Satellite context: only what was actually retrieved */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Satellite className="w-5 h-5 text-afya-teal" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{t("satellite_context")}</CardTitle>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-afya-border bg-afya-canvas/50 px-4 py-3">
            <div className="text-xs font-bold text-afya-green mb-1">Sentinel-2</div>
            <div className={`text-sm font-bold mb-1 ${sentinel.sentinel2_ndvi_mean !== null ? "text-afya-charcoal" : "text-afya-muted"}`}>
              {sentinel.sentinel2_ndvi_mean !== null ? `NDVI ${sentinel.sentinel2_ndvi_mean.toFixed(2)}` : t("ndvi_unavailable")}
            </div>
            <div className="text-[10px] text-afya-muted space-y-0.5">
              {sentinel.sentinel2_acquired && <div>{t("latest_scene")}: {fmtDate(sentinel.sentinel2_acquired)}</div>}
              <div>{t("native_resolution")}: 10 m</div>
              <div className="font-semibold text-afya-muted/70 uppercase">{t("satellite_label")}</div>
            </div>
          </div>
          <div className="rounded-lg border border-afya-border bg-afya-canvas/50 px-4 py-3">
            <div className="text-xs font-bold text-afya-rain mb-1">Sentinel-3</div>
            <p className="text-sm text-afya-muted mb-1">{t("lst_unavailable")}</p>
            {sentinel.sentinel3_acquired && (
              <div className="text-[10px] text-afya-muted">{t("latest_scene")}: {fmtDate(sentinel.sentinel3_acquired)}</div>
            )}
          </div>
        </div>
      </Card>

      {/* Forecast contributors: the model's own effects when it sends them */}
      {contributors.length > 0 && (
        <Card>
          <CardTitle>{t("contributor_title")}</CardTitle>
          <ContributorList contributors={contributors} />
        </Card>
      )}

      {/* AI panel */}
      <AiPanel context="intelligence" />

      {/* Disclaimer */}
      <p className="text-[11px] text-afya-muted/60 text-center pb-2">
        {lang === "sw"
          ? "AFYA MAZINGIRA inatoa msaada wa maamuzi ya mazingira. Haitoi utambuzi wa matibabu. Miundo ya mfumo ni vichangiaji, si sababu za kuhakikishwa."
          : "AFYA MAZINGIRA provides environmental decision support only. It does not provide medical advice. Model contributors are statistical signals, not causal claims."}
      </p>
    </div>
  );
}
