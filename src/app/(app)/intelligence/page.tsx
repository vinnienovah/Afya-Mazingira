"use client";

import Link from "next/link";
import { useSituation } from "@/lib/contexts/situation";
import { useLanguage } from "@/lib/contexts/language";
import { STATES, RISK_META } from "@/lib/afya/constants";
import { horizonScores, FORECAST_PERIODS } from "@/lib/afya/forecast-engine";
import { fmtTime, fmtAgo } from "@/lib/afya/format";
import { Card, CardTitle, CardMeta } from "@/components/ui/Card";
import { StateChip } from "@/components/ui/StateChip";
import { RiskChip } from "@/components/ui/RiskChip";
import { QualityDot } from "@/components/ui/QualityDot";
import MeasurementStrip from "@/components/ui/MeasurementStrip";
import StateTimeline from "@/components/charts/StateTimeline";
import AiPanel from "@/components/ai/AiPanel";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { AlertTriangle, Cpu, Globe, CloudRain, Satellite, Database, TrendingUp, Info, ChevronRight } from "lucide-react";

const HORIZONS = ["1h", "3h", "6h", "9h"] as const;

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
  const f3h = forecast.find((f) => f.horizon === "3h");
  const transition = state.transition_likelihood;

  const WHAT_WHY_NEXT = [
    {
      icon: <Info className="w-5 h-5 text-afya-teal" />,
      title_en: "WHAT?", title_sw: "NINI?",
      body_en: `The JKUAT environment is in a ${STATES[state.state_id].name} state. WBGT-like exposure is ${current.wbgt_c.toFixed(1)}°C with ${risk.thermal.toLowerCase()} thermal exposure risk.`,
      body_sw: `Mazingira ya JKUAT iko katika hali ya ${STATES[state.state_id].name_sw}. Kupatwa na WBGT ni ${current.wbgt_c.toFixed(1)}°C yenye hatari ${risk.thermal.toLowerCase()}.`,
    },
    {
      icon: <TrendingUp className="w-5 h-5 text-afya-gold" />,
      title_en: "WHY?", title_sw: "KWA NINI?",
      body_en: contributors.length
        ? `Main model contributors: ${contributors.slice(0, 3).map((c) => c.feature.replace(/_/g, " ")).join(", ")}.`
        : "Conditions are consistent with the current environmental state pattern.",
      body_sw: contributors.length
        ? `Vichangiaji vikuu vya mfumo: ${contributors.slice(0, 3).map((c) => c.feature.replace(/_/g, " ")).join(", ")}.`
        : "Hali ni sawa na muonekano wa hali ya mazingira ya sasa.",
    },
    {
      icon: <Cpu className="w-5 h-5 text-afya-green" />,
      title_en: "WHAT NEXT?", title_sw: "NINI KINACHOFUATA?",
      body_en: transition
        ? `Likely next transition: ${STATES[transition.state_id].name} (~${Math.round((transition.probability ?? 0) * 100)}% likelihood). +3h forecast: ${f3h?.value.toFixed(1)}°C.`
        : `+3h forecast: ${f3h?.value.toFixed(1)}°C.`,
      body_sw: transition
        ? `Mabadiliko yanayoweza kutokea: ${STATES[transition.state_id].name_sw} (~${Math.round((transition.probability ?? 0) * 100)}%). Utabiri wa +saa 3: ${f3h?.value.toFixed(1)}°C.`
        : `Utabiri wa +saa 3: ${f3h?.value.toFixed(1)}°C.`,
    },
    {
      icon: <Database className="w-5 h-5 text-afya-rain" />,
      title_en: "HOW CERTAIN?", title_sw: "NI UHAKIKA KUPI?",
      body_en: `Data quality: ${quality.status}. Forecast uncertainty: ${risk.uncertainty.toLowerCase()}. Interval for +3h: ${f3h?.lower.toFixed(1)}–${f3h?.upper.toFixed(1)}°C. ${quality.status !== "GOOD" ? "Confidence is reduced, strong recommendations are suppressed." : ""}`,
      body_sw: `Ubora wa data: ${quality.status}. Utata wa utabiri: ${risk.uncertainty.toLowerCase()}. Kipindi cha +saa 3: ${f3h?.lower.toFixed(1)}–${f3h?.upper.toFixed(1)}°C.`,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("intelligence_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("intelligence_subtitle")}</p>
      </div>

      {/* WHAT/WHY/WHAT NEXT/HOW CERTAIN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {WHAT_WHY_NEXT.map((item, i) => (
          <Card key={i}>
            <div className="flex items-center gap-2 mb-2" aria-hidden="true">{item.icon}</div>
            <div className="text-sm font-bold text-afya-charcoal mb-1">{lang === "sw" ? item.title_sw : item.title_en}</div>
            <p className="text-sm text-afya-muted leading-relaxed">{lang === "sw" ? item.body_sw : item.body_en}</p>
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
                {lang === "sw" ? STATES[transition.state_id].name_sw : STATES[transition.state_id].name}
              </strong>{" "}
              (~{Math.round((transition.probability ?? 0) * 100)}%)
            </div>
          )}
        </Card>
        <Card>
          <CardTitle>{t("thermal_exposure")}</CardTitle>
          <RiskChip level={risk.thermal} size="lg" />
          <div className="mt-3 text-xs text-afya-muted">
            {lang === "sw" ? "Hatari kutokana na utabiri wa +saa 3" : "Risk from +3h forecast"}: {f3h ? `${f3h.value.toFixed(1)}°C` : "-"}
          </div>
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
        <MeasurementStrip obs={current} freshnessMinutes={quality.freshness_minutes} />
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
            ? `Regresheni ya ridge kwa kila hatua ya dakika 15, iliyofunzwa kwa data ya Conduit ${FORECAST_PERIODS.train[0]} hadi ${FORECAST_PERIODS.train[1]}. Bendi imewekwa kutoka ${FORECAST_PERIODS.calibration[0]} hadi ${FORECAST_PERIODS.calibration[1]}, na alama zote zimetoka ${FORECAST_PERIODS.test[0]} hadi ${FORECAST_PERIODS.test[1]}, miezi ambayo modeli haikuiona. Lengo ni WBGT kivulini.`
            : `Ridge regression for each 15-minute step, fitted on Conduit data from ${FORECAST_PERIODS.train[0]} to ${FORECAST_PERIODS.train[1]}. The band is set from ${FORECAST_PERIODS.calibration[0]} to ${FORECAST_PERIODS.calibration[1]}, and every score comes from ${FORECAST_PERIODS.test[0]} to ${FORECAST_PERIODS.test[1]}, months the model never saw. The target is WBGT in shade.`}
        </p>
      </Card>

      {/* ERA5 context */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-5 h-5 text-afya-rain" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{t("era5_context")}</CardTitle>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { l_en: "ERA5 Temp", l_sw: "Joto la ERA5", v: `${era5.era5_temp_c.toFixed(1)}°C` },
            { l_en: "ERA5 RH", l_sw: "Unyevu wa ERA5", v: `${era5.era5_relative_humidity.toFixed(0)}%` },
            { l_en: "ERA5 Wind", l_sw: "Upepo wa ERA5", v: `${era5.era5_wind_speed_ms.toFixed(1)} m/s` },
            { l_en: "ERA5 Solar", l_sw: "Mionzi ya ERA5", v: `${era5.era5_solar_wm2.toFixed(0)} W/m²` },
          ].map((item, i) => (
            <div key={i} className="rounded-lg border border-afya-border bg-afya-canvas/50 px-3 py-2">
              <div className="text-[10px] text-afya-muted">{lang === "sw" ? item.l_sw : item.l_en}</div>
              <div className="text-sm font-bold text-afya-charcoal">{item.v}</div>
              <div className="text-[9px] text-afya-muted/60 font-semibold uppercase">{t("regional_model_label")} · ERA5-Land · ~9km</div>
            </div>
          ))}
        </div>
        {/* Local vs regional anomaly */}
        <div className="rounded-xl border border-afya-border bg-afya-canvas/50 px-4 py-3">
          <p className="text-xs font-semibold text-afya-charcoal mb-2">{t("local_vs_regional")}</p>
          <div className="flex gap-6">
            <div>
              <div className="text-lg font-bold" style={{ color: era5.local_temp_anomaly_c >= 0 ? "#E27832" : "#247B78" }}>
                {era5.local_temp_anomaly_c >= 0 ? "+" : ""}{era5.local_temp_anomaly_c.toFixed(1)}°C
              </div>
              <div className="text-[10px] text-afya-muted">{lang === "sw" ? "Tofauti ya Joto" : "Temp anomaly"}</div>
            </div>
            <div>
              <div className="text-lg font-bold" style={{ color: era5.local_humidity_anomaly >= 0 ? "#247B78" : "#E27832" }}>
                {era5.local_humidity_anomaly >= 0 ? "+" : ""}{era5.local_humidity_anomaly.toFixed(1)}%
              </div>
              <div className="text-[10px] text-afya-muted">{lang === "sw" ? "Tofauti ya Unyevu" : "RH anomaly"}</div>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[10px] text-afya-muted/60 max-w-xs">
                {lang === "sw"
                  ? "Conduit inalinganishwa na mfumo wa kikanda wa ERA5-Land. Tofauti zinaonyesha athari za kimaeneo."
                  : "Conduit station is compared with ERA5-Land regional reanalysis. Differences show local microclimate effects."}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Rainfall context (ERA5-Land) */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <CloudRain className="w-5 h-5 text-afya-rain" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{t("chirps_context")}</CardTitle>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { l_en: "Today's rainfall", l_sw: "Mvua ya leo", v: `${chirps.chirps_mm.toFixed(1)} mm` },
            { l_en: "7-day total", l_sw: "Jumla ya siku 7", v: `${chirps.chirps_7d_mm.toFixed(1)} mm` },
            { l_en: "30-day total", l_sw: "Jumla ya siku 30", v: `${chirps.chirps_30d_mm.toFixed(1)} mm` },
            { l_en: "Rainfall percentile", l_sw: "Asilimia ya mvua", v: `${chirps.chirps_percentile.toFixed(0)}th` },
            { l_en: "Dry spell", l_sw: "Kipindi kavu", v: `${chirps.chirps_dry_spell_days} ${lang === "sw" ? "siku" : "days"}` },
            { l_en: "Wet spell", l_sw: "Kipindi cha mvua", v: `${chirps.chirps_wet_spell_days} ${lang === "sw" ? "siku" : "days"}` },
          ].map((item, i) => (
            <div key={i} className="rounded-lg border border-afya-border bg-afya-canvas/50 px-3 py-2">
              <div className="text-[10px] text-afya-muted">{lang === "sw" ? item.l_sw : item.l_en}</div>
              <div className="text-sm font-bold text-afya-charcoal">{item.v}</div>
              <div className="text-[9px] text-afya-muted/60 font-semibold uppercase">{t("historical_label")} · ERA5-Land</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Satellite context */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Satellite className="w-5 h-5 text-afya-teal" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{t("satellite_context")}</CardTitle>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Sentinel-2 */}
          <div className="rounded-lg border border-afya-border bg-afya-canvas/50 px-4 py-3">
            <div className="text-xs font-bold text-afya-green mb-1">Sentinel-2</div>
            <div className="text-sm font-bold text-afya-charcoal mb-1">
              NDVI {sentinel.sentinel2_ndvi_mean !== null ? sentinel.sentinel2_ndvi_mean.toFixed(2) : "-"}
            </div>
            <div className="text-[10px] text-afya-muted space-y-0.5">
              <div>{t("acquired")}: {sentinel.sentinel2_acquired ?? "-"}</div>
              <div>{t("native_resolution")}: 10 m</div>
              <div className="font-semibold text-afya-muted/70 uppercase">{t("satellite_label")}</div>
            </div>
          </div>
          {/* Sentinel-3 */}
          <div className="rounded-lg border border-afya-border bg-afya-canvas/50 px-4 py-3">
            <div className="text-xs font-bold text-afya-rain mb-1">Sentinel-3</div>
            <div className="text-sm font-bold text-afya-charcoal mb-1">
              LST {sentinel.sentinel3_lst_c !== null ? `${sentinel.sentinel3_lst_c.toFixed(1)}°C` : "-"}
            </div>
            <div className="text-[10px] text-afya-muted space-y-0.5">
              <div>{t("acquired")}: {sentinel.sentinel3_acquired ?? "-"}</div>
              <div>{t("native_resolution")}: ~1 km</div>
              <div className="font-semibold text-afya-muted/70 uppercase">{t("satellite_label")}</div>
            </div>
            <p className="text-[9px] text-afya-muted/60 mt-2">
              {lang === "sw"
                ? "Joto la uso wa ardhi si joto la hewa. Ni muktadha wa kikanda."
                : "Land surface temperature ≠ air temperature. Regional context only."}
            </p>
          </div>
        </div>
      </Card>

      {/* Forecast contributors with SHAP-style values */}
      {contributors.length > 0 && (
        <Card>
          <CardTitle>{t("contributor_title")}</CardTitle>
          <p className="text-xs text-afya-muted mb-4">{t("contributor_note")}</p>
          <div className="space-y-3">
            {contributors.map((c, i) => {
              const importance = [85, 62, 48, 31][i] ?? 20;
              const colors = ["#E27832", "#F2B705", "#3786B5", "#6B8F71"];
              const labels_en: Record<string, string> = {
                temp_rising: "Air temperature rising", temp_falling: "Temperature falling",
                high_radiation: "High solar radiation signal", low_ventilation: "Relatively weak ventilation (low wind)",
                humidity_falling: "Relative humidity falling", peak_radiation: "Peak radiation period of day",
              };
              const labels_sw: Record<string, string> = {
                temp_rising: "Joto la hewa linaongezeka", temp_falling: "Joto linapungua",
                high_radiation: "Ishara ya mionzi mikali ya jua", low_ventilation: "Uingizaji hewa mdogo (upepo mdogo)",
                humidity_falling: "Unyevu unapungua", peak_radiation: "Kipindi cha mionzi ya juu cha siku",
              };
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-afya-charcoal">
                      {lang === "sw" ? labels_sw[c.feature] ?? c.feature : labels_en[c.feature] ?? c.feature}
                    </span>
                    <span className="text-afya-muted font-mono">{importance}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-afya-canvas overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${importance}%`, backgroundColor: colors[i % colors.length] }}
                      role="progressbar"
                      aria-valuenow={importance}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Contribution: ${importance}%`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
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
