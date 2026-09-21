import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeIrrigationAdvice,
  computeWaterBalance,
  getCropProfile,
  irrigationDepthRange,
  soilDepletionPct,
} from "../src/lib/afya/farm-engine";
import type { SituationResult } from "../src/lib/afya/types";

// Only the fields the water balance and irrigation rules read.
function situation(o: { rain7: number; rain30: number; soil: number; rainProbability?: number }): SituationResult {
  return {
    chirps: { chirps_7d_mm: o.rain7, chirps_30d_mm: o.rain30 },
    era5: { era5_soil_moisture: o.soil },
    risk: { rain_probability: o.rainProbability ?? 0.1 },
    quality: { status: "GOOD" },
  } as unknown as SituationResult;
}

test("soil moisture is read against clay limits", () => {
  // Below the clay wilting point, at the top of its field-capacity range, and
  // halfway between the middle wilting point (0.22) and field capacity (0.36).
  assert.equal(soilDepletionPct(0.17), 100);
  assert.equal(soilDepletionPct(0.40), 0);
  assert.equal(soilDepletionPct(0.29), 50);
});

test("the depth range follows the clay available-water bounds", () => {
  const s = situation({ rain7: 2, rain30: 20, soil: 0.17 });
  // 0.12 and 0.20 m³/m³ over maize's 1.0 m root zone at p = 0.55.
  const maize = computeWaterBalance(s, getCropProfile("maize"), "vegetative", 26, 14);
  assert.deepEqual(maize.readily_available_range_mm, { low: 66, high: 110 });
  // The same bounds over beans' 0.6 m root zone at p = 0.45.
  const beans = computeWaterBalance(s, getCropProfile("beans"), "vegetative", 26, 14);
  assert.deepEqual(beans.readily_available_range_mm, { low: 32.4, high: 54 });

  assert.deepEqual(irrigationDepthRange({ low: 66, high: 110 }, 1), { low: 65, high: 110 });
  assert.deepEqual(irrigationDepthRange({ low: 32.4, high: 54 }, 0.5), { low: 15, high: 25 });
  // 57.2 and 95.4 mm come out to the nearest 5 mm.
  assert.deepEqual(irrigationDepthRange({ low: 66, high: 110 }, 0.867), { low: 55, high: 95 });
});

test("rain that met demand against a depleted soil reading asks for a soil check", () => {
  // The reported case: 15.1 mm of rain in 7 days, 11.8 mm of maize demand, soil moisture 0.17.
  const s = situation({ rain7: 15.1, rain30: 60, soil: 0.17 });
  const wb = computeWaterBalance(s, getCropProfile("maize"), "vegetative", 19.5, 16.5);
  assert.equal(wb.et0_mm_day, 2.11);
  assert.equal(wb.demand_7d_mm, 11.8);
  assert.equal(wb.soil_depletion_pct, 100);

  const advice = computeIrrigationAdvice(wb, s);
  assert.equal(advice.action, "CHECK_SOIL");
  assert.equal(advice.depth_mm, 0);
  assert.equal(advice.depth_range_mm, null);
  assert.equal(advice.confidence, "LOW");
});

test("a dry week with a depleted soil reading still says irrigate, as a range", () => {
  const s = situation({ rain7: 2, rain30: 20, soil: 0.17 });
  const wb = computeWaterBalance(s, getCropProfile("maize"), "vegetative", 26, 14);
  assert.ok(wb.rain_7d_mm < wb.demand_7d_mm);

  const advice = computeIrrigationAdvice(wb, s);
  assert.equal(advice.action, "IRRIGATE_NOW");
  assert.deepEqual(advice.depth_range_mm, { low: 65, high: 110 });
  assert.equal(advice.depth_mm, 65);
});

test("a moist soil after enough rain needs no irrigation", () => {
  const s = situation({ rain7: 15.1, rain30: 60, soil: 0.34 });
  const wb = computeWaterBalance(s, getCropProfile("maize"), "vegetative", 19.5, 16.5);
  const advice = computeIrrigationAdvice(wb, s);
  assert.equal(advice.action, "NO_IRRIGATION");
  assert.equal(advice.depth_range_mm, null);
});
