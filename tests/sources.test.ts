import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanAndGridWithStats } from "../src/lib/afya/sources";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 6, 0) + minutes * 60_000).toISOString();

function row(minutes: number, extra: Record<string, unknown> = {}) {
  return {
    ts: at(minutes),
    temp_sht: 20, temp_bmx: 20, temp_mcp: 20, heat_idx: 20, humidity_sht: 60, press_bmx: 851, wind_spd: 1, wind_dir: 90, wind_gust: 2,
    si1145_vis: 300, si1145_ir: 800, wet_bulb_temp: 15, wet_bulb_globe_temp: 12, rg1: 0, rg2: 0,
    ...extra,
  };
}

test("repeated timestamps are removed and counted", () => {
  const { series, duplicates } = cleanAndGridWithStats([row(0), row(0), row(15), row(30)]);
  assert.equal(duplicates, 1);
  assert.equal(series.length, 3);
});

test("WBGT is shade WBGT from the wet bulb and air temperature; the firmware value is kept apart", () => {
  const { series } = cleanAndGridWithStats([row(0), row(15)]);
  assert.equal(series[0].wet_bulb_globe_temp, 0.7 * 15 + 0.3 * 20);
  assert.equal(series[0].firmware_wbgt, 12);
});

test("the station's missing-value code is treated as missing", () => {
  const { series } = cleanAndGridWithStats([row(0), row(15, { temp_sht: -999.9 }), row(30)]);
  assert.ok(series[1].imputed?.includes("temp_sht"));
  assert.equal(series[1].temp_sht, 20);
});

test("a short gap is interpolated and marked", () => {
  const { series } = cleanAndGridWithStats([row(0, { temp_sht: 20 }), row(45, { temp_sht: 23 })]);
  assert.equal(series.length, 4);
  assert.equal(series[1].temp_sht, 21);
  assert.ok(series[1].imputed?.includes("temp_sht"));
  assert.deepEqual(series[0].imputed, []);
});

test("a long gap is carried forward, marked, and never passes as measured", () => {
  const { series } = cleanAndGridWithStats([row(0, { temp_sht: 20 }), row(120, { temp_sht: 25 })]);
  const inGap = series.slice(1, -1);
  assert.ok(inGap.length > 2);
  for (const o of inGap) {
    assert.equal(o.temp_sht, 20);
    assert.ok(o.imputed?.includes("temp_sht"));
  }
});

test("missing rain is marked rather than counted as no rain", () => {
  const { series } = cleanAndGridWithStats([row(0), row(15, { rg1: null }), row(30)]);
  assert.equal(series[1].rg1, 0);
  assert.ok(series[1].imputed?.includes("rg1"));
  assert.ok(!series[0].imputed?.includes("rg1"));
});
