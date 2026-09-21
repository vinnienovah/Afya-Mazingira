// Month-by-month test of the WBGT forecast. For each UTC month from October
// 2025 to September 2026 the ridge models are refitted on everything recorded
// before that month and scored on that month alone, so the January to March
// hot season is scored by models that never saw it. Writes
// src/lib/afya/model/forecast-evaluation.json. Run with:
//
//   npm run evaluate

import fs from "fs";
import path from "path";
import { getCsvCoverage, getCsvRange } from "../src/lib/afya/csv-source";
import { buildFeatureSeries, FORECAST_FEATURES } from "../src/lib/afya/feature-engine";
import { HORIZON_STEPS, type Horizon } from "../src/lib/afya/forecast-engine";
import { riskRank, wbgtToRisk } from "../src/lib/afya/constants";
import { featureScale, fitRidge, forecastOrigins, round, usableOrigins } from "./ridge";

const FIRST_MONTH = "2025-10";
const LAST_MONTH = "2026-09";
const HOT_SEASON = ["2026-01", "2026-02", "2026-03"];
const BAND_HORIZON: Horizon = "3h";
const HORIZONS = Object.keys(HORIZON_STEPS) as Horizon[];
const OUT = path.join(process.cwd(), "src", "lib", "afya", "model", "forecast-evaluation.json");

const METHOD =
  "Rolling origin by calendar month (UTC). For each month the ridge models (lambda 1, features " +
  "standardised on the training data) are refitted on every usable origin whose target falls before " +
  "the month starts, then scored on that month's origins. Origins whose feature hour or target was " +
  "filled in rather than measured are left out. The no-change baseline keeps WBGT at its current " +
  "value. Risk bands (no activity offset) are compared at +3 h. Season figures pool their months, " +
  "so each month counts by its number of forecasts.";

// Sums rather than means, so months pool into seasons exactly.
interface Tally {
  error: number;
  persistence: number;
  same: number;
  lower: number;
  n: number;
}

const monthOf = (ts: string) => ts.slice(0, 7);

function monthRange(first: string, last: string): string[] {
  const months: string[] = [];
  const d = new Date(`${first}-01T00:00:00Z`);
  while (monthOf(d.toISOString()) <= last) {
    months.push(monthOf(d.toISOString()));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return months;
}

function add(a: Tally, b: Tally): Tally {
  return {
    error: a.error + b.error,
    persistence: a.persistence + b.persistence,
    same: a.same + b.same,
    lower: a.lower + b.lower,
    n: a.n + b.n,
  };
}

const scores = (t: Tally) => ({
  mae: round(t.error / t.n, 3),
  persistence_mae: round(t.persistence / t.n, 3),
  n: t.n,
});

const bandScores = (t: Tally) => ({
  band_same_pct: round((t.same / t.n) * 100, 1),
  band_lower_pct: round((t.lower / t.n) * 100, 1),
});

function main() {
  const coverage = getCsvCoverage();
  if (!coverage) throw new Error("no Conduit archive found under data/");
  const series = getCsvRange(coverage.minIso, coverage.maxIso);
  const features = buildFeatureSeries(series);
  const usable = usableOrigins(series, features);
  const origins = new Map(HORIZONS.map((h) => [h, forecastOrigins(series, usable, HORIZON_STEPS[h])]));
  const months = monthRange(FIRST_MONTH, LAST_MONTH);
  console.log(`archive ${coverage.minIso} to ${coverage.maxIso}, ${series.length} slots`);

  const byMonth = months.map((month) => {
    const trainIdx = series.map((_, i) => i).filter((i) => usable[i] && monthOf(series[i].ts) < month);
    const { mu, sd } = featureScale(features, trainIdx, FORECAST_FEATURES);
    const z = (i: number) => FORECAST_FEATURES.map((name, j) => (features[i]![name] - mu[j]) / sd[j]);

    const tallies = {} as Record<Horizon, Tally>;
    const nTrain = {} as Record<Horizon, number>;
    for (const h of HORIZONS) {
      const step = HORIZON_STEPS[h];
      // A training target inside the month would leak the month into its own test.
      const train = origins.get(h)!.filter((i) => monthOf(series[i + step].ts) < month);
      const test = origins.get(h)!.filter((i) => monthOf(series[i].ts) === month);
      if (!test.length) throw new Error(`no measured origins in ${month} at ${h}`);
      const { predict } = fitRidge(train.map((i) => ({ x: z(i), y: series[i + step].wet_bulb_globe_temp })));

      const t: Tally = { error: 0, persistence: 0, same: 0, lower: 0, n: test.length };
      for (const i of test) {
        const observed = series[i + step].wet_bulb_globe_temp;
        const forecast = predict(z(i));
        t.error += Math.abs(observed - forecast);
        t.persistence += Math.abs(observed - series[i].wet_bulb_globe_temp);
        const gap = riskRank(wbgtToRisk(forecast)) - riskRank(wbgtToRisk(observed));
        if (gap === 0) t.same++;
        if (gap < 0) t.lower++;
      }
      tallies[h] = t;
      nTrain[h] = train.length;
    }
    return { month, tallies, nTrain };
  });

  const season = (keep: (month: string) => boolean) => {
    const picked = byMonth.filter((m) => keep(m.month));
    const pooled = (h: Horizon) => picked.map((m) => m.tallies[h]).reduce(add);
    return {
      months: picked.map((m) => m.month),
      horizons: Object.fromEntries(HORIZONS.map((h) => [h, scores(pooled(h))])),
      ...bandScores(pooled(BAND_HORIZON)),
    };
  };

  const report = {
    source: "data/conduit_master_2025_2026.csv",
    method: METHOD,
    target: "WBGT in shade, 0.7 x wet bulb + 0.3 x air temperature",
    horizon_steps: HORIZON_STEPS,
    band_horizon: BAND_HORIZON,
    months,
    seasons: {
      hot: season((m) => HOT_SEASON.includes(m)),
      other: season((m) => !HOT_SEASON.includes(m)),
    },
    by_month: byMonth.map(({ month, tallies, nTrain }) => ({
      month,
      horizons: Object.fromEntries(
        HORIZONS.map((h) => [h, { ...scores(tallies[h]), n_train: nTrain[h] }]),
      ),
      ...bandScores(tallies[BAND_HORIZON]),
    })),
  };

  fs.writeFileSync(OUT, JSON.stringify(report) + "\n");

  for (const m of report.by_month) {
    const cells = HORIZONS.map((h) => `${h} ${m.horizons[h].mae} (no-change ${m.horizons[h].persistence_mae})`);
    console.log(`${m.month}  ${cells.join("  ")}  same band ${m.band_same_pct}%  lower ${m.band_lower_pct}%  n=${m.horizons[BAND_HORIZON].n}`);
  }
  for (const [name, s] of Object.entries(report.seasons)) {
    const cells = HORIZONS.map((h) => `${h} ${s.horizons[h].mae} (no-change ${s.horizons[h].persistence_mae}, n=${s.horizons[h].n})`);
    console.log(`${name}  ${cells.join("  ")}  same band ${s.band_same_pct}%  lower ${s.band_lower_pct}%`);
  }
}

main();
