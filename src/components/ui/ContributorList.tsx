"use client";

import { useLanguage } from "@/lib/contexts/language";
import type { Contributor } from "@/lib/afya/types";
import { contributionBars, contributorLabel } from "@/lib/afya/display";
import { fmtSigned } from "@/lib/afya/format";

/**
 * The inputs behind the +3 h forecast. With the model's own effects in °C it
 * draws one bar per input out from a centre line, orange raising the forecast
 * and teal lowering it. Without them it lists the signals with no numbers,
 * because none were computed.
 */
export function ContributorList({ contributors }: { contributors: Contributor[] }) {
  const { t, lang } = useLanguage();
  const bars = contributionBars(contributors);

  if (bars) {
    return (
      <div>
        <p className="text-xs text-afya-muted mb-4">{t("contributor_values_note")}</p>
        <ul className="space-y-3">
          {bars.map((b, i) => {
            const raises = b.value_c > 0;
            const color = raises ? "#E27832" : "#247B78";
            return (
              <li key={`${b.feature}-${i}`}>
                <div className="flex justify-between gap-3 text-xs mb-1">
                  <span className="font-medium text-afya-charcoal">{contributorLabel(b.feature, lang)}</span>
                  <span className="font-mono tabular-nums" style={{ color }}>{fmtSigned(b.value_c, 2)}°C</span>
                </div>
                <div className="relative h-2 rounded-full bg-afya-canvas" aria-hidden="true">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-afya-border" />
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      backgroundColor: color,
                      width: `${b.width_pct / 2}%`,
                      ...(raises ? { left: "50%" } : { right: "50%" }),
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-afya-muted mb-3">{t("contributor_list_note")}</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {contributors.map((c, i) => (
          <li
            key={`${c.feature}-${i}`}
            className="flex items-center gap-2.5 rounded-lg border border-afya-border bg-afya-canvas/50 px-3 py-2.5 text-sm text-afya-charcoal"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-afya-gold shrink-0" aria-hidden="true" />
            {contributorLabel(c.feature, lang)}
          </li>
        ))}
      </ul>
    </div>
  );
}
