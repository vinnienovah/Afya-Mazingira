import { test } from "node:test";
import assert from "node:assert/strict";
import archive from "../src/lib/afya/model/station-health.json";
import { STRINGS } from "../src/lib/afya/i18n";

// What the Station Health page reads out of the published report. The report
// is written by `npm run station-report`; these hold its shape and the
// promises the page makes about it.

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("the archive report carries the score with the battery counted beside the one without", () => {
  const { battery, summary } = archive;
  assert.equal(battery.status, "not_reported", "the archive export carries no battery column");
  assert.ok(summary.mean_score > battery.mean_score_if_counted, "counting the battery can only cost points");
  assert.equal(summary.mean_score - battery.mean_score_if_counted, 10, "an empty listed channel is one bad group");
  assert.equal(battery.best_score_if_counted, 80);
  assert.ok(battery.days_below_80_if_counted > 0);
  assert.equal(summary.days_below_80, 0, "the figure the page must not leave standing on its own");
});

test("a gap is reported between the readings either side of it, not between slot boundaries", () => {
  const longest = archive.gaps.longest;
  assert.ok(longest, "the archive holds at least one silence over an hour");
  const span = (Date.parse(longest.to) - Date.parse(longest.from)) / 3600_000;
  assert.ok(Math.abs(span - longest.hours) < 0.05, "the hours match the times reported");
  assert.ok(!longest.from.endsWith(":00:00.000Z") || !longest.to.endsWith(":00:00.000Z"));
});

test("every health string the page fills exists in both languages with the same placeholders", () => {
  const keys = Object.keys(STRINGS.en).filter((k) => k.startsWith("health_"));
  assert.ok(keys.length > 20);
  for (const k of keys) {
    assert.ok(STRINGS.sw[k], `${k} has no Kiswahili`);
    assert.deepEqual(placeholders(STRINGS.sw[k]), placeholders(STRINGS.en[k]), k);
  }
  // The findings the page fills need every value the report can give them.
  assert.deepEqual(placeholders(STRINGS.en.health_finding_battery), ["below", "best", "days", "mean"]);
  assert.deepEqual(placeholders(STRINGS.en.health_finding_gaps), ["days", "from", "hours", "minutes", "to"]);
});
