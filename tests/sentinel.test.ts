import { test } from "node:test";
import assert from "node:assert/strict";
import { audits, checkReadings, dailyHealth, groupStatus } from "../src/lib/afya/sentinel";
import { stullWetBulb } from "../src/lib/afya/constants";
import type { DemoObservation } from "../src/lib/afya/demo-observations";

// One UTC day of 15-minute slots that pass every rule.
function day(patch: (o: DemoObservation, i: number) => Partial<DemoObservation> = () => ({})): DemoObservation[] {
  return Array.from({ length: 96 }, (_, i) => {
    const temp = 18 + 6 * Math.sin((i / 96) * 2 * Math.PI) + (i % 3) * 0.05;
    const rh = 70 - 20 * Math.sin((i / 96) * 2 * Math.PI) + (i % 2) * 0.1;
    const wb = stullWetBulb(temp, rh);
    const o: DemoObservation = {
      ts: new Date(Date.UTC(2026, 0, 10) + i * 900_000).toISOString(),
      rg1: 0, rg2: 0, rg1tt: 0, rg2tt: 0,
      temp_bmx: temp - 0.3, press_bmx: 850 + (i % 4) * 0.1, temp_mcp: temp - 0.2, temp_sht: temp,
      humidity_sht: rh, si1145_vis: 300 + i, si1145_ir: 400 + i * 10, si1145_uv: 0,
      wind_spd: 1 + (i % 5) * 0.1, wind_dir: 90, wind_gust: 2 + (i % 5) * 0.1, heat_idx: temp,
      wet_bulb_temp: wb, wet_bulb_globe_temp: 0.7 * wb + 0.3 * temp, firmware_wbgt: wb + 0.5, imputed: [],
    };
    return { ...o, ...patch(o, i) };
  });
}

test("a clean day scores 100 with every group good", () => {
  const series = day();
  assert.deepEqual(checkReadings(series), []);
  assert.equal(dailyHealth(series)[0].score, 100);
  assert.ok(groupStatus(series).every((g) => g.status === "good"));
});

test("a thermometer stuck for two hours is caught", () => {
  const series = day((o, i) => (i >= 40 && i < 50 ? { temp_sht: 21.5 } : {}));
  assert.ok(checkReadings(series).some((h) => h.rule === "R08" && h.channel === "temp_sht"));
});

test("calm wind is not mistaken for a stuck sensor", () => {
  const series = day((o, i) => (i < 30 ? { wind_spd: 0 } : {}));
  assert.ok(!checkReadings(series).some((h) => h.rule === "R08" && h.channel === "wind_spd"));
});

test("a sensor silent all day makes its group bad and costs 10 points", () => {
  const series = day((o) => ({ imputed: ["press_bmx"] }));
  const [health] = dailyHealth(series);
  assert.ok(health.bad.includes("pressure"));
  assert.ok(health.rules.includes("R12"));
  assert.equal(health.score, 90);
});

test("one rain gauge measuring rain while the other stays at zero is suspect", () => {
  const series = day((o, i) => (i === 20 ? { rg1: 1.2 } : {}));
  const [health] = dailyHealth(series);
  assert.ok(health.rules.includes("R11"));
  assert.ok(health.suspect.includes("rain"));
});

test("missing slots cost a point per 14.4 minutes", () => {
  const series = day((o, i) =>
    i < 4 ? { imputed: ["temp_sht", "humidity_sht", "press_bmx", "temp_bmx", "temp_mcp"] } : {},
  );
  const [health] = dailyHealth(series);
  assert.equal(health.missing_minutes, 60);
  assert.ok(Math.abs(health.score - (100 - 60 / 14.4)) < 0.06);
});

test("the audits recognise a Stull wet bulb and a firmware WBGT below it", () => {
  const series = day((o) => ({ firmware_wbgt: o.wet_bulb_temp - 3 }));
  const a = audits(series);
  assert.equal(a.A01_wet_bulb_vs_stull.verdict, "matches Stull");
  assert.equal(a.A03_firmware_wbgt_vs_wet_bulb.below_pct, 100);
  assert.equal(a.A03_firmware_wbgt_vs_wet_bulb.verdict, "non-standard");
  assert.ok(checkReadings(series).some((h) => h.rule === "R16"));
});
