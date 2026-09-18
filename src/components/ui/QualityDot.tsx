"use client";

import { useLanguage } from "@/lib/contexts/language";
import type { QualityStatus } from "@/lib/afya/types";
import { fmtAgo } from "@/lib/afya/format";

const DOT_COLOR: Record<QualityStatus, string> = {
  GOOD: "bg-afya-green",
  DEGRADED: "bg-afya-gold",
  POOR: "bg-afya-red",
};

export function QualityDot({
  status,
  freshnessMinutes,
  compact = false,
}: {
  status: QualityStatus;
  freshnessMinutes?: number;
  compact?: boolean;
}) {
  const { t, lang } = useLanguage();

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-afya-muted"
        role="status"
        aria-label={`Data quality: ${status}`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLOR[status]}`}
          aria-hidden="true"
        />
        {status === "GOOD" ? t("quality_good") : status === "DEGRADED" ? t("quality_degraded") : t("quality_poor")}
        {freshnessMinutes !== undefined && !compact && (
          <span>· {fmtAgo(freshnessMinutes, lang)}</span>
        )}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-afya-border bg-white px-2.5 py-1 text-[11px] font-semibold text-afya-muted"
      role="status"
      aria-label={`Data quality: ${status}`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 live-pulse ${DOT_COLOR[status]}`}
        aria-hidden="true"
      />
      {status === "GOOD" ? t("quality_good") : status === "DEGRADED" ? t("quality_degraded") : t("quality_poor")}
      {freshnessMinutes !== undefined && (
        <span className="text-afya-muted/70">· {fmtAgo(freshnessMinutes, lang)}</span>
      )}
    </span>
  );
}
