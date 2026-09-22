import { test } from "node:test";
import assert from "node:assert/strict";
import { audits, checkReadings, dailyHealth, deviceCodes, gaps, groupStatus, rainDayTotals } from "../src/lib/afya/sentinel";
import { cleanAndGrid } from "../src/lib/afya/sources";
import { nwsHeatIndex, stullWetBulb } from "../src/lib/afya/constants";
import type { DemoObservation } from "../src/lib/afya/demo-observations";

// 21:00 UTC is midnight in Nairobi.
const NAIROBI_MIDNIGHT = Date.UTC(2026, 0, 9, 21);

// Nairobi days of 15-minute slots that pass every rule. `swing` is the day's
// temperature range; 0 gives a flat day, where a patched slot is the only
// thing that moves and a threshold can be approached a hundredth at a time.
function days(
  count: number,
  patch: (o: DemoObservation, i: number) => Partial<DemoObservation> = () => ({}),
  swing = 6,
): DemoObservation[] {
  return Array.from({ length: 96 * count }, (_, i) => {
    const temp = 18 + swing * Math.sin((i / 96) * 2 * Math.PI) + (i % 3) * 0.05;
    const rh = 70 - (swing / 0.3) * Math.sin((i / 96) * 2 * Math.PI) + (i % 2) * 0.1;
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
const flatDay = (patch?: (o: DemoObservation, i: number) => Partial<DemoObservation>) => days(1, patch, 0);

type Patch = (o: DemoObservation, i: number) => Partial<DemoObservation>;
/** Whether a rule fires anywhere on a day built with `patch`. */
const fires = (rule: string, patch: Patch, build = flatDay) =>
  checkReadings(build(patch)).some((h) => h.rule === rule);
/** A rule that holds at the threshold and breaks a hundredth past it. */
function edge(rule: string, inside: Patch, outside: Patch, build = flatDay) {
  assert.equal(fires(rule, inside, build), false, `${rule} fired at the threshold`);
  assert.equal(fires(rule, outside, build), true, `${rule} stayed quiet past the threshold`);
}
const at = (slot: number, patch: Partial<DemoObservation>): Patch => (_o, i) => (i === slot ? patch : {});

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

test("R15 is not reported where no export carries a device code, and recorded where one does", () => {
  const codeGroup = (s: DemoObservation[]) =>
    groupStatus(s, checkReadings(s), { exportGroups: true }).find((g) => g.group === "device_code")!;

  const silent = day();
  assert.equal(codeGroup(silent).status, "not_reported");
  assert.deepEqual(codeGroup(silent).empty_channels, ["health_code"]);
  assert.deepEqual(deviceCodes(silent), { reported: false, codes: [], note: "meaning undocumented" });
  assert.equal(dailyHealth(silent)[0].score, 100);

  // A station reporting itself well is not the same as a station saying nothing.
  const well = day(() => ({ health_code: 0 }));
  assert.equal(codeGroup(well).status, "good");
  assert.deepEqual(codeGroup(well).rules, []);
  assert.deepEqual(deviceCodes(well).codes, [{ code: 0, slots: 96 }]);
  assert.ok(!checkReadings(well).some((h) => h.rule === "R15"));

  // A code nobody has written down: listed with its count, judged by nobody.
  const coded = day((_o, i) => ({ health_code: i < 4 ? 16 : i === 90 ? 32 : 0 }));
  const codes = deviceCodes(coded);
  assert.deepEqual(codes.codes, [{ code: 0, slots: 91 }, { code: 16, slots: 4 }, { code: 32, slots: 1 }]);
  assert.equal(codes.note, "meaning undocumented");
  assert.equal(codeGroup(coded).status, "not_judged");
  assert.deepEqual(codeGroup(coded).rules, ["R15"]);

  const hits = checkReadings(coded);
  const r15 = hits.filter((h) => h.rule === "R15");
  assert.equal(r15.length, 5);
  assert.ok(r15.every((h) => h.channel === "health_code" && h.flag === "info"));
  const [health] = dailyHealth(coded, hits);
  assert.equal(health.score, 100);
  assert.ok(health.rules.includes("R15"));
  assert.deepEqual([health.bad, health.suspect], [[], []]);
  // The engines' view of the station leaves the column out entirely.
  assert.ok(!groupStatus(coded, hits).some((g) => g.group === "device_code"));
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

test("the NWS heat index keeps its two branches and both humidity adjustments", () => {
  const near = (got: number, want: number, what: string) =>
    assert.ok(Math.abs(got - want) < 1e-6, `${what}: ${got}`);
  near(nwsHeatIndex(20, 60), 19.622222, "Steadman's simple form, below 80 degF");
  near(nwsHeatIndex(35, 40), 37.216351, "the Rothfusz regression");
  // The adjustments are worth more than a degree in dry air and three
  // quarters of one in saturated air, so dropping either would show here.
  near(nwsHeatIndex(35, 5), 31.209325, "the regression less the dry adjustment");
  near(nwsHeatIndex(28, 100), 36.378836, "the regression plus the humid adjustment");
  // The switch at 80 degF is a step between two formulas, not a blend.
  assert.ok(nwsHeatIndex(26.53, 60) - nwsHeatIndex(26.52, 60) > 0.7);
});

test("A02 reports the firmware heat index against the NWS one, and again in the heat it is built for", () => {
  const exact = day((o) => ({ heat_idx: nwsHeatIndex(o.temp_sht, o.humidity_sht) }));
  const cool = audits(exact).A02_heat_index_vs_nws;
  assert.equal(cool.mae_c, 0);
  assert.equal(cool.slots, 96);
  // A day that never reaches 27 °C has nothing to say about a formula built
  // for the heat, which is not the same as agreeing with it.
  assert.equal(cool.hot_slots, 0);
  assert.equal(cool.mae_hot_c, null);

  const warm = flatDay((o) => {
    const temp_sht = o.temp_sht + 12;
    return {
      temp_sht,
      temp_bmx: temp_sht - 0.3,
      temp_mcp: temp_sht - 0.2,
      heat_idx: nwsHeatIndex(temp_sht, o.humidity_sht) + 0.5,
    };
  });
  const hot = audits(warm).A02_heat_index_vs_nws;
  assert.equal(hot.hot_slots, 96);
  assert.equal(hot.mae_c, 0.5);
  assert.equal(hot.mae_hot_c, 0.5);
  assert.equal(hot.max_c, 0.5);
  // Report only: no verdict, and the day still scores 100.
  assert.ok(!("verdict" in hot));
  assert.equal(dailyHealth(warm)[0].score, 100);
});

// Thresholds. Each rule is held at its limit and then pushed a hundredth past
// it, so a threshold cannot be moved without a test noticing.

const RAW = {
  temp_sht: 20, temp_bmx: 20.3, temp_mcp: 20.1, humidity_sht: 60, press_bmx: 850, wind_spd: 1, wind_dir: 90,
  wind_gust: 2, si1145_vis: 300, si1145_ir: 800, wet_bulb_temp: 15, heat_idx: 20, rg1: 0, rg2: 0, rg1tt: 0, rg2tt: 0,
};
const raw = (minutes: number, extra: Record<string, unknown> = {}) => ({
  ...RAW,
  ts: new Date(NAIROBI_MIDNIGHT + minutes * 60_000).toISOString(),
  ...extra,
});
const ruleAt = (rows: Record<string, unknown>[], rule: string) =>
  checkReadings(cleanAndGrid(rows)).filter((h) => h.rule === rule);

test("a flat day passes every rule, so a threshold test measures only what it patches", () => {
  assert.deepEqual(checkReadings(flatDay()), []);
  assert.equal(dailyHealth(flatDay())[0].score, 100);
});

test("R01 holds at -5 and 45 °C on each of the three thermometers", () => {
  for (const f of ["temp_sht", "temp_bmx", "temp_mcp"] as const) {
    edge("R01", at(50, { [f]: 45 }), at(50, { [f]: 45.01 }));
    edge("R01", at(50, { [f]: -5 }), at(50, { [f]: -5.01 }));
  }
});

test("R02 holds at 0 and 100 % humidity, and the cleaner no longer clamps the top away", () => {
  edge("R02", at(50, { humidity_sht: 0.01 }), at(50, { humidity_sht: 0 }));
  edge("R02", at(50, { humidity_sht: 100 }), at(50, { humidity_sht: 100.01 }));
  assert.equal(ruleAt([raw(0), raw(15, { humidity_sht: 100 }), raw(30)], "R02").length, 0);

  const over = cleanAndGrid([raw(0), raw(15, { humidity_sht: 105 }), raw(30)]);
  assert.deepEqual(ruleAt([raw(0), raw(15, { humidity_sht: 105 }), raw(30)], "R02").map((h) => h.index), [1]);
  assert.ok(over[1].imputed?.includes("humidity_sht"), "the impossible reading is dropped, not clamped to 100");
  assert.equal(over[1].humidity_sht, 60);
});

test("R03 holds at 800 and 900 hPa", () => {
  edge("R03", at(50, { press_bmx: 800 }), at(50, { press_bmx: 799.99 }));
  edge("R03", at(50, { press_bmx: 900 }), at(50, { press_bmx: 900.01 }));
});

test("R04 holds at 60 m/s of wind and 75 m/s of gust", () => {
  edge("R04", at(50, { wind_spd: 60 }), at(50, { wind_spd: 60.01 }));
  edge("R04", at(50, { wind_spd: 0 }), at(50, { wind_spd: -0.01 }));
  edge("R04", at(50, { wind_gust: 75 }), at(50, { wind_gust: 75.01 }));
});

test("R05 holds at 0 and 10 mm in one reading, which only the reading can show", () => {
  for (const f of ["rg1", "rg2"] as const) {
    assert.equal(ruleAt([raw(0), raw(15, { [f]: 10 }), raw(30)], "R05").length, 0);
    assert.deepEqual(
      ruleAt([raw(0), raw(15, { [f]: 10.01 }), raw(30)], "R05").map((h) => [h.channel, h.index, h.flag]),
      [[f, 1, "bad"]],
    );
    assert.equal(ruleAt([raw(0), raw(15, { [f]: -0.01 }), raw(30)], "R05").length, 1);
  }
});

test("R06 holds at the sensor's dark floor of 240 counts", () => {
  edge("R06", at(50, { si1145_vis: 240 }), at(50, { si1145_vis: 239.99 }));
  edge("R06", at(50, { si1145_ir: 240 }), at(50, { si1145_ir: 239.99 }));
});

test("R07 holds at a 5 °C step, on each of the three thermometers", () => {
  // Slots 50 and 51 share a value, so the step in and the step out are equal.
  const step = (f: "temp_sht" | "temp_bmx" | "temp_mcp", to: number): Patch =>
    (_o, i) => (i === 50 || i === 51 ? { [f]: to } : {});
  edge("R07", step("temp_sht", 23.05), step("temp_sht", 23.06));
  edge("R07", step("temp_bmx", 22.75), step("temp_bmx", 22.76));
  edge("R07", step("temp_mcp", 22.85), step("temp_mcp", 22.86));
});

test("R08 holds at 8 slots for the thermometers and humidity, 12 for pressure and wind", () => {
  const run = (patch: Partial<DemoObservation>, slots: number): Patch =>
    (_o, i) => (i >= 40 && i < 40 + slots ? patch : {});
  for (const f of ["temp_sht", "temp_bmx", "temp_mcp"] as const) {
    // The sine day moves the other two thermometers, so a flat one is stuck.
    edge("R08", run({ [f]: 19.5 }, 7), run({ [f]: 19.5 }, 8), day);
  }
  edge("R08", run({ humidity_sht: 55 }, 7), run({ humidity_sht: 55 }, 8), day);
  edge("R08", run({ press_bmx: 851 }, 11), run({ press_bmx: 851 }, 12), day);
  edge("R08", run({ wind_spd: 2.5 }, 11), run({ wind_spd: 2.5 }, 12), day);
  // Zero wind never counts, however long it lasts.
  assert.equal(fires("R08", run({ wind_spd: 0 }, 40), day), false);
});

test("R08 calls a flat thermometer stuck only once another moves past 0.5 °C", () => {
  const night = (move: number): Patch => (_o, i) =>
    i >= 8 && i < 16 ? { temp_sht: 15, temp_bmx: 14.7 + (i % 2) * move, temp_mcp: 14.8 + (i % 3) * 0.01 } : {};
  const stuck = (move: number) =>
    checkReadings(flatDay(night(move))).some((h) => h.rule === "R08" && h.channel === "temp_sht");
  assert.equal(stuck(0.5), false);
  assert.equal(stuck(0.51), true);
});

test("R09 holds at a 2 °C spread between thermometers", () => {
  edge("R09", (o) => ({ temp_bmx: o.temp_sht - 2 }), (o) => ({ temp_bmx: o.temp_sht - 2.01 }));
});

test("R10 catches a gust below the wind speed, even where the slot would hide it", () => {
  edge("R10", (o) => at(50, { wind_gust: o.wind_spd })(o, 50), (o) => at(50, { wind_gust: o.wind_spd - 0.01 })(o, 50));
  assert.equal(ruleAt([raw(0), raw(15, { wind_gust: 2, wind_spd: 2 }), raw(30)], "R10").length, 0);

  // Two readings in one slot: the slot keeps the higher gust and the mean
  // speed, which on its own would hide the reading that broke the rule.
  const rows = [raw(0), raw(15, { wind_gust: 0.5, wind_spd: 2 }), raw(20, { wind_gust: 9, wind_spd: 2 }), raw(30)];
  const series = cleanAndGrid(rows);
  assert.equal(series[1].wind_gust, 9);
  assert.deepEqual(ruleAt(rows, "R10").map((h) => [h.channel, h.index, h.flag]), [["wind_gust", 1, "suspect"]]);
  // And a lone low gust is left where it was rather than raised to the speed.
  assert.equal(cleanAndGrid([raw(0), raw(15, { wind_gust: 0.5, wind_spd: 2 }), raw(30)])[1].wind_gust, 0.5);
});

test("R11 holds at 0.4 mm in a rain day", () => {
  const gauge1 = (mm: number) => days(2, (_o, i) => (i >= 36 + 96 ? { rg1tp: mm, rg2tp: 0 } : {}));
  assert.equal(dailyHealth(gauge1(0.39))[0].rules.includes("R11"), false);
  assert.equal(dailyHealth(gauge1(0.4))[0].rules.includes("R11"), true);
  // The silent gauge is the one marked, not the pair.
  assert.deepEqual(dailyHealth(gauge1(0.4))[0].suspect, ["rain_gauge_2"]);
  const gauge2 = days(2, (_o, i) => (i >= 36 + 96 ? { rg1tp: 0, rg2tp: 0.4 } : {}));
  assert.deepEqual(dailyHealth(gauge2)[0].suspect, ["rain_gauge_1"]);
});

test("R13 holds at a 99 % copy share, and needs gusts in more than 5 % of the day", () => {
  const copied = (n: number) => flatDay((_o, i) => ({ wind_gust: 3, wind_gust_dir: i < n ? 3 : 120 }));
  assert.equal(checkReadings(copied(95)).some((h) => h.rule === "R13"), false);
  assert.equal(checkReadings(copied(96)).some((h) => h.rule === "R13"), true);

  const gustsIn = (n: number) =>
    flatDay((_o, i) => (i < n ? { wind_gust: 3, wind_gust_dir: 3 } : { wind_gust: 0, wind_gust_dir: 0 }));
  assert.equal(checkReadings(gustsIn(4)).some((h) => h.rule === "R13"), false);
  assert.equal(checkReadings(gustsIn(5)).some((h) => h.rule === "R13"), true);
  // A calm day whose direction happens to read due north is not a copy.
  const calm = flatDay((_o, i) => ({ wind_spd: 0, wind_gust: 0, wind_gust_dir: i % 8 === 0 ? 0 : 0 }));
  assert.equal(checkReadings(calm).some((h) => h.rule === "R13"), false);
  assert.equal(dailyHealth(calm)[0].score, 100);
  // Once it does fire, every slot carrying the column is marked, not the gusty ones alone.
  assert.equal(checkReadings(gustsIn(5)).filter((h) => h.rule === "R13").length, 96);
});

test("R16 holds at 1.5 °C below the firmware wet bulb", () => {
  edge("R16", (o) => ({ firmware_wbgt: o.wet_bulb_temp - 1.5 }), (o) => ({ firmware_wbgt: o.wet_bulb_temp - 1.51 }));
});

test("a group counts once more than 5 % of a day's slots are flagged, and is bad once every slot is", () => {
  const dim = (n: number) => day((_o, i) => (i < n ? { si1145_vis: 100 } : {}));
  assert.equal(dailyHealth(dim(4))[0].score, 100);
  const [five] = dailyHealth(dim(5));
  assert.deepEqual(five.suspect, ["light"]);
  assert.equal(five.score, 98);

  // All day is not a worse suspicion, it is a sensor that told us nothing.
  const [allDay] = dailyHealth(dim(96));
  assert.deepEqual(allDay.bad, ["light"]);
  assert.deepEqual(allDay.suspect, []);
  assert.equal(allDay.score, 90);
  assert.equal(groupStatus(dim(96)).find((g) => g.group === "light")!.status, "bad");
});

test("missing time costs a point every 14.4 minutes", () => {
  const silence = { from: "2026-01-09T21:00:00.000Z", to: "2026-01-10T01:48:00.000Z" };
  const series = day((_o, i) => (i < 20 ? { gap_minutes: 14.4, gap: silence } : {}));
  const [health] = dailyHealth(series);
  assert.equal(health.missing_minutes, 288);
  assert.equal(health.score, 80);
});

test("A01 holds at a 0.1 °C mean difference from Stull", () => {
  const off = (d: number) => day((o) => ({ wet_bulb_temp: stullWetBulb(o.temp_sht, o.humidity_sht) + d }));
  assert.equal(audits(off(0.099)).A01_wet_bulb_vs_stull.verdict, "matches Stull");
  assert.equal(audits(off(0.101)).A01_wet_bulb_vs_stull.verdict, "does not match Stull");
});

test("a device code rides the 15-minute grid as a code, never as an average", () => {
  const rows = [raw(0, { health_code: 0 }), raw(5, { health_code: 16 }), raw(20, { health_code: 0 }), raw(30, { health_code: 0 })];
  const series = cleanAndGrid(rows);
  assert.equal(series[0].health_code, 16, "the slot reports the complaint, not the mean of 0 and 16");
  assert.equal(series[1].health_code, 0);
  assert.deepEqual(deviceCodes(series).codes, [{ code: 0, slots: 2 }, { code: 16, slots: 1 }]);
  // The station's missing marker is not a code.
  assert.equal(cleanAndGrid([raw(0, { health_code: -999.9 }), raw(15), raw(30)])[0].health_code, undefined);
});

test("R14 records a late reading and a silence, and neither moves the score", () => {
  // One reading a minute for four hours, with `drop` of them missing at 02:00.
  const minutes = (drop: number) =>
    Array.from({ length: 240 }, (_, i) => i).filter((i) => i < 120 || i >= 120 + drop).map((i) => raw(i));
  const r14 = (drop: number) => ruleAt(minutes(drop), "R14");

  // Five minutes between readings at a one-minute cadence: late, no gap.
  assert.equal(r14(3).length, 1);
  assert.deepEqual(r14(4).map((h) => [h.channel, h.flag]), [["time", "info"]]);
  const late = cleanAndGrid(minutes(4));
  assert.equal(late.reduce((s, o) => s + (o.gap_minutes ?? 0), 0), 0);
  assert.equal(late.reduce((s, o) => s + (o.late_intervals ?? 0), 0), 1);
  // A minute late is the cadence itself, not a late reading.
  assert.equal(r14(0).length, 0);

  // Past the gap threshold it is a silence, which R14 also records.
  const outage = cleanAndGrid(minutes(60));
  assert.ok(outage.some((o) => (o.gap_minutes ?? 0) > 0));
  assert.ok(!outage.some((o) => o.late_intervals));
  assert.ok(checkReadings(outage).filter((h) => h.rule === "R14").length > 1);

  // The score with R14 in hand is the score without it, on both series.
  for (const series of [late, outage]) {
    const hits = checkReadings(series);
    assert.ok(hits.some((h) => h.rule === "R14"));
    const before = dailyHealth(series, hits.filter((h) => h.rule !== "R14"));
    const after = dailyHealth(series, hits);
    assert.deepEqual(after.map((d) => d.score), before.map((d) => d.score));
    assert.deepEqual(after.map((d) => [d.bad, d.suspect]), before.map((d) => [d.bad, d.suspect]));
    // Only the rule list changes, which is the point of emitting it.
    assert.ok(after.every((d) => d.rules.includes("R14")));
    assert.ok(before.every((d) => !d.rules.includes("R14")));
    assert.ok(!groupStatus(series, hits, { exportGroups: true }).some((g) => g.rules.includes("R14")));
  }
});

test("a gap opens four minutes past the cadence the readings themselves keep", () => {
  // One reading a minute for four hours, with `drop` of them missing at 02:00.
  const minutes = (drop: number) =>
    Array.from({ length: 240 }, (_, i) => i).filter((i) => i < 120 || i >= 120 + drop).map((i) => raw(i));
  const missing = (drop: number) =>
    cleanAndGrid(minutes(drop)).reduce((s, o) => s + (o.gap_minutes ?? 0), 0);
  assert.equal(missing(4), 0, "five minutes between readings is not yet a gap at a one-minute cadence");
  assert.ok(Math.abs(missing(5) - 5) < 1e-9, "six minutes between readings charges the five it lost");

  const outage = cleanAndGrid(minutes(60));
  assert.deepEqual(gaps(outage), [{ from: raw(119).ts, to: raw(180).ts, hours: 1 }]);
});
