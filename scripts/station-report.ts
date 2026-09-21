// Station health over the whole Conduit archive: rule hits, a health score for
// every day, the firmware audits and the gaps, written to
// src/lib/afya/model/station-health.json for the Station Health page. Run with:
//
//   npm run station-report

import fs from "fs";
import path from "path";
import { getCsvCoverage, getCsvRange } from "../src/lib/afya/csv-source";
import { audits, checkReadings, dailyHealth, gaps, SENTINEL_LIMITS } from "../src/lib/afya/sentinel";

const ARCHIVE = path.join(process.cwd(), "data", "conduit_master_2025_2026.csv");
const OUT = path.join(process.cwd(), "src", "lib", "afya", "model", "station-health.json");

/** R13: days on which the gust-direction column is a copy of the gust speed. */
function gustDirectionCopies(): { days: number; of: number; share_of_rows_pct: number } {
  const [header, ...lines] = fs.readFileSync(ARCHIVE, "utf8").trim().split("\n");
  const cols = header.split(",");
  const [ts, gust, dir] = ["ts", "wind_gust", "wind_gust_dir"].map((c) => cols.indexOf(c));
  const perDay = new Map<string, { same: number; all: number }>();
  let same = 0;
  for (const line of lines) {
    const v = line.split(",");
    const day = v[ts].slice(0, 10);
    const d = perDay.get(day) ?? { same: 0, all: 0 };
    d.all++;
    if (v[gust] === v[dir]) {
      d.same++;
      same++;
    }
    perDay.set(day, d);
  }
  const copied = [...perDay.values()].filter((d) => d.same / d.all >= 0.99).length;
  return { days: copied, of: perDay.size, share_of_rows_pct: Math.round((same / lines.length) * 1000) / 10 };
}

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

  const longGaps = gaps(series);
  const scores = days.map((d) => d.score);
  const report = {
    source: "data/conduit_master_2025_2026.csv",
    first: series[0].ts,
    last: series[series.length - 1].ts,
    slots: series.length,
    limits: SENTINEL_LIMITS,
    summary: {
      days: days.length,
      mean_score: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
      days_below_80: scores.filter((s) => s < 80).length,
      rain_gauge_disagreement_days: days.filter((d) => d.rules.includes("R11")).length,
      empty_sensor_days: days.filter((d) => d.rules.includes("R12")).length,
    },
    rule_slots: ruleSlots,
    gust_direction_copy: gustDirectionCopies(),
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
