import { test } from "node:test";
import assert from "node:assert/strict";
import stateModel from "../src/lib/afya/model/states.json";
import { getCsvRange } from "../src/lib/afya/csv-source";
import { buildFeatureSeries } from "../src/lib/afya/feature-engine";
import {
  buildStateHistory,
  classifyState,
  getNextTransition,
  MIN_DWELL_SLOTS,
  smoothStates,
  stateRuns,
} from "../src/lib/afya/state-engine";
import { loadArchive } from "../scripts/forecast-models";
import type { StateId } from "../src/lib/afya/types";

const MINUTE = 60_000;

test("a flip shorter than an hour never becomes a state, and a settled one starts where it began", () => {
  const raw: (StateId | null)[] = [null, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 2, 1, 1, 3, 3, 3];
  const smoothed = smoothStates(raw);
  assert.deepEqual(smoothed, [null, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const runs = stateRuns(smoothed);
  assert.deepEqual(runs.map((r) => [r.state_id, r.start, r.end]), [[0, 1, 10], [1, 10, 21]]);
});

test("the first state that settles also covers the readings before it", () => {
  assert.deepEqual(smoothStates([2, 3, 3, 3, 3, 3]), [3, 3, 3, 3, 3, 3]);
  assert.deepEqual(smoothStates([2, 3, 2, 3]), [3, 3, 3, 3]);
});

test("on real days no state segment is shorter than an hour, and changes fall to about four a day", () => {
  const series = getCsvRange("2026-01-10T00:00:00Z", "2026-02-10T00:00:00Z");
  const features = buildFeatureSeries(series);
  const timestamps = series.map((o) => o.ts);
  const segments = buildStateHistory(features, timestamps);
  segments.forEach((s, k) => {
    const minutes = (Date.parse(s.end) - Date.parse(s.start)) / MINUTE;
    const last = k === segments.length - 1;
    assert.ok(s.start !== s.end, `${s.start}-${s.end}`);
    assert.ok(minutes >= (last ? (MIN_DWELL_SLOTS - 1) * 15 : MIN_DWELL_SLOTS * 15), `${s.start}-${s.end}`);
    if (k > 0) assert.equal(s.start, segments[k - 1].end);
  });
  const raw = features.filter((fv) => fv).map((fv) => classifyState(fv!));
  const rawChanges = raw.slice(1).filter((x, k) => x !== raw[k]).length;
  const days = 31;
  assert.ok((segments.length - 1) / days < 5, `${segments.length - 1} changes`);
  assert.ok(rawChanges > 1.5 * (segments.length - 1), `${rawChanges} unsmoothed changes`);
});

test("from Hot at 15:00 the most likely next state is Cooling, in about an hour or two", () => {
  const t = getNextTransition(2, "2026-02-10T12:00:00Z");
  assert.equal(t.state_id, 3);
  assert.ok(t.probability >= 0.9);
  assert.ok(t.typical_hours > 0.5 && t.typical_hours < 3, `${t.typical_hours}`);
});

test("what comes next depends on the time of day", () => {
  // Rapid Warming at 10:00 goes on to Hot; late in the afternoon it gives way to Cooling.
  assert.equal(getNextTransition(1, "2026-02-10T07:00:00Z").state_id, 2);
  assert.equal(getNextTransition(1, "2026-02-10T13:30:00Z").state_id, 3);
  // Cool and humid before dawn: warming comes in the morning, hours away.
  const night = getNextTransition(0, "2026-02-10T00:00:00Z");
  assert.equal(night.state_id, 1);
  assert.ok(night.typical_hours > 4);
});

test("on the months after training, the next state by time of day is right most of the time", () => {
  const a = loadArchive();
  const labels = a.series.map((_, i) => (a.usable[i] ? classifyState(a.features[i]!) : null));
  const smoothed = smoothStates(labels);
  const runs = stateRuns(smoothed);
  let right = 0;
  let n = 0;
  runs.forEach((r, k) => {
    const after = runs[k + 1];
    if (!after) return;
    for (let i = r.start; i < r.end; i++) {
      if (smoothed[i] === null || a.series[i].ts < stateModel.next_state_test.from) continue;
      if (getNextTransition(smoothed[i]!, a.series[i].ts).state_id === after.state_id) right++;
      n++;
    }
  });
  assert.ok(right / n >= 0.9, `${right / n}`);
  assert.ok(Math.abs((right / n) * 100 - stateModel.next_state_test.right_pct) < 0.5);
});
