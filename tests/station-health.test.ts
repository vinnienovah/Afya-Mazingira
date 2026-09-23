import { test } from "node:test";
import assert from "node:assert/strict";
import archive from "../src/lib/afya/model/station-health.json";
import { STRINGS } from "../src/lib/afya/i18n";
import { SENTINEL_LIMITS } from "../src/lib/afya/sentinel";

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
  // Both halves of the split reach the page, so R14's one number is not read
  // as late arrivals the station never made.
  assert.deepEqual(placeholders(STRINGS.en.health_cadence_note), ["gaps", "intervals", "late"]);

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

// What the page fills into each rule, so a rule that spells a threshold out
// again rather than taking it from the report fails here.
const RULE_PLACEHOLDERS: Record<string, string[]> = {
  health_rule_r01: ["high", "low"],
  health_rule_r02: ["high", "low"],
  health_rule_r03: ["high", "low"],
  health_rule_r04: ["gust", "wind"],
  health_rule_r05: ["high", "low"],
  health_rule_r06: ["floor"],
  health_rule_r07: ["step"],
  health_rule_r08: ["long", "move", "short"],
  health_rule_r09: ["spread"],
  health_rule_r10: [],
  health_rule_r11: ["mm"],
  health_rule_r12: [],
  health_rule_r13: ["share"],
  health_rule_r14: [],
  health_rule_r15: [],
  health_rule_r16: ["margin"],
};

test("the rules table reads its numbers from the limits the report was run with", () => {
  assert.deepEqual(archive.limits, SENTINEL_LIMITS, "the report ships the limits it scored with");
  for (const [key, expected] of Object.entries(RULE_PLACEHOLDERS)) {
    for (const lang of ["en", "sw"] as const) {
      assert.ok(STRINGS[lang][key], `${lang}.${key} is missing`);
      assert.deepEqual(placeholders(STRINGS[lang][key]), expected, `${lang}.${key}`);
    }
  }
  // The values behind the four the page used to spell out.
  const l = archive.limits;
  assert.deepEqual(l.temperature_c, [-5, 45]);
  assert.deepEqual(l.pressure_hpa, [800, 900]);
  assert.equal(l.light_dark_floor_counts, 240);
  assert.equal(l.max_thermometer_spread_c, 2);
  // R08 and R13 are stated in hours and per cent, not in the slots and share
  // the limits hold, so the page derives them.
  assert.equal((l.flat_slots.temp_sht * 15) / 60, 2);
  assert.equal((l.flat_slots.press_bmx * 15) / 60, 3);
  assert.equal(Math.round(l.gust_direction_copy_share * 100), 99);
});

test("the score and its findings quote the penalties the report scored with", () => {
  const expected: Record<string, string[]> = {
    health_score_rule: ["bad", "bad", "minutes", "suspect"],
    health_suspect_tier: ["bad", "suspect"],
  };
  for (const [key, names] of Object.entries(expected)) {
    for (const lang of ["en", "sw"] as const) {
      assert.deepEqual(placeholders(STRINGS[lang][key]), names, `${lang}.${key}`);
    }
  }
  assert.deepEqual(placeholders(STRINGS.en.health_finding_gauges), ["g1", "g2", "mm"]);
  assert.equal(archive.limits.bad_group_penalty, 10);
  assert.equal(archive.limits.suspect_group_penalty, 2);
  assert.equal(archive.limits.missing_minutes_per_point, 14.4);
});

test("every verdict the audits can reach has a name in both languages", () => {
  // The strings sentinel.ts writes, which the page must not print as they are.
  const verdicts: Record<string, string> = {
    "matches Stull": "health_verdict_matches_stull",
    "does not match Stull": "health_verdict_no_match_stull",
    "non-standard": "health_verdict_non_standard",
    "within tolerance": "health_verdict_within_tolerance",
  };
  for (const [english, key] of Object.entries(verdicts)) {
    assert.equal(STRINGS.en[key], english, key);
    assert.ok(STRINGS.sw[key] && STRINGS.sw[key] !== english, `${key} is still English in Kiswahili`);
  }
  for (const audit of [archive.audits.A01_wet_bulb_vs_stull, archive.audits.A03_firmware_wbgt_vs_wet_bulb]) {
    assert.ok(audit.verdict in verdicts, `the report reached an unnamed verdict: ${audit.verdict}`);
  }
});

test("the rain tile says which of the two totals it is", () => {
  // The tile adds up per-slot rain; the gauge's own daily totals, which the
  // findings quote, come to more because these slots carry no reading.
  assert.ok(archive.rain.slots_without_reading > 0);
  assert.ok(archive.rain.slots_without_reading < archive.slots);
  assert.deepEqual(placeholders(STRINGS.en.health_rain_sum_note), ["slots"]);
  for (const lang of ["en", "sw"] as const) {
    assert.notEqual(STRINGS[lang].health_tile_rain, STRINGS[lang].health_tile_gauge2_silent);
    assert.ok(/slot|kipindi/.test(STRINGS[lang].health_tile_rain), `${lang} tile does not say what it counts`);
  }
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
