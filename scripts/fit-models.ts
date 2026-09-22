// Fits the WBGT forecast, the environmental states and the rain probability
// on the committed Conduit archive, through the same cleaning and feature code
// the app runs, and writes them to src/lib/afya/model/. Run with:
//
//   npx tsx scripts/fit-models.ts
//
// The forecast is the candidate scripts/evaluate-forecast.ts chose (run that
// first when the archive changes). It is fitted on everything before the test
// months, its bands come from the errors it made on months held out of each
// fit before the test months, and every score it reports comes from the test
// months, which neither the fit nor the bands saw.

import fs from "fs";
import path from "path";
import { FORECAST_FEATURES, STATE_FEATURES, type FeatureVector } from "../src/lib/afya/feature-engine";
import { riskRank, wbgtToRisk } from "../src/lib/afya/constants";
import { CLIMATOLOGY_DAYS, BLOCK_HOURS, slotOfDay, timeOfDayBlock } from "../src/lib/afya/climatology";
import { MIN_DWELL_SLOTS, smoothStates, stateRuns } from "../src/lib/afya/state-engine";
import type { StateId } from "../src/lib/afya/types";
import evaluation from "../src/lib/afya/model/forecast-evaluation.json";
import { featureScale, mean, round } from "./ridge";
import {
  bandsByBlock,
  fitStep,
  hasUsual,
  loadArchive,
  MAX_STEP,
  MODEL_KINDS,
  MODEL_NAMES,
  observed,
  quantile,
  rollingForecasts,
  scaleBefore,
  targetBlock,
  type Archive,
  type ModelKind,
} from "./forecast-models";
import { fitRain } from "./rain";

const TEST_FROM = "2026-06-01";
const BAND_FROM = "2025-08";
const BAND_SHARE = 0.8;
const STATES_TRAIN_UNTIL = "2026-04-01T00:00:00Z";
const STATE_COUNT = 4;
// A state and time-of-day block needs this many readings for its own next-state row.
const MIN_BLOCK_READINGS = 20;
const OUT_DIR = path.join(process.cwd(), "src", "lib", "afya", "model");

const METHODS: Record<ModelKind, string> = {
  no_change: "WBGT stays at its latest value",
  seasonal:
    "The usual WBGT for the target's 15-minute time of day (its mean over the 30 days before the forecast), " +
    "plus the current departure from usual times a factor fitted for each 15-minute step ahead",
  ridge: "Ridge regression, one model for each 15-minute step ahead",
  ridge_seasonal:
    "Ridge regression with the usual WBGT now and at the target time and the current departure as extra " +
    "inputs, one model for each 15-minute step ahead",
};

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

const dayBefore = (isoDay: string) => new Date(Date.parse(`${isoDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

function fitForecast(a: Archive, kind: ModelKind) {
  const testFromMs = Date.parse(`${TEST_FROM}T00:00:00Z`);
  const testMonth = TEST_FROM.slice(0, 7);
  const isRidge = kind === "ridge" || kind === "ridge_seasonal";
  const scale = isRidge ? scaleBefore(a, testMonth) : null;
  const heldOutMonths = monthRange(BAND_FROM, monthOf(new Date(testFromMs - 86_400_000)));

  const steps = [];
  for (let step = 1; step <= MAX_STEP; step++) {
    const origins = a.origins[step];
    const train = origins.filter((i) => a.ms[i + step] < testFromMs);
    const test = origins.filter((i) => a.ms[i] >= testFromMs);
    if (kind !== "no_change" && kind !== "ridge" && test.some((i) => !hasUsual(a, i, step))) {
      throw new Error(`test origins without usual values at step ${step}`);
    }
    const fitted = fitStep(a, kind, step, train, scale);

    // Bands from errors on months the fit had not seen: each month before the
    // test months forecast by the same candidate fitted on the months before it.
    const held = rollingForecasts(a, kind, step, heldOutMonths);
    const heldErrors = held.flatMap((f) => f.idx.map((i, k) => Math.abs(observed(a, i + step) - f.pred[k])));
    const heldBlocks = held.flatMap((f) => f.idx.map((i) => targetBlock(a, i, step)));
    const bands = bandsByBlock(heldErrors, heldBlocks, BAND_SHARE);
    const noChangeErrors = held.flatMap((f) => f.idx.map((i) => Math.abs(observed(a, i + step) - observed(a, i))));

    const errors = test.map((i) => observed(a, i + step) - fitted.predict(i));
    const covered = test.filter((i, k) => Math.abs(errors[k]) <= bands[targetBlock(a, i, step)]).length;
    // The risk band is what people act on, so it is scored too: how often the
    // forecast band matches the one observed, and how often it is lower.
    const bandGap = test.map((i) => riskRank(wbgtToRisk(fitted.predict(i))) - riskRank(wbgtToRisk(observed(a, i + step))));
    const bandShare = (keep: (d: number) => boolean) => round((bandGap.filter(keep).length / bandGap.length) * 100, 1);

    const params = Object.fromEntries(
      Object.entries(fitted.params).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => round(x, 5)) : round(v, 5)]),
    );
    steps.push({
      step,
      ...params,
      band80: round(quantile(heldErrors, BAND_SHARE), 3),
      band80_by_block: bands.map((b) => round(b, 3)),
      persistence_band80: round(quantile(noChangeErrors, BAND_SHARE), 3),
      test_mae: round(mean(errors.map(Math.abs)), 3),
      test_rmse: round(Math.sqrt(mean(errors.map((e) => e * e))), 3),
      persistence_mae: round(mean(test.map((i) => Math.abs(observed(a, i + step) - observed(a, i)))), 3),
      coverage80: round(covered / test.length, 3),
      band_same_pct: bandShare((d) => d === 0),
      band_lower_pct: bandShare((d) => d < 0),
      band_higher_pct: bandShare((d) => d > 0),
      n_train: fitted.nTrain,
      n_calibration: heldErrors.length,
      n_test: test.length,
    });
  }

  const first = a.series[0].ts.slice(0, 10);
  const last = a.series[a.series.length - 1].ts.slice(0, 10);
  return {
    fitted_on: "data/conduit_master_2025_2026.csv",
    kind,
    name: MODEL_NAMES[kind],
    method: METHODS[kind],
    target: "WBGT in shade, 0.7 x wet bulb + 0.3 x air temperature",
    periods: {
      train: [first, dayBefore(TEST_FROM)],
      calibration: [`${BAND_FROM}-01`, dayBefore(TEST_FROM)],
      test: [TEST_FROM, last],
    },
    climatology_days: CLIMATOLOGY_DAYS,
    band_block_hours: BLOCK_HOURS,
    ...(scale
      ? {
          features: FORECAST_FEATURES,
          feature_mean: scale.mu.map((v) => round(v, 5)),
          feature_std: scale.sd.map((v) => round(v, 5)),
        }
      : {}),
    steps,
  };
}

/** Deterministic pseudo-random numbers, so a refit gives the same clusters. */
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kMeans(points: number[][], k: number, seed: number, iterations = 100) {
  const random = mulberry32(seed);
  const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  // k-means++ initialisation
  const centroids = [points[Math.floor(random() * points.length)]];
  while (centroids.length < k) {
    const d = points.map((p) => Math.min(...centroids.map((c) => dist(p, c))));
    const total = d.reduce((a, b) => a + b, 0);
    let r = random() * total;
    let idx = 0;
    while (r > d[idx]) r -= d[idx++];
    centroids.push(points[idx]);
  }
  let centres = centroids.map((c) => [...c]);
  let labels = new Array(points.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    labels = points.map((p) => {
      let best = 0;
      for (let c = 1; c < k; c++) if (dist(p, centres[c]) < dist(p, centres[best])) best = c;
      return best;
    });
    const next = Array.from({ length: k }, () => new Array(points[0].length).fill(0));
    const counts = new Array(k).fill(0);
    points.forEach((p, i) => {
      counts[labels[i]]++;
      p.forEach((v, j) => (next[labels[i]][j] += v));
    });
    centres = next.map((c, i) => (counts[i] ? c.map((v) => v / counts[i]) : centres[i]));
  }
  const inertia = points.reduce((s, p, i) => s + dist(p, centres[labels[i]]), 0);
  return { centres, labels, inertia };
}

function fitStates(a: Archive) {
  const { series, features, usable } = a;
  const row = (fv: FeatureVector, names: (keyof FeatureVector)[]) => names.map((n) => fv[n]);
  const trainIdx = series.map((_, i) => i).filter((i) => usable[i] && series[i].ts < STATES_TRAIN_UNTIL);

  // States: k-means on the training months, then named by what each cluster is.
  const sScale = featureScale(features, trainIdx, STATE_FEATURES);
  const zs = (fv: FeatureVector) =>
    row(fv, STATE_FEATURES).map((v, j) => (v - sScale.mu[j]) / sScale.sd[j]);
  const points = trainIdx.map((i) => zs(features[i]!));
  const fits = [11, 23, 37].map((seed) => kMeans(points, STATE_COUNT, seed));
  const best = fits.reduce((x, y) => (y.inertia < x.inertia ? y : x));

  const col = (name: keyof FeatureVector) => STATE_FEATURES.indexOf(name);
  const raw = (c: number[], name: keyof FeatureVector) =>
    c[col(name)] * sScale.sd[col(name)] + sScale.mu[col(name)];
  // Coolest centre: cool and humid; warmest: hot. Of the other two, the one
  // warming faster is the morning rise and the other is the evening cooling.
  const clusters = best.centres.map((c, k) => ({ k, c }));
  const byTemp = [...clusters].sort((x, y) => raw(x.c, "temp_sht") - raw(y.c, "temp_sht"));
  const cool = byTemp[0];
  const hot = byTemp[byTemp.length - 1];
  const [p1, p2] = byTemp.slice(1, -1);
  const warming = raw(p1.c, "temp_delta_1h") > raw(p2.c, "temp_delta_1h") ? p1 : p2;
  const cooling = warming === p1 ? p2 : p1;
  const stateOfCluster = new Map([[cool.k, 0], [warming.k, 1], [hot.k, 2], [cooling.k, 3]]);

  const nearest = (x: number[]) => {
    let bestK = 0;
    let bestD = Infinity;
    best.centres.forEach((c, k) => {
      const d = c.reduce((s, v, j) => s + (v - x[j]) ** 2, 0);
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    });
    return stateOfCluster.get(bestK)!;
  };

  // Changes of state are counted after short flips are smoothed away, as the
  // app shows them. For every reading: the state that came next, and when.
  const labels = series.map((_, i) => (usable[i] ? (nearest(zs(features[i]!)) as StateId) : null));
  const smoothed = smoothStates(labels);
  const runs = stateRuns(smoothed);
  const next: ({ to: number; hours: number } | null)[] = series.map(() => null);
  runs.forEach((r, k) => {
    const after = runs[k + 1];
    if (!after) return;
    for (let i = r.start; i < r.end; i++) {
      if (smoothed[i] !== null) next[i] = { to: after.state_id, hours: (a.ms[after.start] - a.ms[i]) / 3600_000 };
    }
  });

  const moves = Array.from({ length: STATE_COUNT }, () => new Array(STATE_COUNT).fill(0));
  runs.slice(1).forEach((r, k) => moves[runs[k].state_id][r.state_id]++);
  const transitions = moves.map((counts, from) => {
    const total = counts.reduce((x, y) => x + y, 0);
    const to = counts.indexOf(Math.max(...counts));
    return { from, to, probability: total ? round(counts[to] / total, 2) : 0, changes: total };
  });

  // Which state comes next, given the state and the three-hour block of the
  // day, from the training months; scored on the months after them.
  const inTraining = (i: number) => series[i].ts < STATES_TRAIN_UNTIL;
  const blockOf = (i: number) => timeOfDayBlock(a.ms[i]);
  const nextRow = (idx: number[]) => {
    const counts = new Array(STATE_COUNT).fill(0);
    idx.forEach((i) => counts[next[i]!.to]++);
    const to = counts.indexOf(Math.max(...counts));
    const hours = idx.filter((i) => next[i]!.to === to).map((i) => next[i]!.hours);
    return { to, probability: round(counts[to] / idx.length, 2), typical_hours: round(quantile(hours, 0.5), 1), n: idx.length };
  };
  const known = series.map((_, i) => i).filter((i) => smoothed[i] !== null && next[i] !== null);
  const trainKnown = known.filter(inTraining);
  const nextState: (ReturnType<typeof nextRow> & { state: number; block: number })[] = [];
  for (let state = 0; state < STATE_COUNT; state++) {
    for (let block = 0; block < 24 / BLOCK_HOURS; block++) {
      const idx = trainKnown.filter((i) => smoothed[i] === state && blockOf(i) === block);
      if (idx.length >= MIN_BLOCK_READINGS) nextState.push({ state, block, ...nextRow(idx) });
    }
  }
  const nextStateAnyTime = [0, 1, 2, 3].map((state) => ({ state, ...nextRow(trainKnown.filter((i) => smoothed[i] === state)) }));
  const predictNext = (i: number) =>
    (nextState.find((r) => r.state === smoothed[i] && r.block === blockOf(i)) ??
      nextStateAnyTime.find((r) => r.state === smoothed[i])!);
  // The hours until that change, finer: by the hour of the day within each block.
  const hourOf = (i: number) => Math.floor(slotOfDay(a.ms[i]) / 4);
  const typicalByHour: { state: number; hour: number; to: number; typical_hours: number; n: number }[] = [];
  for (let state = 0; state < STATE_COUNT; state++) {
    for (let hour = 0; hour < 24; hour++) {
      const idx = trainKnown.filter((i) => smoothed[i] === state && hourOf(i) === hour);
      if (!idx.length) continue;
      const to = predictNext(idx[0]).to;
      const hours = idx.filter((i) => next[i]!.to === to).map((i) => next[i]!.hours);
      if (hours.length >= MIN_BLOCK_READINGS) {
        typicalByHour.push({ state, hour, to, typical_hours: round(quantile(hours, 0.5), 1), n: hours.length });
      }
    }
  }
  const typicalHours = (i: number) =>
    typicalByHour.find((r) => r.state === smoothed[i] && r.hour === hourOf(i) && r.to === predictNext(i).to)
      ?.typical_hours ?? predictNext(i).typical_hours;
  const tested = known.filter((i) => !inTraining(i));
  const right = tested.filter((i) => predictNext(i).to === next[i]!.to);
  const hoursOff = right.map((i) => Math.abs(typicalHours(i) - next[i]!.hours));

  const days = (a.ms[a.ms.length - 1] - a.ms[0]) / 86_400_000;
  const changes = (l: (StateId | null)[]) => {
    const seen = l.filter((x) => x !== null);
    return round(seen.slice(1).filter((x, k) => x !== seen[k]).length / days, 1);
  };

  const summary = [0, 1, 2, 3].map((state) => {
    const cluster = [...stateOfCluster.entries()].find(([, s]) => s === state)![0];
    const members = trainIdx.filter((_, n) => best.labels[n] === cluster);
    const hours = members.map((i) => (new Date(series[i].ts).getUTCHours() + 3) % 24);
    return {
      state,
      share_of_training_slots: round(members.length / trainIdx.length, 3),
      mean_temp_c: round(raw(best.centres[cluster], "temp_sht"), 1),
      mean_humidity_pct: round(raw(best.centres[cluster], "humidity_sht"), 1),
      mean_ir_counts: Math.round(raw(best.centres[cluster], "si1145_ir")),
      mean_temp_change_c_per_h: round(raw(best.centres[cluster], "temp_delta_1h"), 2),
      median_local_hour: quantile(hours, 0.5),
    };
  });

  return {
    fitted_on: "data/conduit_master_2025_2026.csv",
    method: "k-means, 4 clusters, on the training months; named by their centres",
    periods: { train: [series[0].ts.slice(0, 10), dayBefore(STATES_TRAIN_UNTIL.slice(0, 10))] },
    features: STATE_FEATURES,
    feature_mean: sScale.mu.map((v) => round(v, 5)),
    feature_std: sScale.sd.map((v) => round(v, 5)),
    centroids: [0, 1, 2, 3].map((state) => {
      const cluster = [...stateOfCluster.entries()].find(([, s]) => s === state)![0];
      return best.centres[cluster].map((v) => round(v, 4));
    }),
    summary,
    dwell_slots: MIN_DWELL_SLOTS,
    changes_per_day: { unsmoothed: changes(labels), smoothed: changes(smoothed) },
    transitions,
    next_state: nextState,
    next_state_any_time: nextStateAnyTime,
    typical_hours_by_hour: typicalByHour,
    next_state_test: {
      from: STATES_TRAIN_UNTIL.slice(0, 10),
      n: tested.length,
      right_pct: round((right.length / tested.length) * 100, 1),
      typical_hours_median_error: round(quantile(hoursOff, 0.5), 2),
      typical_hours_mean_error: round(hoursOff.reduce((x, y) => x + y, 0) / hoursOff.length, 2),
    },
    n_training_slots: trainIdx.length,
  };
}

function main() {
  const chosen = evaluation.chosen as ModelKind;
  if (!MODEL_KINDS.includes(chosen)) throw new Error(`unknown model in forecast-evaluation.json: ${chosen}`);
  const a = loadArchive();
  console.log(`archive ${a.coverage.minIso} to ${a.coverage.maxIso}, ${a.series.length} slots`);

  const forecast = fitForecast(a, chosen);
  const states = fitStates(a);
  const rain = fitRain(a, evaluation.months);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "wbgt-forecast.json"), JSON.stringify(forecast, null, 1) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "states.json"), JSON.stringify(states, null, 1) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "rain-model.json"), JSON.stringify(rain, null, 1) + "\n");

  console.log(`forecast: ${forecast.name}`);
  for (const s of forecast.steps.filter((s) => [4, 12, 24, 36].includes(s.step))) {
    console.log(
      `+${s.step * 15} min  MAE ${s.test_mae} degC  RMSE ${s.test_rmse}  (no-change ${s.persistence_mae})  ` +
        `band80 ±${s.band80_by_block.join("/")}  covered ${Math.round(s.coverage80 * 1000) / 10}%  ` +
        `same band ${s.band_same_pct}%  lower ${s.band_lower_pct}%  test n=${s.n_test}`,
    );
  }
  console.log("states", JSON.stringify(states.summary));
  console.log("changes per day", JSON.stringify(states.changes_per_day), "transitions", JSON.stringify(states.transitions));
  console.log("next state", JSON.stringify(states.next_state_test));
  const { calibration, by_month: _months, ...rainScores } = rain.evaluation;
  console.log(`rain: ${rain.kind}`, JSON.stringify(rainScores));
  console.log("rain calibration", JSON.stringify(calibration));
}

main();
