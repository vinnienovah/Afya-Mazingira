"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/language";
import { useSituation } from "@/lib/contexts/situation";
import { RISK_META } from "@/lib/afya/constants";
import { currentBand } from "@/lib/afya/display";
import { fill, fmtAsOf } from "@/lib/afya/format";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { StateChip } from "@/components/ui/StateChip";
import { RiskChip } from "@/components/ui/RiskChip";
import {
  X, ChevronRight, ChevronLeft, Play, Pause, Info,
  Layers, Radio, Thermometer, Droplets, Leaf, } from "lucide-react";
import type { CountyFeature, HourSource, SatelliteAcquisition } from "@/lib/afya/map-data";
import {
  HOUR_SOURCE_LABEL_KEY, NDVI_STEPS, NO_DATA_COLOUR, RAIN_STEPS, THERMAL_STEPS, outlookColour,
} from "@/lib/afya/map-scales";
import type { MapLayerKey } from "@/components/map/CountyLeafletMap";
import { cn } from "@/lib/utils";
import type { FeatureCollection, Geometry } from "geojson";

// Leaflet touches `window`, so it must never render on the server.
const CountyLeafletMap = dynamic(() => import("@/components/map/CountyLeafletMap"), {
  ssr: false,
  loading: () => <Skeleton className="w-full" />,
});

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const LAYER_META: { key: MapLayerKey; icon: React.ReactNode; label_en: string; label_sw: string }[] = [
  { key: "outlook",    icon: <Layers className="w-4 h-4" />,      label_en: "Environmental Outlook", label_sw: "Muonekano wa Mazingira" },
  { key: "thermal",    icon: <Thermometer className="w-4 h-4" />, label_en: "Thermal Context",       label_sw: "Muktadha wa Joto" },
  { key: "rain",       icon: <Droplets className="w-4 h-4" />,    label_en: "Rain Context",          label_sw: "Muktadha wa Mvua" },
  { key: "vegetation", icon: <Leaf className="w-4 h-4" />,        label_en: "Vegetation Context",    label_sw: "Muktadha wa Mimea" },
];

const TIMES = ["09:00", "12:00", "15:00", "18:00"];

// Rain is a whole-day total and NDVI a 14-day mean, so neither moves with the
// hour the strip selects.
const HOURLY_LAYERS: MapLayerKey[] = ["outlook", "thermal"];

export default function MapPage() {
  const { t, lang } = useLanguage();
  const { situation } = useSituation();
  const { data, isLoading } = useSWR("/api/map", fetcher);
  const weatherAsOf: number | null = data?.weather_as_of ?? null;
  const { data: boundaries } = useSWR<FeatureCollection<Geometry, { name: string; code?: number }>>(
    "/geo/counties.geojson", fetcher,
  );

  const [layer, setLayer] = useState<MapLayerKey>("outlook");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [timeIdx, setTimeIdx] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [satIdx, setSatIdx] = useState(0);
  const [showSatTimeline, setShowSatTimeline] = useState(false);

  const counties: CountyFeature[] = useMemo(() => data?.counties?.features ?? [], [data]);
  const satellites: SatelliteAcquisition[] = data?.satellites ?? [];
  // The server says whether Copernicus is configured; the client does not infer
  // it from an empty list, which an outage would produce too.
  const satelliteConfigured: boolean = data?.satellite_configured ?? true;
  const hourly = HOURLY_LAYERS.includes(layer);

  // Indicator lookup keyed by county name (boundaries are authoritative geometry)
  const indicators = useMemo(() => {
    const m: Record<string, CountyFeature["properties"]> = {};
    for (const c of counties) m[c.properties.name] = c.properties;
    return m;
  }, [counties]);

  const selectedCounty = selectedName ? indicators[selectedName] ?? null : null;

  useEffect(() => {
    if (!playing || !hourly) return;
    const id = setInterval(() => setTimeIdx((i) => (i + 1) % TIMES.length), 1800);
    return () => clearInterval(id);
  }, [playing, hourly]);

  const currentTime = TIMES[timeIdx];
  const sat = satellites[satIdx];
  // Without credentials every county's NDVI is null, so the scale would be a
  // legend for a layer that has nothing in it.
  const ndviEmpty = layer === "vegetation" && !satelliteConfigured;
  const stationStatus = !situation ? t("data_unavailable") : situation.demo_mode ? "DEMO" :
    `${situation.data_source === "CONDUIT_ARCHIVE" ? t("archive_notice") : t("ground_measurement")} · ${fmtAsOf(situation.current.time, lang)}`;

  const legend: [string, string][] =
    layer === "outlook"
      ? (["LOW", "ELEVATED", "HIGH", "VERY_HIGH"] as const).map((lv) => [RISK_META[lv].color, lang === "sw" ? RISK_META[lv].sw : RISK_META[lv].en])
      : ndviEmpty
        ? []
        : (layer === "rain" ? RAIN_STEPS : layer === "vegetation" ? NDVI_STEPS : THERMAL_STEPS).map((s) => [s.colour, s.label]);

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

      <p className="rounded-xl border border-afya-border bg-white px-4 py-3 text-sm text-afya-muted" role="note">{t("map_spatial_note")}</p>
      {/* Layer control */}
      <div className="rounded-xl border border-afya-border bg-white p-1 flex gap-0.5 flex-wrap w-fit">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* MAP */}
        <div className="lg:col-span-2 space-y-3">
          <Card padding={false} className="overflow-hidden">
            {/* Time controls, only over the layers that vary by hour */}
            {hourly ? (
              <TimeStrip
                timeIdx={timeIdx}
                setTimeIdx={setTimeIdx}
                playing={playing}
                setPlaying={setPlaying}
                t={t}
              />
            ) : (
              <p className="px-4 pt-3.5 pb-3 border-b border-afya-border text-[11px] text-afya-muted">
                {t("map_time_not_used")}
              </p>
            )}

            {/* Leaflet map */}
            <div className="relative">
              {isLoading || !boundaries ? (
                <Skeleton className="w-full" />
              ) : (
                <CountyLeafletMap
                  boundaries={boundaries}
                  indicators={indicators}
                  layer={layer}
                  timeIdx={timeIdx}
                  selectedCounty={selectedName}
                  onSelectCounty={setSelectedName}
                  onSelectStation={() => setSelectedName(null)}
                  stationLabel={t("jkuat_station")}
                  stationSubLabel={stationStatus}
                  lang={lang}
                  t={t}
                />
              )}

              {/* Legend overlay */}
              <div className="absolute bottom-4 left-4 z-[500] max-w-[15rem] rounded-xl bg-white/95 border border-afya-border px-3 py-2 backdrop-blur-sm shadow-sm">
                {layer === "thermal" && (
                  <p className="text-[10px] font-bold text-afya-charcoal mb-1">{t("map_air_temp")} · {currentTime} EAT</p>
                )}
                {ndviEmpty && (
                  <p className="text-[10px] text-afya-muted mb-1 leading-snug">{t("map_satellite_not_configured")}</p>
                )}
                <div className="flex flex-col gap-1">
                  {legend.map(([c, l]) => (
                    <div key={l} className="flex items-center gap-1.5 text-[10px] font-semibold text-afya-charcoal">
                      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} aria-hidden="true" />{l}
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-afya-charcoal">
                    <span
                      className="w-3 h-3 rounded-sm border border-dashed border-[#68756F]"
                      style={{ backgroundColor: NO_DATA_COLOUR }}
                      aria-hidden="true"
                    />
                    {t("no_data")}
                  </div>
                </div>
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
                Conduit · JKUAT · {stationStatus}
              </span>
              <span className="text-[10px] text-afya-muted">
                {t("map_counties_source")} · {t("regional_model_label")}
                {weatherAsOf ? ` · ${fill(t("read_at"), { time: fmtAsOf(new Date(weatherAsOf).toISOString(), lang) })}` : ""}
              </span>
              <span className="text-[10px] text-afya-muted/70 ml-auto">{t("map_boundaries_note")}</span>
            </div>
          </Card>

          {/* Satellite acquisition timeline */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <CardTitle className="mb-0">{t("satellite_context")}</CardTitle>
              {satellites.length > 0 && (
                <button
                  onClick={() => setShowSatTimeline((v) => !v)}
                  className="text-xs text-afya-muted hover:text-afya-charcoal flex items-center gap-1"
                  aria-expanded={showSatTimeline}
                >
                  <Info className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
                  {showSatTimeline ? t("hide_technical") : t("details")}
                </button>
              )}
            </div>

            {satellites.length === 0 ? (
              // An empty strip behind two dead arrows said nothing about why.
              <p className="text-xs text-afya-muted">
                {satelliteConfigured ? t("context_unavailable") : t("map_satellite_not_configured")}
              </p>
            ) : (
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
            )}

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
            <CountyPanel county={selectedCounty} timeIdx={timeIdx} onClose={() => setSelectedName(null)} lang={lang} t={t} />
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

// The four hours the outlook and thermal layers are drawn for
function TimeStrip({
  timeIdx, setTimeIdx, playing, setPlaying, t,
}: {
  timeIdx: number;
  setTimeIdx: React.Dispatch<React.SetStateAction<number>>;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  t: (k: string) => string;
}) {
  return (
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
      <span className="text-[11px] text-afya-muted font-mono">{TIMES[timeIdx]} EAT</span>
    </div>
  );
}

/** What this county actually has behind it, rather than the full roster. */
function regionalSubKey(p: CountyFeature["properties"]): string {
  if (!p.sources.length) return "regional_intelligence_sub_none";
  return p.ndvi_mean != null ? "regional_intelligence_sub_ndvi" : "regional_intelligence_sub";
}

// County detail panel
function CountyPanel({
  county, timeIdx, onClose, lang, t,
}: {
  county: CountyFeature["properties"]; timeIdx: number; onClose: () => void; lang: string; t: (k: string) => string;
}) {
  const p = county;
  const hasGround = p.sources.includes("Conduit station");
  const hour = p.outlook_hours[timeIdx];
  const unavailable = t("data_unavailable");
  const fmt = (v: number | null, digits: number, unit: string) => (v == null ? unavailable : `${v.toFixed(digits)}${unit}`);
  const sourceOf = (s: HourSource | null) => (s ? ` · ${t(HOUR_SOURCE_LABEL_KEY[s])}` : "");
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
        {hasGround ? t("ground_regional_sub") : t(regionalSubKey(p))}
      </p>

      {hour?.category ? (
        <RiskChip level={hour.category} size="md" />
      ) : (
        <span className="inline-flex rounded-full border border-dashed border-[#68756F] px-3 py-1 text-xs font-bold text-afya-charcoal" style={{ backgroundColor: NO_DATA_COLOUR }}>
          {unavailable}
        </span>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-[11px] font-semibold text-afya-muted mb-2 uppercase tracking-wide">{t("outlook")}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {p.outlook_hours.map((h, i) => (
              <div key={h.hour} className={cn("text-center rounded-lg p-0.5", i === timeIdx && "ring-2 ring-afya-deep/40")}>
                <div className="text-[9px] text-afya-muted">{h.hour}</div>
                <div
                  className={cn("mt-1 rounded-lg px-1 py-1 text-[9px] font-bold", h.category ? "text-white" : "text-afya-charcoal")}
                  style={{ backgroundColor: outlookColour(h.category) }}
                >
                  {h.category ? (lang === "sw" ? RISK_META[h.category].sw : RISK_META[h.category].en) : t("no_data")}
                </div>
                <div className="mt-0.5 text-[9px] text-afya-muted tabular-nums">
                  {h.temp_c != null ? `${h.temp_c.toFixed(1)}°C` : "-"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {hour && (
          <div className="rounded-lg border border-afya-border bg-afya-canvas/50 px-2.5 py-2 space-y-0.5 text-[10px] text-afya-muted">
            <div className="font-semibold text-afya-charcoal">{hour.hour} EAT</div>
            <div>
              {t("map_air_temp")}: <strong className="text-afya-charcoal tabular-nums">{fmt(hour.temp_c, 1, "°C")}</strong>
              {sourceOf(hour.temp_source)}
            </div>
            <div>
              {t("map_shade_wbgt")}: <strong className="text-afya-charcoal tabular-nums">{fmt(hour.wbgt_c, 1, "°C")}</strong>
              {sourceOf(hour.wbgt_source)}
            </div>
          </div>
        )}

        {hour?.spatial && (
          <div className="rounded-xl border border-afya-border p-3 space-y-2 text-xs">
            <h4 className="font-semibold">{t("map_sample_mean")}</h4>
            <p>{t("map_sample_coverage")}: {hour.spatial.wbgt.valid_samples}/{hour.spatial.wbgt.total_samples} ({hour.spatial.wbgt.coverage_pct.toFixed(0)}%)</p>
            <p>{t("map_sample_range")} · WBGT: {fmt(hour.spatial.wbgt.min, 1, "°C")} – {fmt(hour.spatial.wbgt.max, 1, "°C")}</p>
            <p>{t("map_sample_range")} · {t("map_air_temp")}: {fmt(hour.spatial.temperature.min, 1, "°C")} – {fmt(hour.spatial.temperature.max, 1, "°C")}</p>
            <p>{t("map_above_threshold")}: {fmt(hour.spatial.wbgt.above_pct, 1, "%")}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {[
            { l: t("map_temp_vs_mean"), v: p.temperature_anomaly_c == null ? unavailable : `${p.temperature_anomaly_c >= 0 ? "+" : ""}${p.temperature_anomaly_c}°C` },
            { l: t("map_rain_today"), v: fmt(p.rain_today_mm, 1, " mm") },
            { l: t("map_soil_0_7"), v: p.soil_moisture == null ? unavailable : `${(p.soil_moisture * 100).toFixed(0)}%` },
            { l: t("map_local_ndvi"), v: p.ndvi_mean !== null ? p.ndvi_mean.toFixed(2) : "-" },
            { l: t("confidence"), v: p.confidence },
          ].map((ind, i) => (
            <div key={i} className="rounded-lg border border-afya-border bg-afya-canvas/50 px-2.5 py-2">
              <div className="text-[9px] text-afya-muted">{ind.l}</div>
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

        <p className="text-[9px] text-afya-muted/70 leading-relaxed">{t("map_county_note")}</p>
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
      <p className="mb-3 text-xs text-afya-muted">{t("map_station_scope")}</p>
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
          <p className="text-xs text-afya-muted">{situation?.demo_mode ? "DEMO" : t("ground_measurement")}</p>
          {situation && <p className="text-xs text-afya-muted">{t("data_as_of")} {fmtAsOf(situation.current.time)} · {situation.quality.status}</p>}
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
            <RiskChip level={currentBand(situation)} size="sm" />
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
            <span className="font-semibold text-afya-green">{t(`quality_${situation.quality.status.toLowerCase()}`)}</span>
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
      setAnswer(t("error_generic"));
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
