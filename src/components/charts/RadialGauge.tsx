"use client";

import { RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";
import { Card } from "@/components/ui/Card";

interface RadialGaugeProps {
  title: string;
  sourceLabel: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  color: string;
  /** Short note under the number — e.g. the real observed range this gauge is scaled to. */
  rangeNote: string;
}

/**
 * A single-value radial gauge. The min/max scale is always passed in from
 * real data (e.g. the same 30h series already fetched for the line charts on
 * this page) — never a fabricated universal "typical" range — so the
 * position on the dial is honestly relative to what this station has
 * actually recorded recently.
 */
export default function RadialGauge({ title, sourceLabel, value, min, max, unit, color, rangeNote }: RadialGaugeProps) {
  const span = Math.max(max - min, 0.001);
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));
  const data = [{ name: title, value: pct, fill: color }];

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-afya-charcoal">{title}</span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-afya-muted/60">{sourceLabel}</span>
      </div>
      <div className="relative" style={{ width: "100%", height: 140 }}>
        <RadialBarChart
          width={200}
          height={140}
          cx="50%"
          cy="85%"
          innerRadius="70%"
          outerRadius="130%"
          barSize={14}
          data={data}
          startAngle={180}
          endAngle={0}
          style={{ width: "100%" }}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={7} />
        </RadialBarChart>
        <div className="absolute inset-x-0 bottom-2 text-center">
          <div className="text-2xl font-bold text-afya-charcoal leading-none">
            {value.toFixed(1)}<span className="text-sm font-semibold text-afya-muted">{unit}</span>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-afya-muted text-center -mt-1">{rangeNote}</p>
    </Card>
  );
}
