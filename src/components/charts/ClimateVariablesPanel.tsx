"use client";

import useSWR from "swr";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { useLanguage } from "@/lib/contexts/language";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { fmtTimeShort, fmtDate } from "@/lib/afya/format";
import RadialGauge from "./RadialGauge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ConduitPoint {
  ts: string;
  temp_c: number;
  humidity_pct: number;
  wind_ms: number;
  wind_gust_ms: number;
  pressure_hpa: number;
  wbgt_c: number;
  rain_mm: number;
}
interface Era5Point {
  time: string;
  temp_c: number;
  rh: number;
  precip_mm: number;
}
interface RainPoint {
  date: string;
  mm: number;
}
interface SeriesResponse {
  conduit_source: "live" | "csv" | "demo";
  conduit: ConduitPoint[];
  era5: Era5Point[];
  daily_rainfall: RainPoint[];
}

const AXIS_STYLE = { fontSize: 10, fill: "#8a9691" };
const GRID_STYLE = { stroke: "#e3e9e5" };

function TooltipBox({
  active, payload, label, unit, fmt,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
  unit: string;
  fmt: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-afya-border rounded-lg shadow-lg px-3 py-2 text-xs space-y-1" role="tooltip">
      <div className="font-bold text-afya-charcoal">{label ? fmt(label) : ""}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} aria-hidden="true" />
          <span className="text-afya-muted">{p.name}</span>
          <span className="font-semibold text-afya-charcoal ml-auto">{p.value?.toFixed(1)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

function MiniChart({ title, sourceLabel, children }: { title: string; sourceLabel: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <CardTitle className="mb-0">{title}</CardTitle>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-afya-muted/60">{sourceLabel}</span>
      </div>
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </Card>
  );
}

export default function ClimateVariablesPanel() {
  const { t, lang } = useLanguage();
  const { data, isLoading } = useSWR<SeriesResponse>("/api/climate-series", fetcher, {
    refreshInterval: 5 * 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[236px] w-full rounded-2xl" />)}
      </div>
    );
  }

  const conduitLabel =
    data.conduit_source === "live" ? "LIVE · CONDUIT"
      : data.conduit_source === "csv" ? "CONDUIT ARCHIVE"
        : "DEMO";

  const latest = data.conduit[data.conduit.length - 1];
  const gustValues = data.conduit.map((p) => p.wind_gust_ms);
  const pressureValues = data.conduit.map((p) => p.pressure_hpa);
  const gustMin = Math.min(...gustValues, 0);
  const gustMax = Math.max(...gustValues, 1);
  const pressureMin = Math.min(...pressureValues) - 1;
  const pressureMax = Math.max(...pressureValues) + 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-afya-charcoal">{t("climate_variables_title")}</h2>
        <p className="text-xs text-afya-muted">{t("climate_variables_sub")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Temperature & WBGT, Conduit */}
        <MiniChart title={lang === "sw" ? "Joto na WBGT (Conduit)" : "Temperature & WBGT (Conduit)"} sourceLabel={conduitLabel}>
          <LineChart data={data.conduit} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtTimeShort} tick={AXIS_STYLE} minTickGap={40} />
            <YAxis tick={AXIS_STYLE} width={32} />
            <Tooltip content={<TooltipBox unit="°C" fmt={(l) => fmtTimeShort(l)} />} />
            <Line type="monotone" dataKey="temp_c" name={lang === "sw" ? "Joto" : "Temp"} stroke="#E27832" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="wbgt_c" name="WBGT" stroke="#C62828" strokeWidth={2} dot={false} />
          </LineChart>
        </MiniChart>

        {/* Humidity, Conduit */}
        <MiniChart title={lang === "sw" ? "Unyevu (Conduit)" : "Humidity (Conduit)"} sourceLabel={conduitLabel}>
          <AreaChart data={data.conduit} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="humidityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3786B5" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#3786B5" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtTimeShort} tick={AXIS_STYLE} minTickGap={40} />
            <YAxis tick={AXIS_STYLE} width={32} domain={[0, 100]} />
            <Tooltip content={<TooltipBox unit="%" fmt={(l) => fmtTimeShort(l)} />} />
            <Area type="monotone" dataKey="humidity_pct" name={lang === "sw" ? "Unyevu" : "Humidity"} stroke="#3786B5" strokeWidth={2} fill="url(#humidityFill)" />
          </AreaChart>
        </MiniChart>

        {/* Wind speed, Conduit */}
        <MiniChart title={lang === "sw" ? "Kasi ya Upepo (Conduit)" : "Wind Speed (Conduit)"} sourceLabel={conduitLabel}>
          <LineChart data={data.conduit} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtTimeShort} tick={AXIS_STYLE} minTickGap={40} />
            <YAxis tick={AXIS_STYLE} width={32} />
            <Tooltip content={<TooltipBox unit=" m/s" fmt={(l) => fmtTimeShort(l)} />} />
            <Line type="monotone" dataKey="wind_ms" name={lang === "sw" ? "Upepo" : "Wind"} stroke="#6B8F71" strokeWidth={2} dot={false} />
          </LineChart>
        </MiniChart>

        {/* ERA5 regional temperature, 7 days */}
        <MiniChart title={lang === "sw" ? "Joto la Kikanda (ERA5, siku 7)" : "Regional Temperature (ERA5, 7d)"} sourceLabel="ERA5-LAND">
          <LineChart data={data.era5} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
            <XAxis dataKey="time" tickFormatter={fmtDate} tick={AXIS_STYLE} minTickGap={50} />
            <YAxis tick={AXIS_STYLE} width={32} />
            <Tooltip content={<TooltipBox unit="°C" fmt={(l) => fmtDate(l)} />} />
            <Line type="monotone" dataKey="temp_c" name={lang === "sw" ? "Joto la Kikanda" : "Regional Temp"} stroke="#247B78" strokeWidth={2} dot={false} />
          </LineChart>
        </MiniChart>

        {/* Rainfall, daily, real */}
        <MiniChart title={lang === "sw" ? "Mvua ya Kila Siku" : "Daily Rainfall"} sourceLabel="ERA5-LAND">
          <BarChart data={data.daily_rainfall} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={AXIS_STYLE} minTickGap={30} />
            <YAxis tick={AXIS_STYLE} width={32} />
            <Tooltip content={<TooltipBox unit=" mm" fmt={(l) => fmtDate(l)} />} />
            <Bar dataKey="mm" name={lang === "sw" ? "Mvua" : "Rain"} fill="#3786B5" radius={[3, 3, 0, 0]} />
          </BarChart>
        </MiniChart>

        {/* Pressure, Conduit */}
        <MiniChart title={lang === "sw" ? "Shinikizo la Hewa (Conduit)" : "Pressure (Conduit)"} sourceLabel={conduitLabel}>
          <LineChart data={data.conduit} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtTimeShort} tick={AXIS_STYLE} minTickGap={40} />
            <YAxis tick={AXIS_STYLE} width={38} domain={["dataMin - 2", "dataMax + 2"]} />
            <Tooltip content={<TooltipBox unit=" hPa" fmt={(l) => fmtTimeShort(l)} />} />
            <Line type="monotone" dataKey="pressure_hpa" name={lang === "sw" ? "Shinikizo" : "Pressure"} stroke="#7C6BAE" strokeWidth={2} dot={false} />
          </LineChart>
        </MiniChart>
      </div>

      {/* Gauges, current value positioned within the real observed range of
          the same 30h series plotted above, not a fabricated universal scale. */}
      {latest && (
        <div className="grid gap-4 sm:grid-cols-2">
          <RadialGauge
            title={lang === "sw" ? "Mkurupuko wa Upepo (Conduit)" : "Wind Gust (Conduit)"}
            sourceLabel={conduitLabel}
            value={latest.wind_gust_ms}
            min={gustMin}
            max={gustMax}
            unit=" m/s"
            color="#6B8F71"
            rangeNote={lang === "sw" ? `Kiwango cha saa 30: ${gustMin.toFixed(1)}–${gustMax.toFixed(1)} m/s` : `Last 30h range: ${gustMin.toFixed(1)}–${gustMax.toFixed(1)} m/s`}
          />
          <RadialGauge
            title={lang === "sw" ? "Shinikizo la Hewa (Conduit)" : "Pressure (Conduit)"}
            sourceLabel={conduitLabel}
            value={latest.pressure_hpa}
            min={pressureMin}
            max={pressureMax}
            unit=" hPa"
            color="#7C6BAE"
            rangeNote={lang === "sw" ? `Kiwango cha saa 30: ${pressureMin.toFixed(0)}–${pressureMax.toFixed(0)} hPa` : `Last 30h range: ${pressureMin.toFixed(0)}–${pressureMax.toFixed(0)} hPa`}
          />
        </div>
      )}

      <p className="text-[10px] text-afya-muted/60">
        {lang === "sw"
          ? "Joto/Unyevu/Upepo/Shinikizo: Conduit (saa 30 zilizopita). Joto la kikanda na mvua: ERA5-Land, mfumo halisi wa hali ya hewa (siyo CHIRPS moja kwa moja, angalia maelezo)."
          : "Temperature/Humidity/Wind/Pressure: Conduit station (last 30h). Regional temperature and rainfall: ERA5-Land reanalysis, a real precipitation product used in place of a direct CHIRPS point-extraction, which needs raster tooling this deployment doesn't run."}
      </p>
    </div>
  );
}
