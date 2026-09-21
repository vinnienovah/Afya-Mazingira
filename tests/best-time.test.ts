import { test } from "node:test";
import assert from "node:assert/strict";
import { findBestWindowFromNow } from "../src/lib/afya/best-time-engine";
import type { DataQuality, ForecastPoint } from "../src/lib/afya/types";

const GOOD: DataQuality = { status: "GOOD", freshness_minutes: 10, flags: [], updated_at: "2026-09-01T06:00:00.000Z" };
const START = Date.UTC(2026, 8, 1, 6, 0); // 09:00 EAT

function series(values: number[]): ForecastPoint[] {
  return values.map((value, i) => ({
    time: new Date(START + i * 900_000).toISOString(),
    value, lower: value - 1, upper: value + 1, horizon_minutes: i * 15,
  }));
}

test("the chosen window is always one the forecast covers in full", () => {
  // Cooler at the very end, where only part of an hour is left.
  const points = series([24, 24, 24, 24, 23, 23, 23, 23, 16, 16]);
  const best = findBestWindowFromNow(points, "general", 60, 10, GOOD);
  assert.ok(best);
  const lastPoint = Date.parse(points.at(-1)!.time);
  assert.ok(Date.parse(best.recommended.end) <= lastPoint + 900_000);
  // The two coolest points alone would make a half-covered window; it is not offered.
  assert.ok(Date.parse(best.recommended.start) <= Date.parse(points[6].time));
});

test("no window is offered when the forecast is shorter than the activity", () => {
  assert.equal(findBestWindowFromNow(series([20, 20, 20]), "general", 60, 10, GOOD), null);
});
