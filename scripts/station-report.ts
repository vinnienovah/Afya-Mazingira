// Station health over the whole Conduit archive: rule hits, a health score for
// every day, the firmware audits, the gaps and the rain gauges, written to
// src/lib/afya/model/station-health.json for the Station Health page. Run with:
//
//   npm run station-report

import fs from "fs";
import path from "path";
import { getCsvCoverage, getCsvRange } from "../src/lib/afya/csv-source";
import { audits, checkReadings, dailyHealth, gaps, groupStatus, rainDayTotals, SENTINEL_LIMITS } from "../src/lib/afya/sentinel";
import { slotRain } from "../src/lib/afya/station-history";

const OUT = path.join(process.cwd(), "src", "lib", "afya", "model", "station-health.json");

const round1 = (v: number) => Math.round(v * 10) / 10;

function main() {
  const coverage = getCsvCoverage();
  if (!coverage) throw new Error("no Conduit archive found under data/");
  const series = getCsvRange(coverage.minIso, coverage.maxIso);
  const hits = checkReadings(series);
  const days = dailyHealth(series, hits);

  const ruleSlots: Record<string, number> = {};
  for (const [rule, set] of Object.entries(
    hits.reduce<Record<string, Set<number>>>((acc, h) => {
      (acc[h.rule] ??= new Set()).add(h.index);
      return acc;
    }, {}),
  )) ruleSlots[rule] = set.size;

  // The rain days each gauge's own totals tell apart.
  const L = SENTINEL_LIMITS;
  const totals = [...rainDayTotals(series).values()].filter(
    (t): t is [number, number] => t[0] !== null && t[1] !== null,
  );
  const silent = (quiet: 0 | 1) =>
    totals.filter((t) => t[quiet] === 0 && t[1 - quiet] >= L.rain_disagreement_mm).length;

  const rainBySlot = series.map(slotRain);
  const longGaps = gaps(series);
  const scores = days.map((d) => d.score);
  const withRule = (rule: string) => days.filter((d) => d.rules.includes(rule)).length;
  const gustSlots = series.filter((o) => typeof o.wind_gust_dir === "number").length;

  const report = {
    source: "data/conduit_master_2025_2026.csv",
    first: series[0].ts,
    last: series[series.length - 1].ts,
    slots: series.length,
    limits: SENTINEL_LIMITS,
    summary: {
      days: days.length,
      mean_score: round1(scores.reduce((a, b) => a + b, 0) / scores.length),
      days_below_80: scores.filter((s) => s < 80).length,
      rain_gauge_disagreement_days: withRule("R11"),
      gauge2_silent_days: silent(1),
      gauge1_silent_days: silent(0),
      empty_sensor_days: withRule("R12"),
      missing_minutes: Math.round(days.reduce((s, d) => s + d.missing_minutes, 0)),
      days_with_missing_time: days.filter((d) => d.missing_minutes > 0).length,
    },
    rain: {
      gauge1_mm: round1(rainBySlot.reduce<number>((s, mm) => s + (mm ?? 0), 0)),
      slots_without_reading: rainBySlot.filter((mm) => mm === null).length,
    },
    rule_slots: ruleSlots,
    gust_direction_copy: {
      days: withRule("R13"),
      of: days.length,
      share_pct: gustSlots ? round1(((ruleSlots.R13 ?? 0) / gustSlots) * 100) : null,
    },
    battery: groupStatus(series, hits, { exportGroups: true }).find((g) => g.group === "battery")!.status,
    audits: audits(series),
    gaps: {
      over_one_hour: longGaps.length,
      longest: longGaps.reduce<(typeof longGaps)[number] | null>((a, b) => (!a || b.hours > a.hours ? b : a), null),
    },
    days: days.map(({ date, score, bad, suspect, missing_minutes }) => ({ date, score, bad, suspect, missing_minutes })),
  };

  fs.writeFileSync(OUT, JSON.stringify(report) + "\n");
  console.log(JSON.stringify({ ...report, days: `${report.days.length} days` }, null, 1));
}

main();
