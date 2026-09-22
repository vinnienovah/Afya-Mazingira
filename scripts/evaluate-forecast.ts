// Month-by-month test of the WBGT forecast candidates in forecast-models.ts.
// For each UTC month from October 2025 to September 2026 every candidate is
// refitted on everything recorded before that month and scored on that month
// alone, so the January to March hot season is scored by models that never
// saw it. Each month's 80 % bands come from the errors the same candidate made
// in the months before it, so their coverage is measured on errors they never
// saw either. The simplest candidate whose mean error is within TIE_MAE_C of
// the lowest at every horizon is the one the app ships. Writes
// src/lib/afya/model/forecast-evaluation.json. Run with:
//
//   npm run evaluate

import fs from "fs";
import path from "path";
import { HORIZON_STEPS, type Horizon } from "../src/lib/afya/forecast-engine";
import { riskRank, wbgtToRisk } from "../src/lib/afya/constants";
import { round } from "./ridge";
import {
  bandsByBlock,
  loadArchive,
  MODEL_KINDS,
  MODEL_NAMES,
  observed,
  rollingForecasts,
  targetBlock,
  type ModelKind,
} from "./forecast-models";

// Months before FIRST_MONTH are forecast only to calibrate the first bands.
const BAND_FROM = "2025-08";
const FIRST_MONTH = "2025-10";
const LAST_MONTH = "2026-09";
const HOT_SEASON = ["2026-01", "2026-02", "2026-03"];
const BAND_HORIZON: Horizon = "3h";
const BAND_SHARE = 0.8;
const TIE_MAE_C = 0.005;
const HORIZONS = Object.keys(HORIZON_STEPS) as Horizon[];
const OUT = path.join(process.cwd(), "src", "lib", "afya", "model", "forecast-evaluation.json");

const METHOD =
  "Rolling origin by calendar month (UTC). For each month every candidate is refitted on every usable " +
  "origin whose target falls before the month starts, then scored on that month's origins. Origins whose " +
  "feature hour or target was filled in rather than measured are left out, and every candidate is scored " +
  "on the same origins. The usual WBGT for a time of day is its mean over the 30 days before the forecast " +
  "origin. The 80% band for each month and each three-hour block of the target's time of day is the 80th " +
  "percentile of the candidate's absolute errors in the months before (from August 2025), and coverage is " +
  "the share of the month's errors inside it. Risk bands (no activity offset) compare the forecast band " +
  "with the observed one. Season figures pool their months, so each month counts by its number of forecasts.";

const SELECTION =
  `The shipped model is the simplest candidate whose mean absolute error over all tested months is within ` +
  `${TIE_MAE_C} degC of the lowest at every horizon; candidates in order of simplicity: ` +
  `${MODEL_KINDS.join(", ")}.`;

// Sums rather than means, so months pool into seasons exactly.
interface Tally {
  abs: number;
  sq: number;
  covered: number;
  width: number;
  same: number;
  lower: number;
  n: number;
}

const empty = (): Tally => ({ abs: 0, sq: 0, covered: 0, width: 0, same: 0, lower: 0, n: 0 });

function add(a: Tally, b: Tally): Tally {
  return {
    abs: a.abs + b.abs,
    sq: a.sq + b.sq,
    covered: a.covered + b.covered,
    width: a.width + b.width,
    same: a.same + b.same,
    lower: a.lower + b.lower,
    n: a.n + b.n,
  };
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

function monthRange(first: string, last: string): string[] {
  const months: string[] = [];
  const d = new Date(`${first}-01T00:00:00Z`);
  while (monthOf(d) <= last) {
    months.push(monthOf(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return months;
}

const scores = (t: Tally) => ({
  mae: round(t.abs / t.n, 3),
  rmse: round(Math.sqrt(t.sq / t.n), 3),
  coverage80: round(t.covered / t.n, 3),
  band80_mean: round(t.width / t.n, 3),
  band_same_pct: round((t.same / t.n) * 100, 1),
  band_lower_pct: round((t.lower / t.n) * 100, 1),
  n: t.n,
});

function main() {
  const a = loadArchive();
  const months = monthRange(BAND_FROM, LAST_MONTH);
  const tested = months.filter((m) => m >= FIRST_MONTH);
  console.log(`archive ${a.coverage.minIso} to ${a.coverage.maxIso}, ${a.series.length} slots`);

  // tallies[kind][horizon][month]
  const tallies = {} as Record<ModelKind, Record<Horizon, Map<string, Tally>>>;
  const nTrain = {} as Record<ModelKind, Record<Horizon, Map<string, number>>>;
  for (const kind of MODEL_KINDS) {
    tallies[kind] = {} as Record<Horizon, Map<string, Tally>>;
    nTrain[kind] = {} as Record<Horizon, Map<string, number>>;
    for (const h of HORIZONS) {
      const step = HORIZON_STEPS[h];
      const forecasts = rollingForecasts(a, kind, step, months);
      const byMonth = new Map<string, Tally>();
      const trained = new Map<string, number>();
      forecasts.forEach((f, j) => {
        if (f.month < FIRST_MONTH) return;
        const prior = forecasts.slice(0, j);
        const priorErrors = prior.flatMap((p) => p.idx.map((i, k) => Math.abs(observed(a, i + step) - p.pred[k])));
        const priorBlocks = prior.flatMap((p) => p.idx.map((i) => targetBlock(a, i, step)));
        const bands = bandsByBlock(priorErrors, priorBlocks, BAND_SHARE);
        const t = empty();
        f.idx.forEach((i, k) => {
          const obs = observed(a, i + step);
          const err = obs - f.pred[k];
          const band = bands[targetBlock(a, i, step)];
          const gap = riskRank(wbgtToRisk(f.pred[k])) - riskRank(wbgtToRisk(obs));
          t.abs += Math.abs(err);
          t.sq += err * err;
          t.width += band;
          if (Math.abs(err) <= band) t.covered++;
          if (gap === 0) t.same++;
          if (gap < 0) t.lower++;
          t.n++;
        });
        byMonth.set(f.month, t);
        trained.set(f.month, f.nTrain);
      });
      tallies[kind][h] = byMonth;
      nTrain[kind][h] = trained;
    }
  }

  const pooled = (kind: ModelKind, h: Horizon, keep: (m: string) => boolean) =>
    tested.filter(keep).map((m) => tallies[kind][h].get(m)!).reduce(add, empty());
  const seasonOf = (keep: (m: string) => boolean) => (kind: ModelKind) =>
    Object.fromEntries(HORIZONS.map((h) => [h, scores(pooled(kind, h, keep))]));
  const isHot = (m: string) => HOT_SEASON.includes(m);
  const overall = seasonOf(() => true);
  const hot = seasonOf(isHot);
  const other = seasonOf((m) => !isHot(m));

  const mae = (kind: ModelKind, h: Horizon) => {
    const t = pooled(kind, h, () => true);
    return t.abs / t.n;
  };
  const lowest = Object.fromEntries(HORIZONS.map((h) => [h, Math.min(...MODEL_KINDS.map((k) => mae(k, h)))]));
  const chosen =
    MODEL_KINDS.find((k) => HORIZONS.every((h) => mae(k, h) <= lowest[h] + TIE_MAE_C)) ??
    [...MODEL_KINDS].sort(
      (x, y) => HORIZONS.reduce((s, h) => s + mae(x, h), 0) - HORIZONS.reduce((s, h) => s + mae(y, h), 0),
    )[0];

  const models = Object.fromEntries(
    MODEL_KINDS.map((kind) => [
      kind,
      {
        name: MODEL_NAMES[kind],
        overall: overall(kind),
        seasons: { hot: hot(kind), other: other(kind) },
        by_month: tested.map((month) => ({
          month,
          horizons: Object.fromEntries(
            HORIZONS.map((h) => {
              const s = scores(tallies[kind][h].get(month)!);
              return [h, { mae: s.mae, rmse: s.rmse, coverage80: s.coverage80, n: s.n, n_train: nTrain[kind][h].get(month)! }];
            }),
          ),
        })),
      },
    ]),
  );

  // The shipped model's figures in the shape the Why? page has always read.
  const shipped = (month: string | null, keep: (m: string) => boolean) => {
    const horizons = Object.fromEntries(
      HORIZONS.map((h) => {
        const t = month ? tallies[chosen][h].get(month)! : pooled(chosen, h, keep);
        const p = month ? tallies.no_change[h].get(month)! : pooled("no_change", h, keep);
        const s = scores(t);
        return [
          h,
          {
            mae: s.mae,
            rmse: s.rmse,
            coverage80: s.coverage80,
            persistence_mae: scores(p).mae,
            n: s.n,
            ...(month ? { n_train: nTrain[chosen][h].get(month)! } : {}),
          },
        ];
      }),
    );
    const band = scores(month ? tallies[chosen][BAND_HORIZON].get(month)! : pooled(chosen, BAND_HORIZON, keep));
    return { horizons, band_same_pct: band.band_same_pct, band_lower_pct: band.band_lower_pct };
  };

  const report = {
    source: "data/conduit_master_2025_2026.csv",
    method: METHOD,
    selection: SELECTION,
    target: "WBGT in shade, 0.7 x wet bulb + 0.3 x air temperature",
    horizon_steps: HORIZON_STEPS,
    band_horizon: BAND_HORIZON,
    months: tested,
    chosen,
    chosen_name: MODEL_NAMES[chosen],
    models,
    seasons: {
      hot: { months: tested.filter(isHot), ...shipped(null, isHot) },
      other: { months: tested.filter((m) => !isHot(m)), ...shipped(null, (m) => !isHot(m)) },
    },
    by_month: tested.map((month) => ({ month, ...shipped(month, () => true) })),
  };

  fs.writeFileSync(OUT, JSON.stringify(report) + "\n");

  const row = (label: string, cells: string[]) => console.log(`${label.padEnd(38)}${cells.map((c) => c.padStart(28)).join("")}`);
  for (const [name, group] of [["all months", overall], ["hot season", hot], ["other months", other]] as const) {
    console.log(`\n${name}: MAE / RMSE / inside 80% band / risk band lower, by horizon`);
    row("", HORIZONS);
    for (const kind of MODEL_KINDS) {
      const s = group(kind);
      row(
        MODEL_NAMES[kind],
        HORIZONS.map((h) => `${s[h].mae.toFixed(3)} ${s[h].rmse.toFixed(3)} ${Math.round(s[h].coverage80 * 1000) / 10}% ${s[h].band_lower_pct}%`),
      );
    }
  }
  for (const h of HORIZONS) {
    const wins = tested.filter((m) => tallies.seasonal[h].get(m)!.abs / tallies.seasonal[h].get(m)!.n < tallies.ridge[h].get(m)!.abs / tallies.ridge[h].get(m)!.n);
    console.log(`${h}: seasonal anomaly beats the ridge in ${wins.length} of ${tested.length} months`);
  }
  console.log(`\nchosen: ${chosen} (${MODEL_NAMES[chosen]})`);
}

main();
