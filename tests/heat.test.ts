import { test } from "node:test";
import assert from "node:assert/strict";
import { getActivityProfile, riskRank, shadeWbgt, stullWetBulb, wbgtToRisk } from "../src/lib/afya/constants";

test("Stull's wet bulb matches the worked example in the paper", () => {
  // Stull (2011): 20 degC and 50 % relative humidity give 13.7 degC.
  assert.ok(Math.abs(stullWetBulb(20, 50) - 13.7) < 0.05);
});

test("shade WBGT is 0.7 wet bulb plus 0.3 air temperature, never below the wet bulb", () => {
  assert.equal(shadeWbgt(30, 20), 23);
  for (const [t, rh] of [[15, 95], [25, 40], [32, 20]]) {
    const wb = stullWetBulb(t, rh);
    assert.ok(shadeWbgt(t, wb) >= wb);
  }
});

test("a demanding activity is never judged safer than a gentle one at the same WBGT", () => {
  const construction = getActivityProfile("construction").wbgt_caution_offset;
  const walking = getActivityProfile("walking").wbgt_caution_offset;
  for (let wbgt = 14; wbgt <= 28; wbgt += 0.5) {
    assert.ok(riskRank(wbgtToRisk(wbgt, construction)) >= riskRank(wbgtToRisk(wbgt, walking)), `at ${wbgt}`);
  }
});

test("the bands rise with WBGT", () => {
  assert.equal(wbgtToRisk(17), "LOW");
  assert.equal(wbgtToRisk(19), "ELEVATED");
  assert.equal(wbgtToRisk(22), "HIGH");
  assert.equal(wbgtToRisk(25), "VERY_HIGH");
});
