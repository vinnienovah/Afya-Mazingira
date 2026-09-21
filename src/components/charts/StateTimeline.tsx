"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import { fmtTime } from "@/lib/afya/format";
import type { StateSegment } from "@/lib/afya/types";

interface Props {
  segments: StateSegment[];
  height?: number;
}

// Signature State History ribbon, AFYA MAZINGIRA's most recognizable visualization
export default function StateTimeline({ segments, height = 44 }: Props) {
  const { t, lang } = useLanguage();
  const [selected, setSelected] = useState<StateSegment | null>(null);

  if (!segments.length) return (
    <div className="skeleton rounded-xl" style={{ height }} aria-label="Loading state timeline" />
  );

  const dayStart = new Date(segments[0].start).getTime();
  const dayEnd = new Date(segments[segments.length - 1].end).getTime();
  const totalMs = dayEnd - dayStart;

  // Hour labels for reference
  const hourLabels = ["00:00", "06:00", "12:00", "18:00"];
  const tickPositions = hourLabels.map((_, i) => (i / (hourLabels.length - 1)) * 100);

  return (
    <div aria-label={t("state_timeline")}>
      {/* Ribbon */}
      <div
        className="relative w-full rounded-xl overflow-hidden border border-afya-border"
        style={{ height }}
        role="group"
        aria-label={t("state_timeline")}
      >
        {segments.map((seg, i) => {
          const left = ((new Date(seg.start).getTime() - dayStart) / totalMs) * 100;
          const width = Math.max(1, ((new Date(seg.end).getTime() - new Date(seg.start).getTime()) / totalMs) * 100);
          const meta = STATES[seg.state_id];
          const label = lang === "sw" ? meta.name_sw : meta.name;
          const isSelected = selected === seg;

          return (
            <button
              key={i}
              className="absolute top-0 bottom-0 transition-opacity duration-150 hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-1"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: `${meta.color}${isSelected ? "dd" : "bb"}`,
                outlineColor: meta.color,
              }}
              title={`${label} · ${fmtTime(seg.start)}–${fmtTime(seg.end)}`}
              aria-label={`${label}: ${fmtTime(seg.start)} to ${fmtTime(seg.end)}`}
              aria-pressed={isSelected}
              onClick={() => setSelected(isSelected ? null : seg)}
            />
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="relative h-4 mt-1" aria-hidden="true">
        {hourLabels.map((h, i) => (
          <span
            key={h}
            className="absolute text-[9px] text-afya-muted"
            style={{ left: `${tickPositions[i]}%`, transform: i === 0 ? "none" : i === hourLabels.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Selected state detail */}
      {selected && (
        <div
          className="mt-2 rounded-xl border border-afya-border bg-white p-3 text-sm"
          role="region"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: STATES[selected.state_id].color }}
              aria-hidden="true"
            />
            <span className="font-semibold text-afya-charcoal">
              {lang === "sw" ? STATES[selected.state_id].name_sw : STATES[selected.state_id].name}
            </span>
          </div>
          <div className="text-xs text-afya-muted">
            {fmtTime(selected.start)} – {fmtTime(selected.end)}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2" aria-hidden="true">
        {(Array.from(new Set(segments.map((s) => s.state_id))) as number[]).map((sid) => {
          const meta = STATES[sid as 0|1|2|3];
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
