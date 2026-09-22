import { test } from "node:test";
import assert from "node:assert/strict";
import { audits, checkReadings, dailyHealth, gaps, groupStatus, rainDayTotals } from "../src/lib/afya/sentinel";
import { cleanAndGrid } from "../src/lib/afya/sources";
import { stullWetBulb } from "../src/lib/afya/constants";
import type { DemoObservation } from "../src/lib/afya/demo-observations";

// 21:00 UTC is midnight in Nairobi.
const NAIROBI_MIDNIGHT = Date.UTC(2026, 0, 9, 21);

// Nairobi days of 15-minute slots that pass every rule.
function days(
  count: number,
  patch: (o: DemoObservation, i: number) => Partial<DemoObservation> = () => ({}),
): DemoObservation[] {
  return Array.from({ length: 96 * count }, (_, i) => {
    const temp = 18 + 6 * Math.sin((i / 96) * 2 * Math.PI) + (i % 3) * 0.05;
    const rh = 70 - 20 * Math.sin((i / 96) * 2 * Math.PI) + (i % 2) * 0.1;
    const wb = stullWetBulb(temp, rh);
    const o: DemoObservation = {
      ts: new Date(NAIROBI_MIDNIGHT + i * 900_000).toISOString(),
      rg1: 0, rg2: 0, rg1tt: 0, rg2tt: 0,
      temp_bmx: temp - 0.3, press_bmx: 850 + (i % 4) * 0.1, temp_mcp: temp - 0.2, temp_sht: temp,
      humidity_sht: rh, si1145_vis: 300 + (i % 96), si1145_ir: 400 + (i % 96) * 10, si1145_uv: 0,
      wind_spd: 1 + (i % 5) * 0.1, wind_dir: 90, wind_gust: 2 + (i % 5) * 0.1, heat_idx: temp,
      wet_bulb_temp: wb, wet_bulb_globe_temp: 0.7 * wb + 0.3 * temp, firmware_wbgt: wb + 0.5, imputed: [],
    };
    return { ...o, ...patch(o, i) };
  });
}
const day = (patch?: (o: DemoObservation, i: number) => Partial<DemoObservation>) => days(1, patch);

test("a clean day scores 100 with every group good", () => {
  const series = day();
  assert.deepEqual(checkReadings(series), []);
  const [health] = dailyHealth(series);
  assert.equal(health.date, "2026-01-10");
  assert.equal(health.score, 100);
  assert.ok(groupStatus(series).every((g) => g.status === "good"));
});

test("days run from midnight to midnight in Nairobi, not UTC", () => {
  const series = days(1).slice(-16).concat(days(2).slice(96, 104));
  assert.deepEqual(dailyHealth(series).map((d) => d.date), ["2026-01-10", "2026-01-11"]);
  assert.equal(series[16].ts, "2026-01-10T21:00:00.000Z");
});

test("a thermometer stuck while the others move is caught", () => {
  const series = day((o, i) => (i >= 40 && i < 50 ? { temp_sht: 21.5 } : {}));
  assert.ok(checkReadings(series).some((h) => h.rule === "R08" && h.channel === "temp_sht"));
});

test("a calm night is not a stuck thermometer", () => {
  // Three hours at 15.0 °C while the other two move by 0.3 °C at most.
  const series = day((o, i) =>
    i >= 8 && i < 20 ? { temp_sht: 15, temp_bmx: 14.7 + (i % 4) * 0.1, temp_mcp: 14.8 + (i % 2) * 0.1 } : {},
  );
  assert.ok(!checkReadings(series).some((h) => h.rule === "R08"));
  assert.equal(dailyHealth(series)[0].score, 100);
});

test("calm wind is not mistaken for a stuck sensor", () => {
  const series = day((o, i) => (i < 30 ? { wind_spd: 0 } : {}));
  assert.ok(!checkReadings(series).some((h) => h.rule === "R08" && h.channel === "wind_spd"));
});

test("a sensor silent all day makes its group bad and costs 10 points", () => {
  const series = day(() => ({ imputed: ["press_bmx"] }));
  const [health] = dailyHealth(series);
  assert.ok(health.bad.includes("pressure"));
  assert.ok(health.rules.includes("R12"));
  assert.equal(health.score, 90);
});

test("a gauge silent through a rain day in which the other measured rain is suspect, by the gauges' own totals", () => {
  // Gauge 1 reports 1.2 mm for the rain day that began at 09:00 on the 10th, gauge 2 nothing.
  const series = days(2, (o, i) => (i >= 36 + 96 ? { rg1tp: 1.2, rg2tp: 0 } : {}));
  assert.deepEqual(rainDayTotals(series).get("2026-01-10"), [1.2, 0]);
  const [first, second] = dailyHealth(series);
  assert.ok(first.rules.includes("R11"));
  assert.ok(first.suspect.includes("rain_gauge_2"));
  assert.ok(!second.rules.includes("R11"));
  assert.equal(groupStatus(series).find((g) => g.group === "rain_gauge_2")!.status, "suspect");

  // Both gauges reporting their share is not a disagreement.
  const agreeing = days(2, (o, i) => (i >= 36 + 96 ? { rg1tp: 1.2, rg2tp: 1.0 } : {}));
  assert.ok(!dailyHealth(agreeing)[0].rules.includes("R11"));
});

test("a gauge whose running total is not exported still counts as reporting through its daily total", () => {
  const series = day((o) => ({ imputed: ["rg2"], rg1tp: 0, rg2tp: 0 }));
  const [health] = dailyHealth(series);
  assert.ok(!health.rules.includes("R12"));
  assert.equal(health.score, 100);
});

test("on the CHORDS feed silent gauges are not judged, while rain that falls is", () => {
  const dry = day();
  const rain = (feed: "chords" | null, series = dry) =>
    groupStatus(series, checkReadings(series), { feed }).find((g) => g.group === "rain_gauge_2")!;
  assert.equal(rain("chords").status, "not_judged");
  assert.equal(rain(null).status, "good");
  assert.equal(dailyHealth(dry, checkReadings(dry), { feed: "chords" })[0].score, 100);

  const wet = day((o, i) => (i === 50 ? { rg1: 0.6 } : {}));
  assert.equal(rain("chords", wet).status, "good");
});

test("missing time comes from gaps between readings, not from empty slots", () => {
  const silence = { from: "2026-01-09T23:22:00.000Z", to: "2026-01-10T00:37:00.000Z" };
  const series = day((o, i) => (i >= 10 && i < 14 ? { gap_minutes: 15, gap: silence } : {}));
  const [health] = dailyHealth(series);
  assert.equal(health.missing_minutes, 60);
  assert.ok(Math.abs(health.score - (100 - 60 / 14.4)) < 0.06);
  // Reported between the readings either side, not between the slots they fall in.
  assert.deepEqual(gaps(series), [{ ...silence, hours: 1.3 }]);
});

test("the station's 906-second cadence costs nothing, a real outage does", () => {
  const reading = (ms: number) => ({
    ts: new Date(ms).toISOString(),
    temp_sht: 20, temp_bmx: 20.3, temp_mcp: 20.1, humidity_sht: 60, press_bmx: 850, wind_spd: 1, wind_dir: 90,
    wind_gust: 2, si1145_vis: 300, si1145_ir: 800, wet_bulb_temp: 15, heat_idx: 20, rg1tt: 0, rg2tt: 0,
  });
  // Starting 14 minutes into a slot, the tenth reading skips a quarter hour.
  const times = Array.from({ length: 95 }, (_, i) => NAIROBI_MIDNIGHT + 14 * 60_000 + i * 906_000);
  const drift = cleanAndGrid(times.map(reading));
  assert.ok(drift.some((o) => o.imputed?.includes("temp_sht")), "some quarter hours hold no reading");
  assert.equal(dailyHealth(drift)[0].missing_minutes, 0);

  const outage = cleanAndGrid(times.filter((ms, i) => i < 40 || i > 47).map(reading));
  assert.equal(Math.round(dailyHealth(outage)[0].missing_minutes), 121);
  assert.equal(gaps(outage).length, 1);
});

test("a gust-direction column that copies the gust speed is bad, live and in the score", () => {
  const copied = day((o) => ({ wind_gust_dir: o.wind_gust }));
  const hits = checkReadings(copied);
  assert.ok(hits.some((h) => h.rule === "R13" && h.channel === "wind_gust_dir"));
  assert.equal(groupStatus(copied, hits, { exportGroups: true }).find((g) => g.group === "gust_direction")!.status, "bad");
  assert.ok(!groupStatus(copied, hits).some((g) => g.group === "gust_direction"), "the engines' view leaves it out");
  const [health] = dailyHealth(copied, hits);
  assert.deepEqual(health.bad, ["gust_direction"]);
  assert.equal(health.score, 90);

  const real = day((o, i) => ({ wind_gust_dir: (i * 37) % 360 }));
  assert.ok(!checkReadings(real).some((h) => h.rule === "R13"));
  assert.equal(dailyHealth(real)[0].score, 100);
});

test("an empty battery channel is bad where the feed lists it, and not reported where the export has none", () => {
  const series = day();
  const battery = (s: DemoObservation[], batteryListed = false) =>
    groupStatus(s, checkReadings(s), { exportGroups: true, batteryListed }).find((g) => g.group === "battery")!;
  assert.equal(battery(series).status, "not_reported");
  assert.equal(dailyHealth(series)[0].score, 100);
  assert.equal(battery(series, true).status, "bad");
  assert.deepEqual(battery(series, true).rules, ["R12"]);
  assert.equal(dailyHealth(series, checkReadings(series), { batteryListed: true })[0].score, 90);
  assert.equal(battery(day(() => ({ battery_v: 12.6 })), true).status, "good");
});

test("an impossible reading is flagged but never judged as a value", () => {
  const reading = (minutes: number, temp: number) => ({
    ts: new Date(NAIROBI_MIDNIGHT + minutes * 60_000).toISOString(),
    temp_sht: temp, temp_bmx: 20, temp_mcp: 20, humidity_sht: 60, press_bmx: 850, wind_spd: 1, wind_dir: 90,
    wind_gust: 2, si1145_vis: 300, si1145_ir: 800, wet_bulb_temp: 15, heat_idx: 20, rg1tt: 0, rg2tt: 0,
  });
  const series = cleanAndGrid([reading(0, 20), reading(15, 85), reading(30, 21)]);
  const hits = checkReadings(series);
  assert.deepEqual(hits.filter((h) => h.rule === "R01").map((h) => [h.channel, h.index, h.flag]), [["temp_sht", 1, "bad"]]);
  assert.ok(!hits.some((h) => h.rule === "R09"), "the dropped 85 °C never reaches the thermometer comparison");
  assert.equal(series[1].temp_sht, 20.5);
});

test("the audits recognise a Stull wet bulb and a firmware WBGT below it", () => {
  const series = day((o) => ({ firmware_wbgt: o.wet_bulb_temp - 3 }));
  const a = audits(series);
  assert.equal(a.A01_wet_bulb_vs_stull.verdict, "matches Stull");
  assert.equal(a.A03_firmware_wbgt_vs_wet_bulb.below_pct, 100);
  assert.equal(a.A03_firmware_wbgt_vs_wet_bulb.verdict, "non-standard");
  assert.ok(checkReadings(series).some((h) => h.rule === "R16"));
});
