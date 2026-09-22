import { test } from "node:test";
import assert from "node:assert/strict";
import { fill, fmtAsOf, fmtDayMonth, fmtSigned } from "../src/lib/afya/format";

test("a date reads as day and month, in either language", () => {
  assert.equal(fmtDayMonth("2026-09-17"), "17 Sep");
  assert.equal(fmtDayMonth("2026-08-05", "sw"), "5 Ago");
});

test("a timestamp is dated by the Nairobi calendar, not UTC", () => {
  // 22:30 UTC on 17 September is 01:30 on the 18th in Nairobi.
  assert.equal(fmtDayMonth("2026-09-17T22:30:00Z"), "18 Sep");
});

test("data from today shows only its time; older data shows its date too", () => {
  const now = Date.parse("2026-09-22T09:16:00Z");
  assert.equal(fmtAsOf("2026-09-22T09:00:00Z", "en", now), "12:00 EAT");
  assert.equal(fmtAsOf("2026-09-08T02:45:00Z", "en", now), "8 Sep, 05:45 EAT");
});

test("the day boundary for data as of is Nairobi midnight", () => {
  // 20:45 UTC is 23:45 in Nairobi, still the 21st; the clock reads 00:15 on the 22nd.
  const now = Date.parse("2026-09-21T21:15:00Z");
  assert.equal(fmtAsOf("2026-09-21T20:45:00Z", "sw", now), "21 Sep, 23:45 EAT");
});

test("placeholders are filled and unknown ones left as they are", () => {
  assert.equal(fill("{pct}% of {what}", { pct: 83, what: "changes" }), "83% of changes");
  assert.equal(fill("about {hours} h, {other}", { hours: 2 }), "about 2 h, {other}");
});

test("signed values carry a plus sign and never show minus zero", () => {
  assert.equal(fmtSigned(0.42), "+0.4");
  assert.equal(fmtSigned(-1.24), "-1.2");
  assert.equal(fmtSigned(-0.04), "0.0");
  assert.equal(fmtSigned(0.3, 2), "+0.30");
});
