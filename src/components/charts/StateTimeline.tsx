"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import { fmtTime } from "@/lib/afya/format";
import { hourTicks, stateSpans } from "@/lib/afya/display";
import type { StateSegment } from "@/lib/afya/types";

interface Props {
  segments: StateSegment[];
  height?: number;
}

const DAY_MS = 24 * 3600_000;
const timeLabel = (ms: number) => fmtTime(new Date(ms).toISOString());

// Signature State History ribbon: the last 24 hours up to the latest reading.
export default function StateTimeline({ segments, height = 44 }: Props) {
  const { t, lang } = useLanguage();
  const [selected, setSelected] = useState<number | null>(null);

  if (!segments.length) return (
    <div className="skeleton rounded-xl" style={{ height }} aria-label="Loading state timeline" />
  );

  const end = Date.parse(segments[segments.length - 1].end);
  const start = Math.max(Date.parse(segments[0].start), end - DAY_MS);
  const total = Math.max(end - start, 1);
  const pct = (ms: number) => ((ms - start) / total) * 100;
  const spans = stateSpans(segments, start, end);
  // Six-hourly clock times, kept clear of the labels at either end.
  const ticks = hourTicks(start, end, 6).filter((ms) => pct(ms) > 8 && pct(ms) < 92);
  const current = selected !== null ? spans[selected] : null;

  return (
    <div aria-label={t("state_timeline")}>
      {/* Ribbon */}
      <div
        className="relative w-full rounded-xl overflow-hidden border border-afya-border"
        style={{ height }}
        role="group"
        aria-label={t("state_timeline")}
      >
        {spans.map((span, i) => {
          const meta = STATES[span.state_id];
          const label = lang === "sw" ? meta.name_sw : meta.name;
          const isSelected = selected === i;
          const range = `${fmtTime(span.segment.start)}–${fmtTime(span.segment.end)}`;

          return (
            <button
              key={i}
              className="absolute top-0 bottom-0 transition-opacity duration-150 hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-1"
              style={{
                left: `${pct(span.start)}%`,
                width: `${Math.max(0.6, pct(span.end) - pct(span.start))}%`,
                backgroundColor: `${meta.color}${isSelected ? "dd" : "bb"}`,
                outlineColor: meta.color,
              }}
              title={`${label} · ${range}`}
              aria-label={`${label}: ${range}`}
              aria-pressed={isSelected}
              onClick={() => setSelected(isSelected ? null : i)}
            />
          );
        })}
      </div>

      {/* Clock labels from the data: first reading, six-hourly marks, latest reading */}
      <div className="relative h-4 mt-1" aria-hidden="true">
        <span className="absolute left-0 text-[9px] text-afya-muted">{timeLabel(start)}</span>
        {ticks.map((ms) => (
          <span
            key={ms}
            className="absolute text-[9px] text-afya-muted -translate-x-1/2"
            style={{ left: `${pct(ms)}%` }}
          >
            {timeLabel(ms)}
          </span>
        ))}
        <span className="absolute right-0 text-[9px] text-afya-muted">{timeLabel(end)}</span>
      </div>

      {/* Selected state detail */}
      {current && (
        <div
          className="mt-2 rounded-xl border border-afya-border bg-white p-3 text-sm"
          role="region"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: STATES[current.state_id].color }}
              aria-hidden="true"
            />
            <span className="font-semibold text-afya-charcoal">
              {lang === "sw" ? STATES[current.state_id].name_sw : STATES[current.state_id].name}
            </span>
          </div>
          <div className="text-xs text-afya-muted">
            {fmtTime(current.segment.start)} – {fmtTime(current.segment.end)}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2" aria-hidden="true">
        {Array.from(new Set(spans.map((s) => s.state_id))).map((sid) => {
          const meta = STATES[sid];
          return (
            <span key={sid} className="flex items-center gap-1 text-[10px] text-afya-muted">
              <span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: `${meta.color}bb` }} />
              {lang === "sw" ? meta.name_sw : meta.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
