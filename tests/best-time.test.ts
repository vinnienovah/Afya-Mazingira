import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignToStep, findBestTime, findBestWindowFromNow, isDaylight, sunTimes, windowPoints,
} from "../src/lib/afya/best-time-engine";
import { rainProbabilityAt } from "../src/lib/afya/risk-engine";
import type { DataQuality, ForecastPoint } from "../src/lib/afya/types";

const GOOD: DataQuality = { status: "GOOD", freshness_minutes: 10, flags: [], updated_at: "2026-09-01T06:00:00.000Z" };
const START = Date.UTC(2026, 8, 1, 6, 0); // 09:00 EAT
const HOUR = 3600_000;

function series(values: number[], start = START, stepMs = 900_000): ForecastPoint[] {
  return values.map((value, i) => ({
    time: new Date(start + i * stepMs).toISOString(),
    value, lower: value - 1, upper: value + 1, horizon_minutes: i * 15,
  }));
}

// EAT clock time on 1 September 2026 as an ISO string.
const eat = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 8, 1, h - 3, m)).toISOString();
};
const clock = (iso: string) => new Date(Date.parse(iso) + 3 * HOUR).toISOString().slice(11, 16);

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

test("a window is never placed where the forecast has run out", () => {
  // The live case: a forecast that ends at 17:45 and a two-hour session asked for
  // until 18:30. Every offered window has all eight of its points.
  const points = series(Array.from({ length: 36 }, (_, i) => (i < 30 ? 22 : 17)));
  const best = findBestTime("sports", 120, eat("09:00"), eat("18:30"), points, GOOD);
  assert.ok(best);
  assert.ok(Date.parse(best.recommended.end) <= Date.parse(points.at(-1)!.time) + 900_000);
  assert.equal(best.coverage.points, 8);
  assert.equal(best.coverage.step_minutes, 15);
  // A range whose only window runs past the forecast: nothing, rather than a
  // window judged on the five points it has.
  assert.equal(findBestTime("sports", 120, eat("16:30"), eat("18:30"), points, GOOD), null);
});

test("no window starts before now, and starts sit on the quarter hour", () => {
  const points = series(Array.from({ length: 37 }, () => 20));
  const best = findBestTime("general", 60, eat("09:00"), eat("18:00"), points, GOOD, { nowIso: eat("12:03") });
  assert.ok(best);
  assert.ok(Date.parse(best.recommended.start) >= Date.parse(eat("12:15")));
  assert.equal(Date.parse(best.recommended.start) % 900_000, 0);
  // Fully in the past: nothing to offer.
  assert.equal(findBestTime("general", 60, eat("08:00"), eat("11:00"), points, GOOD, { nowIso: eat("12:03") }), null);
});

test("a range that starts at an odd minute still gives quarter-hour windows", () => {
  const points = series(Array.from({ length: 37 }, (_, i) => 20 - i * 0.05));
  const best = findBestWindowFromNow(points, "general", 60, 10, GOOD, eat("09:46"));
  assert.ok(best);
  assert.match(clock(best.recommended.start), /:(00|15|30|45)$/);
  assert.match(clock(best.recommended.end), /:(00|15|30|45)$/);
  if (best.alternative) assert.match(clock(best.alternative.start), /:(00|15|30|45)$/);
  assert.equal(alignToStep(Date.parse(eat("17:46"))), Date.parse(eat("18:00")));
  assert.equal(alignToStep(Date.parse(eat("17:45"))), Date.parse(eat("17:45")));
});

test("daylight at the station runs from about 06:20 to 18:30 in September", () => {
  const sun = sunTimes(Date.parse("2026-09-22T09:00:00Z"));
  assert.equal(clock(new Date(sun.sunrise).toISOString()), "06:21");
  assert.equal(clock(new Date(sun.sunset).toISOString()), "18:27");
  assert.equal(isDaylight("2026-09-22T03:10:00Z"), false); // 06:10 EAT
  assert.equal(isDaylight("2026-09-22T03:30:00Z"), true); // 06:30
  assert.equal(isDaylight("2026-09-22T15:20:00Z"), true); // 18:20
  assert.equal(isDaylight("2026-09-22T15:40:00Z"), false); // 18:40
  assert.equal(isDaylight("not a time"), false);
  // Near the equator the day stays close to twelve hours all year.
  for (let month = 0; month < 12; month++) {
    const s = sunTimes(Date.UTC(2026, month, 15, 9));
    const hours = (s.sunset - s.sunrise) / HOUR;
    assert.ok(hours > 12 && hours < 12.3, `month ${month + 1}: ${hours}`);
  }
});

test("outdoor windows are kept between sunrise and sunset", () => {
  // Cool after dark: the night would win on exposure alone.
  const start = Date.parse(eat("15:00"));
  const points = series(Array.from({ length: 29 }, (_, i) => (i < 14 ? 23 : 15)), start);
  const best = findBestTime("sports", 60, eat("15:00"), eat("22:00"), points, GOOD);
  assert.ok(best);
  assert.ok(isDaylight(best.recommended.start) && isDaylight(best.recommended.end));
  assert.equal(findBestTime("sports", 60, eat("19:00"), eat("22:00"), points, GOOD), null);
  const night = findBestTime("sports", 60, eat("19:00"), eat("22:00"), points, GOOD, { daylightOnly: false });
  assert.ok(night);
});

test("radiation is only said to be declining after solar noon", () => {
  const points = series(Array.from({ length: 37 }, () => 20));
  const morning = findBestTime("general", 60, eat("09:00"), eat("11:00"), points, GOOD);
  const afternoon = findBestTime("general", 60, eat("13:00"), eat("15:00"), points, GOOD);
  assert.ok(morning && afternoon);
  assert.ok(!morning.recommended.reasons.includes("reason_radiation_declining"));
  assert.ok(afternoon.recommended.reasons.includes("reason_radiation_declining"));
});

test("low rain is only claimed when a rain chance is given and it is low", () => {
  const points = series(Array.from({ length: 37 }, () => 20));
  const run = (rainProbability?: number) =>
    findBestTime("general", 60, eat("09:00"), eat("12:00"), points, GOOD, { rainProbability })!.recommended.reasons;
  assert.ok(!run().includes("reason_low_rain"));
  assert.ok(!run(0.45).includes("reason_low_rain"));
  assert.ok(run(0.05).includes("reason_low_rain"));
  const wetLater = (iso: string) => (Date.parse(iso) >= Date.parse(eat("10:00")) ? 0.6 : 0.05);
  const byTime = findBestTime("general", 60, eat("09:00"), eat("12:00"), points, GOOD, { rainProbability: wetLater })!;
  assert.equal(byTime.recommended.start, eat("09:00"));
  assert.ok(byTime.recommended.reasons.includes("reason_low_rain"));
});

test("a window the rain model does not reach in full is left without a rain claim", () => {
  const points = series(Array.from({ length: 37 }, () => 20), Date.parse(eat("09:00")));
  const rainProbability = rainProbabilityAt(0.05, eat("09:00")); // covers 09:00 to 12:00
  const reasons = (from: string, to: string) =>
    findBestTime("general", 60, from, to, points, GOOD, { rainProbability })!.recommended.reasons;
  assert.ok(reasons(eat("09:00"), eat("10:00")).includes("reason_low_rain"));
  // A window whose last forecast point is the model's last minute still holds.
  assert.ok(reasons(eat("11:00"), eat("12:00")).includes("reason_low_rain"));
  // One that starts past the model does not, and neither does one hours beyond it.
  assert.ok(!reasons(eat("12:15"), eat("13:15")).includes("reason_low_rain"));
  assert.ok(!reasons(eat("14:00"), eat("16:00")).includes("reason_low_rain"));
});

test("rain ranks the windows only when the model reaches every one of them", () => {
  const points = series(Array.from({ length: 37 }, () => 20), Date.parse(eat("09:00")));
  // Known and wet early, unknown later: the field is mixed, so rain is left
  // out of the ranking and the earliest window still wins on the tie-breakers.
  const wetEarly = (iso: string) => (Date.parse(iso) < Date.parse(eat("11:00")) ? 0.6 : null);
  const mixed = findBestTime("general", 60, eat("09:00"), eat("13:00"), points, GOOD, { rainProbability: wetEarly })!;
  assert.equal(mixed.recommended.start, eat("09:00"));
  assert.ok(!mixed.recommended.reasons.includes("reason_low_rain"));
  // Known throughout: the driest window wins.
  const wetFirst = (iso: string) => (Date.parse(iso) < Date.parse(eat("11:00")) ? 0.6 : 0.05);
  const known = findBestTime("general", 60, eat("09:00"), eat("13:00"), points, GOOD, { rainProbability: wetFirst })!;
  assert.equal(known.recommended.start, eat("11:00"));
  assert.ok(known.recommended.reasons.includes("reason_low_rain"));
});

test("lower exposure and data quality are only claimed when they hold", () => {
  const flat = series(Array.from({ length: 37 }, () => 20));
  const flatBest = findBestTime("general", 60, eat("09:00"), eat("12:00"), flat, GOOD)!;
  assert.ok(!flatBest.recommended.reasons.includes("reason_lower_exposure"));
  assert.ok(flatBest.recommended.reasons.includes("reason_quality_good"));

  const warming = series(Array.from({ length: 37 }, (_, i) => 17 + i * 0.2));
  const early = findBestTime("general", 60, eat("09:00"), eat("15:00"), warming, null)!;
  assert.equal(early.recommended.start, eat("09:00"));
  assert.ok(early.recommended.reasons.includes("reason_lower_exposure"));
  // A forecast the station did not make never earns the data-quality reason.
  assert.ok(!early.recommended.reasons.includes("reason_quality_good"));
});

test("an hourly forecast covers a window only with a point for every hour it touches", () => {
  const hourly = series([20, 21, 22, 23, 22], START, HOUR); // 09:00 to 13:00 EAT
  assert.equal(windowPoints(hourly, Date.parse(eat("09:15")), Date.parse(eat("11:15")))?.length, 3);
  assert.equal(windowPoints(hourly, Date.parse(eat("12:30")), Date.parse(eat("14:30"))), null);
  const best = findBestTime("general", 90, eat("09:00"), eat("14:00"), hourly, null)!;
  assert.equal(best.coverage.step_minutes, 60);
  assert.equal(best.recommended.start, eat("09:00"));
  assert.equal(best.recommended.peak_wbgt_c, 21);
});

test("poor data quality gives no window", () => {
  const points = series(Array.from({ length: 37 }, () => 20));
  assert.equal(findBestTime("general", 60, eat("09:00"), eat("12:00"), points, { ...GOOD, status: "POOR" }), null);
});
