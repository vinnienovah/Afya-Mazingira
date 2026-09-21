"use client";

import { useMemo } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, ReferenceArea,
} from "recharts";
import { useLanguage } from "@/lib/contexts/language";
import type { ForecastPoint, StateSegment, StateId } from "@/lib/afya/types";
import { STATES } from "@/lib/afya/constants";
import { fmtTime } from "@/lib/afya/format";

interface Props {
  forecastSeries: ForecastPoint[];
  measuredSeries?: { time: string; wbgt: number }[];
  stateHistory?: StateSegment[];
  height?: number;
}

// Custom dot, hidden (no dots on line)
function NoDot() { return null; }

// Tooltip content, custom
function ChartTooltip({
  active, payload, label, t, lang,
}: {
  active?: boolean; payload?: { name?: string; value?: number; payload?: Record<string, unknown> }[];
  label?: string; t: (k: string) => string; lang: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as Record<string, unknown> | undefined;
  if (!point) return null;

  const isMeasured = point.type === "measured";
  const isPredicted = point.type === "predicted";
  const stateId = point.state_id as number | undefined;

  return (
    <div className="bg-white border border-afya-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1.5 min-w-[160px]" role="tooltip">
      <div className="font-bold text-afya-charcoal text-sm">{label ? fmtTime(label as string) : ""}</div>

      {(isMeasured || isPredicted) && (
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-0.5 inline-block rounded"
            style={{ backgroundColor: isMeasured ? "#103D2C" : "#006B3C" }}
            aria-hidden="true"
          />
          <span className="text-afya-muted">{isMeasured ? t("measured") : t("predicted")}</span>
          <span className="font-bold text-afya-charcoal ml-auto">
            {((point.value as number) ?? (point.wbgt as number))?.toFixed(1)}°C
          </span>
        </div>
      )}

      {isPredicted && point.lower !== undefined && (
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-afya-green/20 inline-block" aria-hidden="true" />
          <span className="text-afya-muted">{t("uncertainty")}</span>
          <span className="font-semibold text-afya-charcoal ml-auto">
            {(point.lower as number).toFixed(1)}–{(point.upper as number).toFixed(1)}°C
          </span>
        </div>
      )}

      {stateId !== undefined && (
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded inline-block"
            style={{ backgroundColor: `${STATES[stateId as 0|1|2|3].color}30` }}
            aria-hidden="true"
          />
          <span className="text-afya-muted">{t("environmental_state")}</span>
          <span className="font-semibold ml-auto" style={{ color: STATES[stateId as 0|1|2|3].color }}>
            {lang === "sw" ? STATES[stateId as 0|1|2|3].name_sw : STATES[stateId as 0|1|2|3].name}
          </span>
        </div>
      )}
    </div>
  );
}

export default function ForecastChart({ forecastSeries, measuredSeries = [], stateHistory = [], height = 260 }: Props) {
  const { t, lang } = useLanguage();

  // Merge measured + forecast into one chart series
  const chartData = useMemo(() => {
    const measuredPoints = measuredSeries.map((p) => ({
      time: p.time,
      wbgt: p.wbgt,
      value: undefined,
      lower: undefined,
      upper: undefined,
      type: "measured",
      band: [p.wbgt, p.wbgt] as [number, number],
    }));

    const forecastPoints = forecastSeries.map((p) => ({
      time: p.time,
      wbgt: undefined,
      value: p.value,
      lower: p.lower,
      upper: p.upper,
      type: "predicted",
      band: [p.lower, p.upper] as [number, number],
    }));

    return [...measuredPoints, ...forecastPoints].sort(
      (a, b) => new Date(a.time as string).getTime() - new Date(b.time as string).getTime(),
    );
  }, [measuredSeries, forecastSeries]);

  // Current time for vertical marker
  const nowIso = forecastSeries[0]?.time;

  // Expected peak
  const peakPoint = useMemo(() => {
    const predicted = chartData.filter((d) => d.type === "predicted" && d.value !== undefined);
    if (!predicted.length) return null;
    return predicted.reduce((best, d) =>
      (d.value ?? 0) > (best.value ?? 0) ? d : best,
    );
  }, [chartData]);

  // State history bands
  const stateBands = useMemo(() => stateHistory, [stateHistory]);

  // Legend shows each distinct state once, not once per band segment,
  // a 9h window can revisit the same state several times.
  const distinctStates = useMemo(() => {
    const seen = new Set<StateId>();
    const out: StateId[] = [];
    for (const seg of stateBands) {
      if (!seen.has(seg.state_id)) {
        seen.add(seg.state_id);
        out.push(seg.state_id);
      }
    }
    return out;
  }, [stateBands]);

  const minVal = useMemo(() => {
    const all = chartData.flatMap((d) => [
      d.wbgt !== undefined ? d.wbgt : undefined,
      d.value !== undefined ? d.value : undefined,
      d.lower !== undefined ? d.lower : undefined,
    ]).filter(Boolean) as number[];
    return Math.max(0, Math.floor(Math.min(...all) - 1));
  }, [chartData]);

  const maxVal = useMemo(() => {
    const all = chartData.flatMap((d) => [
      d.wbgt !== undefined ? d.wbgt : undefined,
      d.value !== undefined ? d.value : undefined,
      d.upper !== undefined ? d.upper : undefined,
    ]).filter(Boolean) as number[];
    return Math.ceil(Math.max(...all) + 1.5);
  }, [chartData]);

  // State id lookup for band coloring
  const stateIdFor = useMemo(() => {
    const map: Record<string, number> = {};
    for (const seg of stateBands) {
      map[seg.start] = seg.state_id;
    }
    return map;
  }, [stateBands]);

  return (
    <div
      role="img"
      aria-label={t("chart_aria")}
      className="w-full"
    >
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3 text-[11px] text-afya-muted" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="24" y2="4" stroke="#103D2C" strokeWidth="2.5" /></svg>
          {t("measured")}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="24" y2="4" stroke="#006B3C" strokeWidth="2.5" strokeDasharray="5,3" />
          </svg>
          {t("predicted")}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="12" aria-hidden="true">
            <rect x="0" y="1" width="16" height="10" rx="2" fill="#006B3C" fillOpacity="0.15" />
          </svg>
          {t("uncertainty")}
        </span>
        {peakPoint && (
          <span className="flex items-center gap-1.5 text-afya-muted">
            <span className="w-2 h-2 rounded-full bg-afya-gold inline-block" aria-hidden="true" />
            {t("peak_marker")}: {fmtTime(peakPoint.time as string)}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(104,117,111,0.2)" vertical={false} />

          <XAxis
            dataKey="time"
            tickFormatter={(iso: string) => fmtTime(iso)}
            tick={{ fontSize: 10, fill: "#68756f" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            domain={[minVal, maxVal]}
            tick={{ fontSize: 10, fill: "#68756f" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}°`}
            width={32}
          />

          <Tooltip
            content={<ChartTooltip t={t} lang={lang} />}
            cursor={{ stroke: "rgba(104,117,111,0.4)", strokeWidth: 1, strokeDasharray: "4 3" }}
          />

          {/* Environmental state background bands */}
          {stateBands.map((seg) => {
            const color = STATES[seg.state_id]?.color ?? "#ccc";
            return (
              <ReferenceArea
                key={`${seg.start}-${seg.state_id}`}
                x1={seg.start}
                x2={seg.end}
                fill={color}
                fillOpacity={0.07}
                stroke={color}
                strokeOpacity={0.12}
                strokeWidth={0.5}
              />
            );
          })}

          {/* Uncertainty band */}
          <Area
            dataKey="band"
            stroke="none"
            fill="#006B3C"
            fillOpacity={0.12}
            isAnimationActive={false}
          />

          {/* Current time vertical line */}
          {nowIso && (
            <ReferenceLine
              x={nowIso}
              stroke="#68756f"
              strokeWidth={1.5}
              strokeDasharray="4,3"
              label={{
                value: t("now"),
                position: "top",
                fill: "#68756f",
                fontSize: 10,
              }}
            />
          )}

          {/* Peak marker */}
          {peakPoint && (
            <ReferenceLine
              x={peakPoint.time as string}
              stroke="#F2B705"
              strokeWidth={1.5}
              strokeDasharray="4,3"
              label={{
                value: `${(peakPoint.value as number)?.toFixed(1)}°`,
                position: "top",
                fill: "#8a6d00",
                fontSize: 10,
                fontWeight: 700,
              }}
            />
          )}

          {/* Measured line (solid) */}
          <Line
            dataKey="wbgt"
            name={t("measured")}
            stroke="#103D2C"
            strokeWidth={2.5}
            dot={<NoDot />}
            activeDot={{ r: 5, fill: "#103D2C", stroke: "#fff", strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />

          {/* Predicted line (dashed) */}
          <Line
            dataKey="value"
            name={t("predicted")}
            stroke="#006B3C"
            strokeWidth={2.5}
            strokeDasharray="6,4"
            dot={<NoDot />}
            activeDot={{ r: 5, fill: "#006B3C", stroke: "#fff", strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* State band legend, one entry per distinct state, not per segment */}
      {distinctStates.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2" aria-hidden="true">
          {distinctStates.map((stateId) => {
            const meta = STATES[stateId];
            if (!meta) return null;
            return (
              <span key={`legend-${stateId}`} className="flex items-center gap-1 text-[10px] text-afya-muted">
                <span
                  className="w-3 h-2 rounded-sm inline-block"
                  style={{ backgroundColor: `${meta.color}30` }}
                />
                {lang === "sw" ? meta.name_sw : meta.name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
