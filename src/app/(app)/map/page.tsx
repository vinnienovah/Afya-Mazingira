"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/language";
import { useSituation } from "@/lib/contexts/situation";
import { RISK_META } from "@/lib/afya/constants";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { StateChip } from "@/components/ui/StateChip";
import { RiskChip } from "@/components/ui/RiskChip";
import {
  X, ChevronRight, ChevronLeft, Play, Pause, Info,
  Layers, Radio, Thermometer, Droplets, Leaf, Mountain,
} from "lucide-react";
import type { CountyFeature, SatelliteAcquisition } from "@/lib/afya/map-data";
import type { MapLayerKey } from "@/components/map/CountyLeafletMap";
import { cn } from "@/lib/utils";
import type { FeatureCollection, Geometry } from "geojson";

// Leaflet touches `window`, so it must never render on the server.
const CountyLeafletMap = dynamic(() => import("@/components/map/CountyLeafletMap"), {
  ssr: false,
  loading: () => <Skeleton className="w-full" />,
});

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type MapMode = "summary" | "surface";

const LAYER_META: { key: MapLayerKey; icon: React.ReactNode; label_en: string; label_sw: string }[] = [
  { key: "outlook",    icon: <Layers className="w-4 h-4" />,      label_en: "Environmental Outlook", label_sw: "Muonekano wa Mazingira" },
  { key: "thermal",    icon: <Thermometer className="w-4 h-4" />, label_en: "Thermal Context",       label_sw: "Muktadha wa Joto" },
  { key: "rain",       icon: <Droplets className="w-4 h-4" />,    label_en: "Rain Context",          label_sw: "Muktadha wa Mvua" },
  { key: "vegetation", icon: <Leaf className="w-4 h-4" />,        label_en: "Vegetation Context",    label_sw: "Muktadha wa Mimea" },
  { key: "lst",        icon: <Mountain className="w-4 h-4" />,    label_en: "Land Surface Temp",     label_sw: "Joto la Uso wa Ardhi" },
];

const TIMES = ["09:00", "12:00", "15:00", "18:00"];

export default function MapPage() {
  const { t, lang } = useLanguage();
  const { situation } = useSituation();
  const { data, isLoading } = useSWR("/api/map", fetcher);
  const { data: boundaries } = useSWR<FeatureCollection<Geometry, { name: string; code?: number }>>(
    "/geo/counties.geojson", fetcher,
  );

  const [mode, setMode] = useState<MapMode>("summary");
  const [layer, setLayer] = useState<MapLayerKey>("outlook");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [timeIdx, setTimeIdx] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [satIdx, setSatIdx] = useState(0);
  const [showSatTimeline, setShowSatTimeline] = useState(false);

  const counties: CountyFeature[] = useMemo(() => data?.counties?.features ?? [], [data]);
  const satellites: SatelliteAcquisition[] = data?.satellites ?? [];

  // Indicator lookup keyed by county name (boundaries are authoritative geometry)
  const indicators = useMemo(() => {
    const m: Record<string, CountyFeature["properties"]> = {};
    for (const c of counties) m[c.properties.name] = c.properties;
    return m;
  }, [counties]);

  const selectedCounty = selectedName ? indicators[selectedName] ?? null : null;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTimeIdx((i) => (i + 1) % TIMES.length), 1800);
    return () => clearInterval(id);
  }, [playing]);

  const currentTime = TIMES[timeIdx];
  const sat = satellites[satIdx];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-afya-charcoal">{t("map_title")}</h1>
          <p className="text-sm text-afya-muted mt-0.5">{t("map_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-afya-muted">
          <Radio
            className={cn("w-3.5 h-3.5", situation?.data_source === "CONDUIT_LIVE" ? "text-afya-green live-pulse" : "text-[#247B78]")}
            aria-hidden="true"
          />
          {t("conduit_stations")} · JKUAT
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center rounded-xl border border-afya-border bg-white overflow-hidden text-xs font-semibold">
          <button
            onClick={() => setMode("summary")}
            aria-pressed={mode === "summary"}
            className={cn("px-4 py-2.5 transition-colors", mode === "summary" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal")}
          >
            {t("county_summary")}
          </button>
          <button
            onClick={() => setMode("surface")}
            aria-pressed={mode === "surface"}
            className={cn("px-4 py-2.5 transition-colors", mode === "surface" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal")}
          >
            {t("environmental_surface")}
          </button>
        </div>

        <div className="rounded-xl border border-afya-border bg-white p-1 flex gap-0.5 flex-wrap">
          {LAYER_META.map((lm) => (
            <button
              key={lm.key}
              onClick={() => setLayer(lm.key)}
              aria-pressed={layer === lm.key}
              title={lang === "sw" ? lm.label_sw : lm.label_en}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                layer === lm.key ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal hover:bg-afya-canvas",
              )}
            >
              {lm.icon}
              <span className="hidden sm:inline">{lang === "sw" ? lm.label_sw : lm.label_en}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* MAP */}
        <div className="lg:col-span-2 space-y-3">
          <Card padding={false} className="overflow-hidden">
            {/* Time controls */}
            <div className="flex items-center gap-3 px-4 pt-3.5 pb-3 border-b border-afya-border">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setTimeIdx((i) => Math.max(0, i - 1))}
                  disabled={timeIdx === 0}
                  className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-canvas disabled:opacity-30 transition-colors"
                  aria-label="Previous time step"
                >
                  <ChevronLeft className="w-4 h-4" strokeWidth={2} />
                </button>
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-canvas transition-colors"
                  aria-label={playing ? t("pause") : t("play")}
                  aria-pressed={playing}
                >
                  {playing ? <Pause className="w-4 h-4" strokeWidth={2} /> : <Play className="w-4 h-4" strokeWidth={2} />}
                </button>
                <button
                  onClick={() => setTimeIdx((i) => Math.min(TIMES.length - 1, i + 1))}
                  disabled={timeIdx === TIMES.length - 1}
                  className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-canvas disabled:opacity-30 transition-colors"
                  aria-label="Next time step"
                >
                  <ChevronRight className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <div className="flex-1 flex justify-around">
                {TIMES.map((time, i) => (
                  <button
                    key={time}
                    onClick={() => { setTimeIdx(i); setPlaying(false); }}
                    aria-pressed={timeIdx === i}
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-bold transition-colors",
                      timeIdx === i ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal",
                    )}
                  >
                    {time}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-afya-muted font-mono">{currentTime} EAT</span>
            </div>

            {/* Leaflet map */}
            <div className="relative">
              {isLoading || !boundaries ? (
                <Skeleton className="w-full" />
              ) : (
                <CountyLeafletMap
                  boundaries={boundaries}
                  indicators={indicators}
                  layer={layer}
                  mode={mode}
                  timeIdx={timeIdx}
                  selectedCounty={selectedName}
                  onSelectCounty={setSelectedName}
                  onSelectStation={() => setSelectedName(null)}
                  stationLabel={t("jkuat_station")}
                  stationSubLabel={t("ground_measurement")}
                  lang={lang}
                />
              )}

              {/* Legend overlay */}
              <div className="absolute bottom-4 left-4 z-[500] rounded-xl bg-white/95 border border-afya-border px-3 py-2 backdrop-blur-sm shadow-sm">
                {layer === "outlook" && (
                  <div className="flex flex-col gap-1">
                    {(["LOW", "ELEVATED", "HIGH", "VERY_HIGH"] as const).map((lv) => (
                      <div key={lv} className="flex items-center gap-1.5 text-[10px] font-semibold text-afya-charcoal">
                        <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: RISK_META[lv].color }} aria-hidden="true" />
                        {lang === "sw" ? RISK_META[lv].sw : RISK_META[lv].en}
                      </div>
                    ))}
                  </div>
                )}
                {layer === "rain" && (
                  <div className="flex flex-col gap-1">
                    {[["#EAF4FA","< 0.5 mm"],["#93C5FD","0.5–2 mm"],["#3786B5","2–6 mm"],["#1E5A8A","6–12 mm"],["#0F3A5C","> 12 mm"]].map(([c, l]) => (
                      <div key={l} className="flex items-center gap-1.5 text-[10px] font-semibold text-afya-charcoal">
                        <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} aria-hidden="true" />{l}
                      </div>
                    ))}
                  </div>
                )}
                {layer === "vegetation" && (
                  <div className="flex flex-col gap-1">
                    {[["#D4B896","NDVI < 0.2"],["#A8C686","0.2–0.35"],["#5B9E6B","0.35–0.5"],["#1A6B3C","0.5–0.65"],["#0D4625","> 0.65"]].map(([c, l]) => (
                      <div key={l} className="flex items-center gap-1.5 text-[10px] font-semibold text-afya-charcoal">
                        <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} aria-hidden="true" />{l}
                      </div>
                    ))}
                  </div>
                )}
                {(layer === "thermal" || layer === "lst") && (
                  <div className="flex flex-col gap-1">
                    {[["#DBEAFE","< 28°C"],["#93C5FD","28–31°C"],["#F2B705","31–34°C"],["#E27832","34–37°C"],["#C62828","> 37°C"]].map(([c, l]) => (
                      <div key={l} className="flex items-center gap-1.5 text-[10px] font-semibold text-afya-charcoal">
                        <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} aria-hidden="true" />{l}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Provenance footer */}
            <div className="px-4 py-2.5 border-t border-afya-border flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-[10px] text-afya-muted flex items-center gap-1">
                <span
                  className={cn(
                    "w-2.5 h-2.5 rounded-full inline-block",
                    situation?.data_source === "CONDUIT_LIVE" ? "bg-afya-green live-pulse" : "bg-[#247B78]",
                  )}
                  aria-hidden="true"
                />
                Conduit · {t("measured_label")} · JKUAT
              </span>
              <span className="text-[10px] text-afya-muted">ERA5-Land · {t("regional_model_label")} · ~9km</span>
              <span className="text-[10px] text-afya-muted">ERA5-Land · {t("historical_label")}</span>
              <span className="text-[10px] text-afya-muted/70 ml-auto">{t("map_boundaries_note")}</span>
            </div>
          </Card>

          {/* Satellite acquisition timeline */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <CardTitle className="mb-0">{t("satellite_context")}</CardTitle>
              <button
                onClick={() => setShowSatTimeline((v) => !v)}
                className="text-xs text-afya-muted hover:text-afya-charcoal flex items-center gap-1"
                aria-expanded={showSatTimeline}
              >
                <Info className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
                {showSatTimeline ? t("hide_technical") : t("details")}
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSatIdx((i) => Math.max(0, i - 1))}
                disabled={satIdx === 0}
                className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-canvas disabled:opacity-30 shrink-0"
                aria-label="Previous acquisition"
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              </button>
              <div className="flex gap-2 flex-1">
                {satellites.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setSatIdx(i)}
                    aria-pressed={satIdx === i}
                    className={cn(
                      "flex-1 min-w-[100px] rounded-xl border px-3 py-2.5 text-left transition-all shrink-0",
                      satIdx === i ? "border-afya-green bg-afya-green/8" : "border-afya-border hover:border-afya-green/40",
                    )}
                  >
                    <div className={cn("text-[10px] font-bold uppercase tracking-wide mb-0.5", s.sensor === "Sentinel-2" ? "text-afya-green" : "text-afya-rain")}>
                      {s.sensor}
                    </div>
                    <div className="text-xs font-semibold text-afya-charcoal">{s.label}</div>
                    <div className="text-[10px] text-afya-muted mt-0.5">{s.acquired}</div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setSatIdx((i) => Math.min(satellites.length - 1, i + 1))}
                disabled={satIdx === satellites.length - 1}
                className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-canvas disabled:opacity-30 shrink-0"
                aria-label="Next acquisition"
              >
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>

            {sat && showSatTimeline && (
              <div className="mt-3 rounded-xl border border-afya-border bg-afya-canvas/50 px-4 py-3 space-y-1">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div><span className="text-afya-muted">{t("acquired")}: </span><span className="font-semibold text-afya-charcoal">{sat.acquired}</span></div>
                  <div><span className="text-afya-muted">{t("native_resolution")}: </span><span className="font-semibold text-afya-charcoal">{sat.resolution}</span></div>
                  <div><span className="text-afya-muted">{t("satellite_label")}: </span><span className="font-semibold text-afya-charcoal">{sat.sensor}</span></div>
                </div>
                <p className="text-[10px] text-afya-muted/70 pt-1">
                  {lang === "sw"
                    ? "Data ya sayeti inaonyesha wakati halisi wa uchukuzi, si uchunguzi wa muda usioishia."
                    : "Satellite layers show actual acquisition times only, not continuous observations between acquisitions."}
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* SIDE PANEL */}
        <div className="space-y-4">
          {selectedCounty ? (
            <CountyPanel county={selectedCounty} onClose={() => setSelectedName(null)} lang={lang} t={t} />
          ) : (
            <StationPanel situation={situation} t={t} />
          )}

          <Card>
            <CardTitle>{t("explain_outlook")}</CardTitle>
            <p className="text-xs text-afya-muted mb-3">
              {lang === "sw"
                ? "Uliza swali kuhusu muonekano wa kikanda huu kwa Kiingereza au Kiswahili."
                : "Ask about the regional outlook in English or Kiswahili."}
            </p>
            <ExplainOutlookWidget lang={lang} t={t} county={selectedName} />
          </Card>
        </div>
      </div>
    </div>
  );
}

// County detail panel
function CountyPanel({
  county, onClose, lang, t,
}: {
  county: CountyFeature["properties"]; onClose: () => void; lang: string; t: (k: string) => string;
}) {
  const p = county;
  const hasGround = p.sources.includes("Conduit station");
  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-bold text-afya-charcoal text-base">{p.name}</h3>
          <p className="text-xs text-afya-muted">{t("county_outlook")}</p>
        </div>
        <button onClick={onClose} aria-label={t("close")} className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-canvas">
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      <div
        className={cn(
          "mb-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide",
          hasGround ? "border-afya-green/40 bg-afya-green/8 text-afya-green" : "border-[#247B78]/40 bg-[#247B78]/8 text-[#247B78]",
        )}
      >
        <span className={cn("w-1.5 h-1.5 rounded-full", hasGround ? "bg-afya-green" : "bg-[#247B78]")} aria-hidden="true" />
        {hasGround ? t("ground_regional_intelligence") : t("regional_intelligence")}
      </div>
      <p className="text-[10px] text-afya-muted/70 mb-3 -mt-2">
        {hasGround ? t("ground_regional_sub") : t("regional_intelligence_sub")}
      </p>

      <RiskChip level={p.outlook_category} size="md" />

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-[11px] font-semibold text-afya-muted mb-2 uppercase tracking-wide">{t("outlook")}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {p.outlook_hours.map((h) => (
              <div key={h.hour} className="text-center">
                <div className="text-[9px] text-afya-muted">{h.hour}</div>
                <div
                  className="mt-1 rounded-lg px-1 py-1 text-[9px] font-bold text-white"
                  style={{ backgroundColor: RISK_META[h.category as keyof typeof RISK_META]?.color ?? "#aaa" }}
                >
                  {lang === "sw" ? RISK_META[h.category as keyof typeof RISK_META]?.sw : RISK_META[h.category as keyof typeof RISK_META]?.en}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { l_en: "Temp Anomaly", l_sw: "Tofauti ya Joto", v: `${p.temperature_anomaly_c >= 0 ? "+" : ""}${p.temperature_anomaly_c}°C` },
            { l_en: "Rain 24h", l_sw: "Mvua saa 24", v: `${p.rain_24h_mm} mm` },
            { l_en: "Soil Moisture", l_sw: "Unyevu wa Udongo", v: `${(p.soil_moisture * 100).toFixed(0)}%` },
            { l_en: "NDVI", l_sw: "NDVI", v: p.ndvi_mean !== null ? p.ndvi_mean.toFixed(2) : "-" },
            { l_en: "LST", l_sw: "Joto la Uso", v: p.lst_c !== null ? `${p.lst_c.toFixed(1)}°C` : "-" },
            { l_en: "Confidence", l_sw: "Uhakika", v: p.confidence },
          ].map((ind, i) => (
            <div key={i} className="rounded-lg border border-afya-border bg-afya-canvas/50 px-2.5 py-2">
              <div className="text-[9px] text-afya-muted">{lang === "sw" ? ind.l_sw : ind.l_en}</div>
              <div className="text-sm font-bold text-afya-charcoal mt-0.5 tabular-nums">{ind.v}</div>
            </div>
          ))}
        </div>

        <div>
          <p className="text-[10px] font-bold text-afya-muted uppercase tracking-wide mb-1.5">{t("data_sources")}</p>
          <div className="flex flex-wrap gap-1.5">
            {p.sources.map((s) => (
              <span key={s} className="rounded-full border border-afya-border px-2 py-0.5 text-[10px] font-semibold text-afya-muted">{s}</span>
            ))}
            <span className="rounded-full border border-afya-border px-2 py-0.5 text-[10px] font-semibold text-afya-muted">{t("regional_model_label")}</span>
          </div>
        </div>

        <p className="text-[9px] text-afya-muted/70 leading-relaxed">
          {lang === "sw"
            ? "Muonekano wa kikanda unatokana na data za ERA5-Land, ikiwemo mvua yake. Si kipimo kutoka Conduit moja."
            : "County outlook is derived from ERA5-Land reanalysis, including its rainfall. It is not a Conduit measurement."}
        </p>
      </div>
    </Card>
  );
}

// Conduit station panel
function StationPanel({
  situation, t,
}: {
  situation: ReturnType<typeof import("@/lib/contexts/situation").useSituation>["situation"];
  t: (k: string) => string;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <span
          className={cn(
            "w-3 h-3 rounded-full shrink-0",
            situation?.data_source === "CONDUIT_LIVE" ? "bg-afya-green live-pulse" : "bg-[#247B78]",
          )}
          aria-hidden="true"
        />
        <div>
          <h3 className="font-bold text-afya-charcoal text-sm">{t("jkuat_station")}</h3>
          <p className="text-[10px] text-afya-muted">{t("ground_measurement")} · {t("measured_label")}</p>
        </div>
      </div>
      {situation ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-afya-muted">{t("environmental_state")}</span>
            <StateChip stateId={situation.state.state_id} size="sm" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-afya-muted">{t("thermal_exposure")}</span>
            <RiskChip level={situation.risk.thermal} size="sm" />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-afya-muted">{t("expected_peak")}</span>
            <span className="font-bold text-afya-charcoal tabular-nums">
              {situation.expected_peak ? `${situation.expected_peak.wbgt_c.toFixed(1)}°C` : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-afya-muted">{t("horizon_3h")}</span>
            <span className="font-bold text-afya-charcoal tabular-nums">
              {situation.forecast[1] ? `${situation.forecast[1].value.toFixed(1)}°C` : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-afya-muted">{t("data_quality")}</span>
            <span className="font-semibold text-afya-green">{situation.quality.status}</span>
          </div>
          <Link
            href="/situation"
            className="block w-full rounded-xl bg-afya-green px-4 py-2.5 text-sm font-semibold text-white text-center hover:bg-afya-green/90 transition-colors"
          >
            {t("open_hyperlocal")}
          </Link>
        </div>
      ) : (
        <Skeleton className="h-32 w-full rounded-xl" />
      )}
    </Card>
  );
}

// Explain outlook widget
function ExplainOutlookWidget({ lang, t, county }: {
  lang: string; t: (k: string) => string; county: string | null;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, question: county ? `${question} (${county})` : question }),
      });
      const data = await res.json();
      setAnswer(data.explanation);
    } catch {
      setAnswer(t("no_ai"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {answer && (
        <div className="rounded-xl bg-afya-canvas border border-afya-border px-3.5 py-3 text-xs text-afya-charcoal leading-relaxed">
          {answer}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={lang === "sw" ? "Mfano: Kwa nini Kiambu inaonekana tofauti na Nairobi?" : "e.g. Why does Kiambu look different from Nairobi?"}
          className="flex-1 rounded-lg border border-afya-border bg-white px-3 py-2 text-xs text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green placeholder:text-afya-muted/50 min-w-0"
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button
          onClick={ask}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-afya-green text-white text-xs font-bold hover:bg-afya-green/90 transition-colors disabled:opacity-40 shrink-0"
        >
          {loading ? "…" : t("send")}
        </button>
      </div>
    </div>
  );
}
