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
  // The archive export carries no battery column at all, so the score leaves
  // the channel out: a channel an export does not carry cannot be judged. The
  // live feed does list it and finds it empty, which is a fault (R12), so the
  // same days are scored a second time with the battery counted and both
  // figures are published. Neither one alone is the whole truth.
  const days = dailyHealth(series, hits);
  const withBattery = dailyHealth(series, hits, { batteryListed: true });

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
  const mean = (values: number[]) => round1(values.reduce((a, b) => a + b, 0) / values.length);
  const withRule = (rule: string) => days.filter((d) => d.rules.includes(rule)).length;
  const gustSlots = series.filter((o) => typeof o.wind_gust_dir === "number").length;
  const gustCopies = series.filter(
    (o) => typeof o.wind_gust_dir === "number" && Math.abs(o.wind_gust_dir - o.wind_gust) < 0.05,
  ).length;

  const report = {
    source: "data/conduit_master_2025_2026.csv",
    first: series[0].ts,
    last: series[series.length - 1].ts,
    slots: series.length,
    limits: SENTINEL_LIMITS,
    summary: {
      days: days.length,
      mean_score: mean(scores),
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
      share_pct: gustSlots ? round1((gustCopies / gustSlots) * 100) : null,
    },
    battery: {
      status: groupStatus(series, hits, { exportGroups: true }).find((g) => g.group === "battery")!.status,
      // What the same days score with the empty battery channel counted as the
      // fault the live feed reports it to be.
      mean_score_if_counted: mean(withBattery.map((d) => d.score)),
      best_score_if_counted: Math.max(...withBattery.map((d) => d.score)),
      days_below_80_if_counted: withBattery.filter((d) => d.score < 80).length,
    },
    audits: audits(series),
    gaps: {
      over_one_hour: longGaps.length,
      longest: longGaps.reduce<(typeof longGaps)[number] | null>((a, b) => (!a || b.hours > a.hours ? b : a), null),
    },
    // R14. The archive is sampled about every 15 minutes, and a skipped
    // reading at that cadence is already a gap, so the specification's late
    // band (a reading one whole interval behind, but not late enough to open
    // a gap) can only fill on a feed that reports every minute.
    cadence: {
      gap_slots: series.filter((o) => (o.gap_minutes ?? 0) > 0).length,
      late_slots: series.filter((o) => o.late_intervals).length,
      late_intervals: series.reduce((s, o) => s + (o.late_intervals ?? 0), 0),
    },
    days: days.map(({ date, score, bad, suspect, missing_minutes }) => ({ date, score, bad, suspect, missing_minutes })),
  };

  fs.writeFileSync(OUT, JSON.stringify(report) + "\n");
  console.log(JSON.stringify({ ...report, days: `${report.days.length} days` }, null, 1));
}

main();
