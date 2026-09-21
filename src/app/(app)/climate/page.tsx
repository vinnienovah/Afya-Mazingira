"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { useLanguage } from "@/lib/contexts/language";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { CLIMATE_LOCATIONS } from "@/lib/afya/constants";
import { fmtDate, fmtTimeShort } from "@/lib/afya/format";
import { cn } from "@/lib/utils";
import ClimateVariablesPanel from "@/components/charts/ClimateVariablesPanel";
import { ReplayContent } from "@/app/(app)/replay/page";
import { Radio, LineChart as LineChartIcon, History as HistoryIcon } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Dataset = "conduit" | "era5";
type Granularity = "daily" | "hourly";

interface HistoryPoint {
  time: string;
  temp_c: number | null;
  humidity_pct: number | null;
  wind_ms: number | null;
  rain_mm: number | null;
  pressure_hpa?: number | null;
  wbgt_c?: number | null;
}
interface HistoryResponse {
  dataset: Dataset;
  granularity: Granularity;
  location?: string;
  coverage?: { minIso: string; maxIso: string } | null;
  points: HistoryPoint[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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

function MiniChart({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold text-afya-charcoal mb-3">{title}</h3>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </Card>
  );
}

type DashboardTab = "live" | "history" | "replay";

// Consolidated Dashboard: live climate variables, the date-range Climate
// History explorer, and Historical Replay — previously three separate
// destinations (a section on the Intelligence page, this page, and
// /replay) — now one page with tabs, so there's a single place to look at
// "everything about the climate data" instead of three.
export default function DashboardPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [tab, setTab] = useState<DashboardTab>("live");

  useEffect(() => {
    document.title = `${t("nav_climate")} | AFYA MAZINGIRA`;
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "history" || requested === "replay" || requested === "live") {
      setTab(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTab(next: DashboardTab) {
    setTab(next);
    router.replace(next === "live" ? "/climate" : `/climate?tab=${next}`, { scroll: false });
  }

  const TABS: { key: DashboardTab; label: string; icon: typeof Radio }[] = [
    { key: "live", label: t("dashboard_tab_live"), icon: Radio },
    { key: "history", label: t("dashboard_tab_history"), icon: LineChartIcon },
    { key: "replay", label: t("dashboard_tab_replay"), icon: HistoryIcon },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("nav_climate")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("dashboard_sub")}</p>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl border border-afya-border overflow-hidden w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => selectTab(key)}
            aria-pressed={tab === key}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors",
              tab === key ? "bg-afya-green text-white" : "bg-white text-afya-muted hover:bg-afya-canvas",
            )}
          >
            <Icon className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === "live" && <ClimateVariablesPanel />}
      {tab === "history" && <ClimateHistoryTab />}
      {tab === "replay" && <ReplayContent />}
    </div>
  );
}

function ClimateHistoryTab() {
  const { t, lang } = useLanguage();
  const today = useMemo(() => new Date(), []);

  const [dataset, setDataset] = useState<Dataset>("conduit");
  const [location, setLocation] = useState("jkuat");
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [from, setFrom] = useState(() => isoDate(new Date(today.getTime() - 30 * 86400_000)));
  const [to, setTo] = useState(() => isoDate(today));

  const url = `/api/climate-history?dataset=${dataset}&location=${location}&from=${from}&to=${to}&granularity=${granularity}`;
  const { data, isLoading } = useSWR<HistoryResponse>(url, fetcher);

  function applyPreset(days: number) {
    setTo(isoDate(today));
    setFrom(isoDate(new Date(today.getTime() - days * 86400_000)));
  }

  const points = data?.points ?? [];
  const timeFmt = granularity === "daily" ? fmtDate : fmtTimeShort;
  const PRESETS: [string, number][] = [
    [t("ch_preset_7d"), 7], [t("ch_preset_30d"), 30], [t("ch_preset_3m"), 90], [t("ch_preset_6m"), 182],
  ];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="text-xs font-semibold text-afya-charcoal block mb-1.5">{t("ch_dataset")}</label>
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value as Dataset)}
              className="w-full rounded-xl border border-afya-border bg-white px-3 py-2.5 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
            >
              <option value="conduit">{t("ch_dataset_conduit")}</option>
              <option value="era5">{t("ch_dataset_era5")}</option>
            </select>
          </div>

          {dataset === "era5" && (
            <div>
              <label className="text-xs font-semibold text-afya-charcoal block mb-1.5">{t("ch_location")}</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-afya-border bg-white px-3 py-2.5 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
              >
                {CLIMATE_LOCATIONS.map((l) => (
                  <option key={l.key} value={l.key}>{lang === "sw" ? l.name_sw : l.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-afya-charcoal block mb-1.5">{t("ch_from")}</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-xl border border-afya-border bg-white px-3 py-2.5 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-afya-charcoal block mb-1.5">{t("ch_to")}</label>
            <input
              type="date"
              value={to}
              min={from}
              max={isoDate(today)}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-xl border border-afya-border bg-white px-3 py-2.5 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-afya-charcoal block mb-1.5">{t("ch_granularity")}</label>
            <div className="flex rounded-xl border border-afya-border overflow-hidden">
              {(["daily", "hourly"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={cn(
                    "flex-1 px-3 py-2.5 text-sm font-semibold transition-colors",
                    granularity === g ? "bg-afya-green text-white" : "bg-white text-afya-muted hover:bg-afya-canvas",
                  )}
                >
                  {g === "daily" ? t("ch_daily") : t("ch_hourly")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {PRESETS.map(([label, days]) => (
            <button
              key={label}
              onClick={() => applyPreset(days)}
              className="rounded-full border border-afya-border px-3 py-1.5 text-xs font-semibold text-afya-muted hover:border-afya-green/50 hover:text-afya-green transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        {dataset === "conduit" && data?.coverage && (
          <p className="text-[10px] text-afya-muted/70 mt-3">
            {t("ch_coverage_note")} {fmtDate(data.coverage.minIso)} – {fmtDate(data.coverage.maxIso)}
            {" · "}{lang === "sw" ? "data ya moja kwa moja baada ya hapo" : "real live data fills anything after that"}
          </p>
        )}
      </Card>

      {/* Charts */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[236px] w-full rounded-2xl" />)}
        </div>
      ) : points.length === 0 ? (
        <Card><p className="text-sm text-afya-muted text-center py-10">{t("ch_no_data")}</p></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniChart title={lang === "sw" ? "Joto" : "Temperature"}>
            <LineChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="time" tickFormatter={timeFmt} tick={AXIS_STYLE} minTickGap={40} />
              <YAxis tick={AXIS_STYLE} width={32} />
              <Tooltip content={<TooltipBox unit="°C" fmt={timeFmt} />} />
              <Line type="monotone" dataKey="temp_c" name={lang === "sw" ? "Joto" : "Temp"} stroke="#E27832" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </MiniChart>

          <MiniChart title={lang === "sw" ? "Unyevu" : "Humidity"}>
            <AreaChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="chHumidityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3786B5" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#3786B5" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="time" tickFormatter={timeFmt} tick={AXIS_STYLE} minTickGap={40} />
              <YAxis tick={AXIS_STYLE} width={32} domain={[0, 100]} />
              <Tooltip content={<TooltipBox unit="%" fmt={timeFmt} />} />
              <Area type="monotone" dataKey="humidity_pct" name={lang === "sw" ? "Unyevu" : "Humidity"} stroke="#3786B5" strokeWidth={2} fill="url(#chHumidityFill)" connectNulls />
            </AreaChart>
          </MiniChart>

          <MiniChart title={lang === "sw" ? "Kasi ya Upepo" : "Wind Speed"}>
            <LineChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="time" tickFormatter={timeFmt} tick={AXIS_STYLE} minTickGap={40} />
              <YAxis tick={AXIS_STYLE} width={32} />
              <Tooltip content={<TooltipBox unit=" m/s" fmt={timeFmt} />} />
              <Line type="monotone" dataKey="wind_ms" name={lang === "sw" ? "Upepo" : "Wind"} stroke="#6B8F71" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </MiniChart>

          <MiniChart title={lang === "sw" ? "Mvua" : "Rainfall"}>
            <BarChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="time" tickFormatter={timeFmt} tick={AXIS_STYLE} minTickGap={40} />
              <YAxis tick={AXIS_STYLE} width={32} />
              <Tooltip content={<TooltipBox unit=" mm" fmt={timeFmt} />} />
              <Bar dataKey="rain_mm" name={lang === "sw" ? "Mvua" : "Rain"} fill="#3786B5" radius={[3, 3, 0, 0]} />
            </BarChart>
          </MiniChart>

          {dataset === "conduit" && (
            <MiniChart title="WBGT">
              <LineChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} vertical={false} />
                <XAxis dataKey="time" tickFormatter={timeFmt} tick={AXIS_STYLE} minTickGap={40} />
                <YAxis tick={AXIS_STYLE} width={32} />
                <Tooltip content={<TooltipBox unit="°C" fmt={timeFmt} />} />
                <Line type="monotone" dataKey="wbgt_c" name="WBGT" stroke="#C62828" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </MiniChart>
          )}
        </div>
      )}
    </div>
  );
}
