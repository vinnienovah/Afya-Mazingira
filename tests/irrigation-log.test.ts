import { test } from "node:test";
import assert from "node:assert/strict";
import { appliedByDate, MAX_ENTRY_MM, normaliseLog, totalAppliedMm } from "../src/lib/afya/irrigation-log";

const TODAY = "2026-09-08";
const WINDOW = 60;

test("a day watered twice is one day's water", () => {
  const log = normaliseLog(
    [
      { date: "2026-09-07", mm: 10 },
      { date: "2026-09-07", mm: 15 },
    ],
    TODAY,
    WINDOW,
  );
  assert.deepEqual(log, [{ date: "2026-09-07", mm: 25 }]);
});

test("records the balance cannot use are dropped", () => {
  const log = normaliseLog(
    [
      { date: "2026-07-01", mm: 20 }, // before the window
      { date: "2026-09-09", mm: 20 }, // after today
      { date: "7 Sep", mm: 20 },
      { date: "2026-09-05", mm: 0 },
      { date: "2026-09-04", mm: -5 },
      { date: "2026-09-03", mm: Number.NaN },
      { date: "2026-09-02", mm: 12 },
    ],
    TODAY,
    WINDOW,
  );
  assert.deepEqual(log, [{ date: "2026-09-02", mm: 12 }]);
});

test("a depth beyond one pass is held at the cap", () => {
  const log = normaliseLog([{ date: "2026-09-06", mm: 900 }], TODAY, WINDOW);
  assert.deepEqual(log, [{ date: "2026-09-06", mm: MAX_ENTRY_MM }]);
});

test("the log comes back in date order, ready for the balance", () => {
  const entries = [
    { date: "2026-09-06", mm: 20 },
    { date: "2026-08-30", mm: 15 },
    { date: "2026-09-01", mm: 5 },
  ];
  const log = normaliseLog(entries, TODAY, WINDOW);
  assert.deepEqual(
    log.map((e) => e.date),
    ["2026-08-30", "2026-09-01", "2026-09-06"],
  );
  assert.equal(totalAppliedMm(log), 40);
  assert.equal(appliedByDate(log).get("2026-09-01"), 5);
});

test("the window is the balance's own, counted back from today", () => {
  const first = normaliseLog([{ date: "2026-07-11", mm: 20 }], TODAY, WINDOW);
  assert.equal(first.length, 1, "the sixtieth day back is inside the window");
  assert.equal(normaliseLog([{ date: "2026-07-10", mm: 20 }], TODAY, WINDOW).length, 0);
});
