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

test("the published report carries the cadence rule and the heat-index audit", () => {
  const a02 = archive.audits.A02_heat_index_vs_nws;
  assert.ok(a02.mae_c !== null && a02.mae_hot_c !== null);
  assert.equal(a02.hot_from_c, 27);
  assert.ok(a02.hot_slots > 0 && a02.hot_slots < a02.slots);
  assert.ok(a02.mae_hot_c < a02.mae_c, "the NWS formula agrees best in the heat it is built for");
  assert.ok(!("verdict" in a02), "A02 is reported, not judged");

  // R14 reaches the report against every slot inside a silence. The archive
  // is sampled about every 15 minutes, where a skipped reading is already a
  // silence, so it holds no late slot to record.
  assert.equal(archive.rule_slots.R14, archive.cadence.gap_slots);
  assert.equal(archive.cadence.late_slots, 0);
  assert.equal(archive.cadence.late_intervals, 0);

  // R15 cannot be judged from an export without the column, and says so.
  assert.equal(archive.device_codes.reported, false, "no Conduit export carries the Health column");
  assert.deepEqual(archive.device_codes.codes, []);
  assert.equal(archive.device_codes.note, "meaning undocumented");
  assert.ok(!("R15" in archive.rule_slots), "and fires on nothing");
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

test("the archive is dated by the days it holds, not by a month written into the page", () => {
  for (const key of ["health_archive_span", "health_archive_conduit_only"]) {
    assert.deepEqual(placeholders(STRINGS.en[key]), ["from", "to"], key);
  }
  // The report ends well before the day it is read on, so the span may not be
  // written out as the month it opens in: a stale end date is what goes wrong.
  for (const lang of ["en", "sw"] as const) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      if (key.startsWith("health_")) assert.ok(!/(June|Juni) 2025/.test(value), `${lang}.${key} dates the archive by its first month alone`);
    }
  }
  assert.equal(archive.first.slice(0, 10), "2025-06-01");
  assert.ok(archive.last.slice(0, 10) > "2026-06-01", "the last day comes from the report, whatever it is");
});
