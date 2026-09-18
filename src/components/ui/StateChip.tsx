"use client";

import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import type { StateId } from "@/lib/afya/types";
import { cn } from "@/lib/utils";

export function StateChip({ stateId, size = "md" }: { stateId: StateId; size?: "sm" | "md" | "lg" }) {
  const { lang } = useLanguage();
  const meta = STATES[stateId];
  const label = lang === "sw" ? meta.name_sw : meta.name;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full font-semibold",
        size === "sm" && "px-2.5 py-0.5 text-[11px]",
        size === "md" && "px-3 py-1 text-xs",
        size === "lg" && "px-4 py-1.5 text-sm",
      )}
      style={{
        backgroundColor: `${meta.color}18`,
        color: meta.color,
        border: `1px solid ${meta.color}35`,
      }}
      aria-label={`Environmental state: ${label}`}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: meta.color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
