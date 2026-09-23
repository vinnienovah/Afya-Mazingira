import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  buildReplayFrames, isInTrainingPeriod, lastReplayDay, replayDateProblem, summariseHorizons,
  REPLAY_FIRST_DAY, TRAINING_PERIOD, type ReplayFrame,
} from "../src/lib/afya/replay";
import { getCsvRange } from "../src/lib/afya/csv-source";
import type { DemoObservation } from "../src/lib/afya/demo-observations";
import type { ReplayStep } from "../src/lib/afya/pipeline";
import type { SituationResult } from "../src/lib/afya/types";

const HOUR = 3600_000;
const eat = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 8, 1, h - 3, m);
};
const iso = (ms: number) => new Date(ms).toISOString();

function obs(ms: number, wbgt: number, imputed: string[] = []): DemoObservation {
  return {
    ts: iso(ms), rg1: 0, rg2: 0, rg1tt: 0, rg2tt: 0, temp_bmx: 22, press_bmx: 851, temp_mcp: 22, temp_sht: 22,
    humidity_sht: 60, si1145_vis: 300, si1145_ir: 900, si1145_uv: 0, wind_spd: 1, wind_dir: 90, wind_gust: 2,
    heat_idx: 22, wet_bulb_temp: 16, wet_bulb_globe_temp: wbgt, imputed,
  };
}

// A step issued at `anchor` whose forecasts are all `forecast`, and whose
// newest observation is at `observed`, reading `measured` degC.
function step(anchor: number, forecast: number, observed = anchor, best?: [string, string], measured = forecast): ReplayStep {
  const situation = {
    generated_at: iso(observed),
    demo_mode: false,
    current: { time: iso(observed), wbgt_c: measured },
    forecast: (["1h", "3h", "6h", "9h"] as const).map((horizon) => ({
      horizon, value: forecast, lower: forecast - 1, upper: forecast + 1, model: "Ridge regression", model_version: "x",
    })),
    best_time: best
      ? { recommended: { start: iso(eat(best[0])), end: iso(eat(best[1])), reasons: [] }, alternative: null, activity: "general", duration_minutes: 60 }
      : null,
  } as unknown as SituationResult;
  return { sim_time: iso(anchor), situation };
}

// Recorded every 15 minutes from 06:00 to midnight: 18 degC, 22 degC from 12:00 to 15:00.
function day(): DemoObservation[] {
  const out: DemoObservation[] = [];
  for (let t = eat("06:00"); t < eat("23:59"); t += 900_000) {
    const hour = (t - eat("00:00")) / HOUR;
    out.push(obs(t, hour >= 12 && hour < 15 ? 22 : 18));
  }
  return out;
}

test("each forecast is set against what the station recorded when it came due", () => {
  const frames = buildReplayFrames([step(eat("09:00"), 20)], day());
  const [f] = frames;
  assert.equal(f.available, true);
  const byHorizon = Object.fromEntries(f.checks.map((c) => [c.horizon, c]));
  assert.equal(byHorizon["1h"].target, iso(eat("10:00")));
  assert.equal(byHorizon["1h"].recorded, 18);
  assert.equal(byHorizon["1h"].error, 2);
  assert.equal(byHorizon["3h"].recorded, 22); // 12:00
  assert.equal(byHorizon["3h"].error, -2);
  assert.equal(byHorizon["9h"].target, iso(eat("18:00")));
});

test("a slot the station filled in rather than measured is not used as a recording", () => {
  const record = day().map((o) => (o.ts === iso(eat("10:00")) ? { ...o, imputed: ["temp_sht"] } : o));
  const [f] = buildReplayFrames([step(eat("09:00"), 20)], record);
  const check = f.checks.find((c) => c.horizon === "1h")!;
  assert.equal(check.recorded, null);
  assert.equal(check.error, null);
});

test("frames made from data far older than their hour are marked unavailable", () => {
  const stale = step(eat("15:00"), 20, eat("15:00") - 30 * HOUR);
  const [f] = buildReplayFrames([stale], day());
  assert.equal(f.available, false);
  assert.deepEqual(f.checks, []);
  const synthetic = step(eat("15:00"), 20);
  (synthetic.situation as { demo_mode: boolean }).demo_mode = true;
  assert.equal(buildReplayFrames([synthetic], day())[0].available, false);
});

test("the recommended window is compared with the midday window by recorded peak", () => {
  const [f] = buildReplayFrames([step(eat("08:00"), 20, eat("08:00"), ["09:00", "10:00"])], day());
  assert.deepEqual(f.recommended, { start: iso(eat("09:00")), end: iso(eat("10:00")), peak: 18 });
  assert.deepEqual(f.midday, { start: iso(eat("12:00")), end: iso(eat("13:00")), peak: 22 });
  // A window with a gap in the record has no recorded peak rather than a partial one.
  const gappy = day().filter((o) => o.ts !== iso(eat("12:30")));
  assert.equal(buildReplayFrames([step(eat("08:00"), 20, eat("08:00"), ["09:00", "10:00"])], gappy)[0].midday?.peak, null);
});

test("the day's errors are summarised per horizon", () => {
  const frames: ReplayFrame[] = buildReplayFrames([step(eat("09:00"), 20), step(eat("10:00"), 18.5)], day());
  const one = summariseHorizons(frames).find((s) => s.horizon === "1h")!;
  assert.equal(one.n, 2);
  assert.equal(one.mae, 1.25); // |20 - 18| and |18.5 - 18|
  assert.equal(one.within_band, 0.5);
});

test("each forecast carries the error of holding the reading it was issued from", () => {
  // Issued at 09:00 from a reading of 19 degC, forecasting 20 degC throughout.
  const [f] = buildReplayFrames([step(eat("09:00"), 20, eat("09:00"), undefined, 19)], day());
  const byHorizon = Object.fromEntries(f.checks.map((c) => [c.horizon, c]));
  assert.equal(byHorizon["1h"].persistence_error, 1); // 19 held against 18 recorded
  assert.equal(byHorizon["3h"].persistence_error, -3); // 19 held against 22 recorded
  assert.equal(byHorizon["1h"].error, 2);
});

test("the day's panel sets the model against doing nothing over the same checks", () => {
  const frames = buildReplayFrames(
    [step(eat("09:00"), 20, eat("09:00"), undefined, 19), step(eat("10:00"), 18.5, eat("10:00"), undefined, 18)],
    day(),
  );
  const three = summariseHorizons(frames).find((s) => s.horizon === "3h")!;
  assert.equal(three.n, 2);
  assert.equal(three.mae, 2.75); // |20 - 22| and |18.5 - 22|
  assert.equal(three.persistence_mae, 3.5); // |19 - 22| and |18 - 22|
  // A horizon nothing was recorded for has neither figure rather than a zero.
  const none = summariseHorizons(buildReplayFrames([step(eat("20:00"), 20)], day())).find((s) => s.horizon === "9h")!;
  assert.equal(none.mae, null);
  assert.equal(none.persistence_mae, null);
});

test("a replay date the coefficients were fitted on is known for one", () => {
  const [from, to] = TRAINING_PERIOD;
  assert.equal(from, REPLAY_FIRST_DAY, "the picker opens on the first day of the fit");
  assert.ok(isInTrainingPeriod(from));
  assert.ok(isInTrainingPeriod(to));
  assert.ok(isInTrainingPeriod("2026-01-15"));
  assert.equal(isInTrainingPeriod("2026-06-01"), false);
  assert.equal(isInTrainingPeriod("2026-09-01"), false);
});

test("replay dates run from the archive's first day to yesterday in Nairobi", () => {
  const now = Date.UTC(2026, 8, 22, 22, 0); // 01:00 EAT on 23 September
  assert.equal(lastReplayDay(now), "2026-09-22");
  assert.equal(replayDateProblem("2026-09-22", now), null);
  assert.equal(replayDateProblem("2025-06-01", now), null);
  assert.ok(replayDateProblem("2026-09-23", now));
  assert.ok(replayDateProblem("2025-05-31", now));
  assert.ok(replayDateProblem("2026-02-30", now));
  assert.ok(replayDateProblem("yesterday", now));
  assert.ok(replayDateProblem(20260901, now));
});

async function replay(body: string) {
  const { POST } = await import("../src/app/api/replay/route");
  const res = await POST(new NextRequest("http://localhost/api/replay", {
    method: "POST", body, headers: { "content-type": "application/json" },
  }));
  return { status: res.status, data: await res.json() };
}

test("the replay endpoint answers a bad date with a 400", async () => {
  assert.equal((await replay("{oops")).status, 400);
  assert.equal((await replay(JSON.stringify({ date: "2026-02-30" }))).status, 400);
  assert.equal((await replay(JSON.stringify({ date: "2099-01-01" }))).status, 400);
  assert.equal((await replay(JSON.stringify({}))).status, 400);
});

test("a replayed archive day is revealed against the archive's own readings", async () => {
  const { status, data } = await replay(JSON.stringify({ date: "2026-09-01" }));
  assert.equal(status, 200);
  const frames = data.steps as ReplayFrame[];
  assert.equal(frames.length, 13);
  assert.ok(frames.every((f) => f.available));
  // Every frame starts from its own hour's data, not one frame repeated.
  assert.equal(new Set(frames.map((f) => f.observed_at)).size, 13);
  const record = getCsvRange("2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");
  const wbgtMeasured = (o: (typeof record)[number]) =>
    !["temp_sht", "humidity_sht", "wet_bulb_temp"].some((f) => o.imputed?.includes(f));
  const measured = new Map(record.filter(wbgtMeasured).map((o) => [o.ts, o.wet_bulb_globe_temp]));
  let compared = 0;
  for (const c of frames.flatMap((f) => f.checks)) {
    if (c.recorded === null) continue;
    const truth = measured.get(c.target);
    if (truth === undefined) continue;
    assert.equal(c.recorded, Math.round(truth * 10) / 10, c.target);
    assert.ok(Math.abs(c.error! - (c.forecast - c.recorded)) < 0.051);
    assert.ok(Number.isFinite(c.persistence_error), `no baseline at ${c.target}`);
    compared++;
  }
  assert.ok(compared >= 30, `only ${compared} checks compared`);
  for (const s of data.summary as { mae: number | null; persistence_mae: number | null }[]) {
    assert.ok(s.mae !== null && s.persistence_mae !== null);
    assert.ok(Number.isFinite(s.persistence_mae) && s.persistence_mae > 0);
  }
});
