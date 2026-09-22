import type { FeatureVector } from "./feature-engine";
import type { StateId } from "./types";
import { slotOfDay, timeOfDayBlock } from "./climatology";
import model from "./model/states.json";

// Climate Reflex states: k-means with four clusters on the Conduit archive's
// training months (scripts/fit-models.ts), each cluster named by its centre.
// An observation takes the state of the nearest centre in scaled feature space.
// A passing cloud can flip that for a single reading, so a change of state only
// counts once the new state has held for MIN_DWELL_SLOTS readings in a row.

export const STATE_MODEL_SUMMARY = model.summary;

/** Readings (15 minutes each) a new state must hold before it counts. */
export const MIN_DWELL_SLOTS = 4;

export function classifyState(fv: FeatureVector): StateId {
  let best: StateId = 0;
  let bestDist = Infinity;
  model.centroids.forEach((centre, state) => {
    let dist = 0;
    model.features.forEach((name, j) => {
      const x = (fv[name as keyof FeatureVector] - model.feature_mean[j]) / model.feature_std[j];
      dist += (x - centre[j]) ** 2;
    });
    if (dist < bestDist) {
      bestDist = dist;
      best = state as StateId;
    }
  });
  return best;
}

/**
 * Labels with every change shorter than `dwell` readings removed. A new state
 * takes over once it has held for `dwell` readings in a row, from the reading
 * it started at; until then the previous state carries on. Missing labels
 * stay missing and do not break a run.
 */
export function smoothStates(labels: (StateId | null)[], dwell = MIN_DWELL_SLOTS): (StateId | null)[] {
  const out: (StateId | null)[] = labels.map(() => null);
  let current: StateId | null = null;
  let run: StateId | null = null;
  let runStart = -1;
  let runLength = 0;
  const fill = (from: number, to: number, state: StateId) => {
    for (let k = from; k <= to; k++) if (labels[k] !== null) out[k] = state;
  };
  labels.forEach((label, i) => {
    if (label === null) return;
    if (label === run) {
      runLength++;
    } else {
      run = label;
      runStart = i;
      runLength = 1;
    }
    if (runLength >= dwell && label !== current) {
      // The first settled state also covers the readings before it.
      fill(current === null ? 0 : runStart, i, label);
      current = label;
    } else if (current !== null) {
      out[i] = current;
    }
  });
  // Never settled: the latest reading is the best guess for all of it.
  if (current === null && run !== null) fill(0, labels.length - 1, run);
  return out;
}

/** Runs of one state in smoothed labels, by index; `end` is where the next run starts. */
export function stateRuns(smoothed: (StateId | null)[]): { state_id: StateId; start: number; end: number }[] {
  const runs: { state_id: StateId; start: number; end: number }[] = [];
  smoothed.forEach((state, i) => {
    if (state === null) return;
    const last = runs[runs.length - 1];
    if (last && last.state_id === state) return;
    if (last) last.end = i;
    runs.push({ state_id: state, start: i, end: smoothed.length });
  });
  return runs;
}

/**
 * State history for a series: each segment runs from the reading its state
 * settled at to the one where the next state did, so segments tile the
 * series and none is shorter than MIN_DWELL_SLOTS readings.
 */
export function buildStateHistory(
  featureSeries: (FeatureVector | null)[],
  timestamps: string[],
  dwell = MIN_DWELL_SLOTS,
): { state_id: StateId; start: string; end: string }[] {
  const smoothed = smoothStates(featureSeries.map((fv) => (fv ? classifyState(fv) : null)), dwell);
  const last = timestamps[timestamps.length - 1];
  return stateRuns(smoothed).map((r) => ({
    state_id: r.state_id,
    start: timestamps[r.start],
    end: r.end < timestamps.length ? timestamps[r.end] : last,
  }));
}

/** Find the current state's "since" timestamp from a segmented history. */
export function stateSince(segments: { state_id: StateId; start: string; end: string }[], currentState: StateId): string {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].state_id === currentState) return segments[i].start;
  }
  return new Date().toISOString();
}

/**
 * The state that most often came next after this one in the same three-hour
 * block of the day in the training months, how often it did, and the median
 * hours until it did from this hour of the day.
 */
export function getNextTransition(
  current: StateId,
  nowIso: string,
): { state_id: StateId; probability: number; typical_hours: number } {
  const ms = Date.parse(nowIso);
  const block = timeOfDayBlock(ms);
  const hour = Math.floor(slotOfDay(ms) / 4);
  const row =
    model.next_state.find((r) => r.state === current && r.block === block) ??
    model.next_state_any_time.find((r) => r.state === current)!;
  const hours = model.typical_hours_by_hour.find((r) => r.state === current && r.hour === hour && r.to === row.to);
  return {
    state_id: row.to as StateId,
    probability: row.probability,
    typical_hours: hours?.typical_hours ?? row.typical_hours,
  };
}
