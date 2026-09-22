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
import { degreeTicks, hourTicks, stateAt, stateSpans, type StateSpan } from "@/lib/afya/display";

interface Props {
  forecastSeries: ForecastPoint[];
  // null where the station has no measured value; the line breaks there
  measuredSeries?: { time: string; wbgt: number | null }[];
  stateHistory?: StateSegment[];
  height?: number;
}

interface Row {
  t: number;
  measured?: number;
  predicted?: number;
  band?: [number, number];
}

const timeLabel = (ms: number) => fmtTime(new Date(ms).toISOString());

function NoDot() { return null; }

function ChartTooltip({
  active, payload, spans, t, lang,
}: {
  active?: boolean;
  payload?: { payload?: Row }[];
  spans: StateSpan[];
  t: (k: string) => string;
  lang: string;
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const stateId = stateAt(spans, row.t);

  return (
    <div className="bg-white border border-afya-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1.5 min-w-[170px]" role="tooltip">
      <div className="font-bold text-afya-charcoal text-sm">{timeLabel(row.t)}</div>
      {row.measured !== undefined && (
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 inline-block rounded bg-afya-deep" aria-hidden="true" />
          <span className="text-afya-muted">{t("measured")}</span>
          <span className="font-bold text-afya-charcoal ml-auto">{row.measured.toFixed(1)}°C</span>
        </div>
      )}
      {row.predicted !== undefined && (
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 inline-block rounded bg-afya-green" aria-hidden="true" />
          <span className="text-afya-muted">{t("predicted")}</span>
          <span className="font-bold text-afya-charcoal ml-auto">{row.predicted.toFixed(1)}°C</span>
        </div>
      )}
      {row.band && row.band[1] > row.band[0] && (
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-afya-green/20 inline-block" aria-hidden="true" />
          <span className="text-afya-muted">{t("uncertainty")}</span>
          <span className="font-semibold text-afya-charcoal ml-auto">
            {row.band[0].toFixed(1)}–{row.band[1].toFixed(1)}°C
          </span>
        </div>
      )}
      {stateId !== null && (
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: `${STATES[stateId].color}30` }} aria-hidden="true" />
          <span className="text-afya-muted">{t("environmental_state")}</span>
          <span className="font-semibold ml-auto" style={{ color: STATES[stateId].color }}>
            {lang === "sw" ? STATES[stateId].name_sw : STATES[stateId].name}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Shade WBGT: the station's measured values up to now, the forecast after it
 * with its 80 % band, and the environmental states behind the measured part.
 */
export default function ForecastChart({ forecastSeries, measuredSeries = [], stateHistory = [], height = 260 }: Props) {
  const { t, lang } = useLanguage();

  const rows = useMemo(() => {
    const byTime = new Map<number, Row>();
    const rowAt = (ms: number) => {
      let row = byTime.get(ms);
      if (!row) {
        row = { t: ms };
        byTime.set(ms, row);
      }
      return row;
    };
    for (const p of measuredSeries) rowAt(Date.parse(p.time)).measured = p.wbgt ?? undefined;
    for (const p of forecastSeries) {
      const row = rowAt(Date.parse(p.time));
      row.predicted = p.value;
      row.band = [p.lower, p.upper];
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }, [measuredSeries, forecastSeries]);

  const nowMs = forecastSeries.length ? Date.parse(forecastSeries[0].time) : null;
  const xMin = rows.length ? rows[0].t : 0;
  const xMax = rows.length ? rows[rows.length - 1].t : 0;
  const hasMeasured = rows.some((r) => r.measured !== undefined);

  const spans = useMemo(
    () => (nowMs === null ? [] : stateSpans(stateHistory, xMin, nowMs)),
    [stateHistory, xMin, nowMs],
  );
  const shownStates = useMemo(() => [...new Set(spans.map((s) => s.state_id))] as StateId[], [spans]);

  const yTicks = useMemo(
    () => degreeTicks(rows.flatMap((r) => [r.measured, r.predicted, ...(r.band ?? [])]).filter((v): v is number => v !== undefined)),
    [rows],
  );
  const xTicks = useMemo(() => hourTicks(xMin, xMax, xMax - xMin > 12 * 3600_000 ? 3 : 2), [xMin, xMax]);

  const peak = useMemo(() => {
    let best: Row | null = null;
    for (const r of rows) {
      if (r.predicted !== undefined && (!best || r.predicted > (best.predicted ?? -Infinity))) best = r;
    }
    return best;
  }, [rows]);

  if (!rows.length) return null;

  return (
    <div role="img" aria-label={t("chart_aria")} className="w-full">
      {/* Legend: only what the chart actually draws */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3 text-[11px] text-afya-muted" aria-hidden="true">
        {hasMeasured && (
          <span className="flex items-center gap-1.5">
            <svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="24" y2="4" stroke="#103D2C" strokeWidth="2.5" /></svg>
            {t("measured")}
          </span>
        )}
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
        {peak && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-afya-gold inline-block" aria-hidden="true" />
            {t("peak_marker")}: {timeLabel(peak.t)}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(104,117,111,0.2)" vertical={false} />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[xMin, xMax]}
            ticks={xTicks}
            tickFormatter={timeLabel}
            tick={{ fontSize: 10, fill: "#68756f" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[yTicks[0], yTicks[yTicks.length - 1]]}
            ticks={yTicks}
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "#68756f" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}°`}
            width={36}
          />

          <Tooltip
            content={<ChartTooltip spans={spans} t={t} lang={lang} />}
            cursor={{ stroke: "rgba(104,117,111,0.4)", strokeWidth: 1, strokeDasharray: "4 3" }}
          />

          {/* Environmental states behind the measured hours */}
          {spans.map((s) => (
            <ReferenceArea
              key={`${s.start}-${s.state_id}`}
              x1={s.start}
              x2={s.end}
              fill={STATES[s.state_id].color}
              fillOpacity={0.1}
              strokeOpacity={0}
            />
          ))}

          <Area dataKey="band" stroke="none" fill="#006B3C" fillOpacity={0.12} isAnimationActive={false} />

          {nowMs !== null && (
            <ReferenceLine
              x={nowMs}
              stroke="#68756f"
              strokeWidth={1.5}
              strokeDasharray="4,3"
              label={{ value: t("now"), position: "top", fill: "#68756f", fontSize: 10 }}
            />
          )}

          {peak && peak.t !== nowMs && (
            <ReferenceLine
              x={peak.t}
              stroke="#F2B705"
              strokeWidth={1.5}
              strokeDasharray="4,3"
              label={{ value: `${peak.predicted?.toFixed(1)}°`, position: "insideTopLeft", fill: "#8a6d00", fontSize: 10, fontWeight: 700 }}
            />
          )}

          <Line
            dataKey="measured"
            name={t("measured")}
            stroke="#103D2C"
            strokeWidth={2.5}
            dot={<NoDot />}
            activeDot={{ r: 5, fill: "#103D2C", stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            dataKey="predicted"
            name={t("predicted")}
            stroke="#006B3C"
            strokeWidth={2.5}
            strokeDasharray="6,4"
            dot={<NoDot />}
            activeDot={{ r: 5, fill: "#006B3C", stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {shownStates.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2" aria-hidden="true">
          {shownStates.map((id) => (
            <span key={id} className="flex items-center gap-1 text-[10px] text-afya-muted">
              <span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: `${STATES[id].color}30` }} />
              {lang === "sw" ? STATES[id].name_sw : STATES[id].name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
