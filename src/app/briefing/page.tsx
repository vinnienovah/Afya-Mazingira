import type { Metadata } from "next";
import { cookies } from "next/headers";
import { runPipeline } from "@/lib/afya/pipeline";
import { t as tr } from "@/lib/afya/i18n";
import { STATES } from "@/lib/afya/constants";
import { fill, fmtAsOf, fmtTime, fmtWindow, fmtDate, fmtAgo, fmtDayMonth, fmtSigned } from "@/lib/afya/format";
import {
  activityName, contributionBars, contributorLabel, currentBand, nextStateNote, rainWindows,
} from "@/lib/afya/display";
import { ACTIVITY_COOKIE, parseActivityKey } from "@/lib/preferred-activity";
import type { Lang } from "@/lib/afya/types";
import { StateChip } from "@/components/ui/StateChip";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline, Vercel's default function timeout is short.
export const maxDuration = 30;
import { RiskChip } from "@/components/ui/RiskChip";
import BriefingActions from "@/components/briefing/BriefingActions";
import {
  Radio, Wind, Satellite, CloudRain, AlertTriangle,
  TrendingUp, CheckCircle2, Globe,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Environmental Briefing",
  description:
    "One-page printable operational summary of the current JKUAT/Juja environmental situation, forecast, Best-Time window and data provenance.",
};

// Live pipeline on every request, the briefing is a live document.
export const dynamic = "force-dynamic";

export default async function BriefingPage() {
  const cookieStore = await cookies();
  const lang: Lang = cookieStore.get("afya_lang")?.value === "sw" ? "sw" : "en";
  const t = (k: string) => tr(lang, k);

  // Plan the window for the same default activity as the Situation page.
  const activity = parseActivityKey(cookieStore.get(ACTIVITY_COOKIE)?.value);
  const situation = await runPipeline(activity ? { activityKey: activity } : {});
  const {
    state, current, forecast, quality, risk, best_time,
    expected_peak, state_history_24h, contributors,
    era5, chirps, sentinel, data_source,
  } = situation;

  const transition = state.transition_likelihood;
  const dataTime = situation.generated_at;
  const renderedAt = new Date().toISOString();
  const nowBand = currentBand(situation);
  const bars = contributionBars(contributors);
  const rain = rainWindows(chirps);
  const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

  const f1h = forecast.find((f) => f.horizon === "1h");
  const f3h = forecast.find((f) => f.horizon === "3h");
  const f6h = forecast.find((f) => f.horizon === "6h");
  const f9h = forecast.find((f) => f.horizon === "9h");

  // ERA5 runs days behind, so each regional figure carries the time it is for.
  const era5Ok = era5.available !== false && num(era5.era5_temp_c);
  const rainOk = chirps.available !== false && num(chirps.chirps_7d_mm) && num(chirps.chirps_30d_mm);
  const provenance = [
    {
      name: "Conduit · JKUAT/Juja",
      tag: t("measured_label"),
      detail: `${t("updated_ago")} · ${fmtAgo(quality.freshness_minutes, lang)}`,
      color: "#006B3C",
      icon: <Radio className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      name: "ERA5",
      tag: t("regional_model_label"),
      detail: era5Ok
        ? [
            `${era5.era5_temp_c.toFixed(1)}°C`,
            num(era5.local_temp_anomaly_c) ? `${t("local_vs_regional")} ${fmtSigned(era5.local_temp_anomaly_c)}°C` : null,
            era5.valid_time ? fill(t("era5_valid"), { time: fmtAsOf(era5.valid_time, lang, Date.parse(renderedAt)) }) : null,
          ].filter(Boolean).join(" · ")
        : t("context_unavailable"),
      color: "#3786B5",
      icon: <Wind className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      name: lang === "sw" ? "Mvua ya ERA5" : "ERA5 rainfall",
      tag: t("historical_label"),
      detail: rainOk
        ? `${chirps.chirps_7d_mm.toFixed(1)} mm · ${fill(t("rain_days_to"), { days: 7, day: fmtDayMonth(rain.week.to, lang) })} · ${chirps.chirps_30d_mm.toFixed(1)} mm · ${fill(t("rain_days_to"), { days: 30, day: fmtDayMonth(rain.month.to, lang) })}`
        : t("context_unavailable"),
      color: "#247B78",
      icon: <CloudRain className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      name: "Sentinel-2 / Sentinel-3",
      tag: t("satellite_label"),
      detail: `${sentinel.sentinel2_acquired ? fmtDate(sentinel.sentinel2_acquired) : "-"} · ${sentinel.sentinel3_acquired ? fmtDate(sentinel.sentinel3_acquired) : "-"}`,
      color: "#68756F",
      icon: <Satellite className="h-4 w-4" strokeWidth={1.8} />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#e9e8e3] px-3 py-6 sm:px-6">
      <BriefingActions backLabel={t("briefing_back")} printLabel={t("briefing_print")} />

      <article className="briefing-page mx-auto max-w-3xl overflow-hidden rounded-xl border border-afya-border bg-white shadow-lg">

        {/* Header band */}
        <header
          className="print-avoid-break px-7 py-6 text-white"
          style={{ background: "linear-gradient(135deg, #103D2C 0%, #0B2E20 100%)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-afya-green" aria-hidden="true">
                <Globe className="h-5 w-5 text-white" strokeWidth={1.6} />
              </span>
              <div>
                <h1 className="text-lg font-bold leading-tight">{t("briefing_title")}</h1>
                <p className="text-xs text-white/60">{t("briefing_sub")} · AFYA MAZINGIRA</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold">{t("location")}</p>
              <p className="text-xs text-white/60">
                {t("data_as_of")} {fmtDate(dataTime)} · {fmtTime(dataTime)} EAT
              </p>
              <p className="mt-1 text-[10px] font-bold tracking-wide">
                {data_source === "DEMO" && <span className="text-afya-gold">{t("demo_mode")}</span>}
                {data_source === "CONDUIT_ARCHIVE" && <span className="text-[#247B78]">{t("conduit_archive_badge")}</span>}
                {data_source === "CONDUIT_LIVE" && <span className="text-afya-green">{t("conduit_live_badge")}</span>}
              </p>
            </div>
          </div>
        </header>

        {/* Situation summary */}
        <section aria-label={t("current_state")} className="print-avoid-break flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-afya-border px-7 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-afya-muted">{t("environmental_state")}</p>
            <div className="mt-2 flex items-center gap-2.5">
              <StateChip stateId={state.state_id as 0 | 1 | 2 | 3} size="lg" />
            </div>
          </div>
          <div className="ml-auto" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-afya-muted">{t("thermal_exposure")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RiskChip level={nowBand} size="md" />
              <span className="text-xs tabular-nums text-afya-muted">{t("wbgt_now")}: {current.wbgt_c.toFixed(1)}°C</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-afya-muted">
              {t("horizon_3h_short")}
              <RiskChip level={risk.thermal} size="sm" />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-afya-muted">{t("data_quality")}</p>
            <p className="mt-2 text-lg font-bold text-afya-charcoal">
              {quality.status === "GOOD" ? t("quality_good") : quality.status === "DEGRADED" ? t("quality_degraded") : t("quality_poor")}
            </p>
          </div>
        </section>

        {/* Key metrics */}
        <section className="print-avoid-break grid grid-cols-2 gap-px bg-afya-border/60 sm:grid-cols-4" aria-label={t("what_happening")}>
          {[
            {
              en: "Expected peak", sw: "Kilele kinachotarajiwa",
              value: expected_peak ? fmtTime(expected_peak.time) : "-",
              sub: expected_peak ? `${expected_peak.wbgt_c.toFixed(1)}°C WBGT` : "-",
            },
            {
              en: "+3h forecast", sw: "Utabiri +saa 3",
              value: f3h ? `${f3h.value.toFixed(1)}°C` : "-",
              sub: f3h ? `${f3h.lower.toFixed(1)}–${f3h.upper.toFixed(1)}°C` : "-",
            },
            {
              en: t("next_transition"), sw: t("next_transition"),
              value: transition ? (lang === "sw" ? STATES[transition.state_id].name_sw : STATES[transition.state_id].name) : "-",
              sub: nextStateNote(transition, lang) ?? "-",
            },
            {
              en: "Current WBGT", sw: "WBGT ya sasa",
              value: `${current.wbgt_c.toFixed(1)}°C`,
              sub: `${current.temperature_c.toFixed(1)}°C · ${current.humidity_pct.toFixed(0)}% RH`,
            },
          ].map((m) => (
            <div key={m.en} className="bg-white px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-afya-muted">
                {lang === "sw" ? m.sw : m.en}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-afya-charcoal">{m.value}</p>
              <p className="text-xs tabular-nums text-afya-muted">{m.sub}</p>
            </div>
          ))}
        </section>

        {/* Best window */}
        {quality.status !== "POOR" && best_time && (
          <section aria-label={t("best_window")} className="print-avoid-break border-y border-afya-border px-7 py-5" style={{ borderLeft: "6px solid #F2B705" }}>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-afya-muted">{t("best_window_result")}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-afya-charcoal">
              {fmtWindow(best_time.recommended.start, best_time.recommended.end)}
            </p>
            <p className="mt-1 text-sm text-afya-muted">
              {fill(t("window_for_activity"), {
                minutes: best_time.duration_minutes,
                activity: activityName(best_time.activity, lang),
              })}
            </p>
            {best_time.alternative && (
              <p className="mt-1 text-sm text-afya-muted">
                {t("alternative_window")}: <span className="font-semibold tabular-nums">{fmtWindow(best_time.alternative.start, best_time.alternative.end)}</span>
              </p>
            )}
            <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {best_time.recommended.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2 text-sm text-afya-charcoal">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-afya-green" strokeWidth={2} aria-hidden="true" />
                  {t(r)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {quality.status === "POOR" && (
          <div className="print-avoid-break flex items-start gap-3 border-y border-afya-red/30 bg-afya-red/5 px-7 py-4" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-afya-red" strokeWidth={1.8} aria-hidden="true" />
            <p className="text-sm text-afya-charcoal">{t("quality_poor_message")}</p>
          </div>
        )}

        {/* Forecast table */}
        <section aria-label={t("view_forecast")} className="print-avoid-break px-7 py-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-afya-muted">{t("forecast_title")}</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-afya-border text-left text-[10px] uppercase tracking-wide text-afya-muted">
                <th className="pb-2 pr-3 font-semibold">{lang === "sw" ? "Kipindi" : "Horizon"}</th>
                <th className="pb-2 pr-3 font-semibold">{t("model")}</th>
                <th className="pb-2 pr-3 font-semibold">WBGT</th>
                <th className="pb-2 font-semibold">{t("uncertainty")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-afya-border/50">
              {[
                { f: f1h, label: t("horizon_1h") },
                { f: f3h, label: t("horizon_3h") },
                { f: f6h, label: t("horizon_6h") },
                { f: f9h, label: t("horizon_9h") },
              ].filter((r) => r.f).map((r) => (
                <tr key={r.label} className="text-afya-charcoal">
                  <td className="py-2.5 pr-3 font-medium">{r.label}</td>
                  <td className="py-2.5 pr-3 text-afya-muted">{r.f!.model}</td>
                  <td className="py-2.5 pr-3 font-bold tabular-nums">{r.f!.value.toFixed(1)}°C</td>
                  <td className="py-2.5 tabular-nums text-afya-muted">{r.f!.lower.toFixed(1)}–{r.f!.upper.toFixed(1)}°C</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* State strip */}
        <section aria-label={t("state_timeline")} className="print-avoid-break border-t border-afya-border px-7 py-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-afya-muted">{t("state_timeline")}</h2>
          <div className="mt-3 flex h-7 overflow-hidden rounded-lg border border-afya-border" role="img" aria-label={t("state_timeline")}>
            {state_history_24h.map((seg, i) => {
              const meta = STATES[seg.state_id];
              return (
                <div
                  key={i}
                  className="h-full"
                  style={{
                    background: meta.color,
                    flexGrow: Math.max(1, new Date(seg.end).getTime() - new Date(seg.start).getTime()),
                    opacity: 0.85,
                  }}
                />
              );
            })}
          </div>
          <ul className="mt-3 space-y-1">
            {state_history_24h.map((seg, i) => {
              const meta = STATES[seg.state_id];
              return (
                <li key={i} className="flex items-baseline gap-2 text-xs">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.color }} aria-hidden="true" />
                  <span className="font-medium text-afya-charcoal">{lang === "sw" ? meta.name_sw : meta.name}</span>
                  <span className="tabular-nums text-afya-muted">{fmtTime(seg.start)}–{fmtTime(seg.end)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Contributors + Measurements */}
        <section className="print-avoid-break grid gap-px border-t border-afya-border bg-afya-border/60 sm:grid-cols-2">
          <div className="bg-white px-7 py-5">
            <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-afya-muted">{t("contributor_title")}</h2>
            <ul className="mt-3 space-y-1.5">
              {contributors.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-afya-charcoal">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-afya-gold" strokeWidth={2} aria-hidden="true" />
                  <span className="flex-1">{contributorLabel(c.feature, lang)}</span>
                  {bars && <span className="tabular-nums text-afya-muted">{fmtSigned(bars[i].value_c, 2)}°C</span>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] italic text-afya-muted">
              {bars ? t("contributor_values_note") : t("contributor_list_note")}
            </p>
          </div>
          <div className="bg-white px-7 py-5">
            <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-afya-muted">{t("technical_measurements")}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {[
                [lang === "sw" ? "Joto" : "Temperature", `${current.temperature_c.toFixed(1)}°C`],
                [lang === "sw" ? "Unyevu" : "Humidity", `${current.humidity_pct.toFixed(0)}%`],
                [lang === "sw" ? "Upepo" : "Wind", `${current.wind_speed_ms.toFixed(1)} m/s`],
                [lang === "sw" ? "Shinikizo" : "Pressure", `${current.pressure_hpa.toFixed(0)} hPa`],
                [lang === "sw" ? "Mionzi" : "IR signal", `${Math.round(current.infrared_signal)}`],
                [lang === "sw" ? "Bulbu Iliyonyevunyevu" : "Wet bulb", `${current.wet_bulb_c.toFixed(1)}°C`],
                ["WBGT", `${current.wbgt_c.toFixed(1)}°C`],
                [lang === "sw" ? "Mvua" : "Rain", current.rain_observed ? (lang === "sw" ? "Ndiyo" : "Yes") : (lang === "sw" ? "Hapana" : "No")],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-2">
                  <dt className="text-afya-muted">{k}</dt>
                  <dd className="font-semibold tabular-nums text-afya-charcoal">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Provenance */}
        <section aria-label={t("data_sources")} className="print-avoid-break border-t border-afya-border px-7 py-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-afya-muted">{t("data_sources")}</h2>
          <ul className="mt-3 space-y-2">
            {provenance.map((p) => (
              <li key={p.name} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${p.color}16`, color: p.color }} aria-hidden="true">
                  {p.icon}
                </span>
                <span className="text-sm font-semibold text-afya-charcoal">{p.name}</span>
                <span className="rounded-full border border-afya-border bg-afya-canvas px-2 py-0.5 text-[9px] font-bold tracking-wide text-afya-muted">{p.tag}</span>
                <span className="ml-auto text-xs tabular-nums text-afya-muted">{p.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Footer */}
        <footer className="border-t border-afya-border bg-afya-canvas/60 px-7 py-4">
          <p className="text-[10px] leading-relaxed text-afya-muted">{t("about_disclaimer")}</p>
          <p className="mt-1 text-[10px] text-afya-muted/70">
            {t("briefing_generated")} {fmtDate(renderedAt)} {fmtTime(renderedAt)} EAT · AFYA MAZINGIRA · {t("location")}
          </p>
        </footer>
      </article>
    </div>
  );
}
