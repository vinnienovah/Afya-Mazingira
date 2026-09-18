"use client";

import { useLanguage } from "@/lib/contexts/language";
import { RISK_META } from "@/lib/afya/constants";
import type { RiskLevel } from "@/lib/afya/types";
import { cn } from "@/lib/utils";
import { AlertTriangle, TrendingUp, AlertCircle, CheckCircle2 } from "lucide-react";

const RISK_ICONS = {
  LOW: CheckCircle2,
  ELEVATED: TrendingUp,
  HIGH: AlertTriangle,
  VERY_HIGH: AlertCircle,
};

export function RiskChip({ level, size = "md" }: { level: RiskLevel; size?: "sm" | "md" | "lg" }) {
  const { lang } = useLanguage();
  const meta = RISK_META[level];
  const label = lang === "sw" ? meta.sw : meta.en;
  const Icon = RISK_ICONS[level];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        size === "sm" && "px-2 py-0.5 text-[11px]",
        size === "md" && "px-3 py-1 text-xs",
        size === "lg" && "px-4 py-1.5 text-sm",
      )}
      style={{
        backgroundColor: `${meta.color}15`,
        color: meta.color,
        border: `1px solid ${meta.color}35`,
      }}
      role="img"
      aria-label={`Risk level: ${label}`}
    >
      <Icon
        className={cn("shrink-0", size === "sm" ? "w-3 h-3" : size === "md" ? "w-3.5 h-3.5" : "w-4 h-4")}
        strokeWidth={2}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
