import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateQuality } from "../src/lib/afya/data-quality";
import type { DemoObservation } from "../src/lib/afya/demo-observations";

const END = Date.UTC(2026, 8, 1, 12, 0);

function series(count: number, patch: Partial<DemoObservation> = {}): DemoObservation[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: new Date(END - (count - 1 - i) * 900_000).toISOString(),
    rg1: 0, rg2: 0, rg1tt: 0, rg2tt: 0,
    temp_bmx: 24, press_bmx: 850, temp_mcp: 24, temp_sht: 24, humidity_sht: 50,
    si1145_vis: 600, si1145_ir: 3000, si1145_uv: 0,
    wind_spd: 1, wind_dir: 90, wind_gust: 2, heat_idx: 24,
    wet_bulb_temp: 17, wet_bulb_globe_temp: 19.1, firmware_wbgt: 18, imputed: [],
    ...patch,
  }));
}

const minutesAfter = (m: number) => new Date(END + m * 60_000).toISOString();

test("fresh, fully measured data is GOOD", () => {
  assert.equal(evaluateQuality(series(24), minutesAfter(10)).status, "GOOD");
});

test("data over an hour old is DEGRADED, and over three hours POOR", () => {
  assert.equal(evaluateQuality(series(24), minutesAfter(90)).status, "DEGRADED");
  assert.equal(evaluateQuality(series(24), minutesAfter(200)).status, "POOR");
});

test("a critical reading that was filled in rather than measured is reported", () => {
  const s = series(24);
  s[s.length - 1] = { ...s[s.length - 1], imputed: ["temp_sht"] };
  const q = evaluateQuality(s, minutesAfter(10));
  assert.equal(q.status, "DEGRADED");
  assert.ok(q.flags.includes("missing_fields:temp_sht"));
});

test("hours mostly carried forward are flagged even when the last slot is real", () => {
  const s = series(24).map((o, i) => (i < 20 ? { ...o, imputed: ["humidity_sht"] } : o));
  const q = evaluateQuality(s, minutesAfter(10));
  assert.ok(q.flags.some((f) => f.startsWith("gaps_filled_recently")));
  assert.equal(q.status, "DEGRADED");
});

test("a firmware WBGT below the wet bulb is pointed out", () => {
  const q = evaluateQuality(series(24, { firmware_wbgt: 15 }), minutesAfter(10));
  assert.ok(q.flags.includes("firmware_wbgt_below_wet_bulb"));
});
