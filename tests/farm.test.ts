import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustedDepletionFraction,
  BALANCE_DAYS,
  chooseRainRecord,
  computeEt0,
  computeIrrigationAdvice,
  computeWaterBalance,
  driesDownAtMaturity,
  effectiveRainMm,
  estimateEt0,
  evaluateCropStress,
  evaluatePlantingOutlook,
  evaluateSprayWindow,
  extraterrestrialRadiationMm,
  findCropProfile,
  floorToFiveMm,
  measuredDailyRanges,
  measuredHoursAbove,
  measuredTempRange,
  rootDepthM,
  runRootZoneBalance,
  type CropProfile,
  type FarmInputs,
  type GrowthStage,
  type RainDay,
  type TempSlot,
  type WaterBalance,
} from "../src/lib/afya/farm-engine";
import { assembleFarmInputs } from "../src/lib/afya/farm-inputs";
import { getCsvRange } from "../src/lib/afya/csv-source";
import { STRINGS } from "../src/lib/afya/i18n";
import { datesEnding, dayOfYear } from "../src/lib/afya/nairobi-time";
import { POST } from "../src/app/api/farm/route";
import type { SituationResult } from "../src/lib/afya/types";

const maize = findCropProfile("maize") as CropProfile;
const kale = findCropProfile("kale") as CropProfile;
const beans = findCropProfile("beans") as CropProfile;
const STAGES: GrowthStage[] = ["establishment", "vegetative", "flowering", "maturity"];

// 15-minute slots of a day that warms from 13.0 °C at 06:00 EAT to 26.0 °C at
// 15:00 and cools back overnight.
function diurnalSeries(startIso: string, hours: number): TempSlot[] {
  const start = Date.parse(startIso);
  return Array.from({ length: hours * 4 }, (_, i) => {
    const t = start + i * 15 * 60_000;
    const sinceSix = ((t / 3600_000 + 3 - 6) % 24 + 24) % 24;
    const temp = sinceSix <= 9 ? 13 + (13 * sinceSix) / 9 : 26 - (13 * (sinceSix - 9)) / 15;
    return { ts: new Date(t).toISOString(), temp_sht: Math.round(temp * 10) / 10 };
  });
}

test("Ra for 21 September (day 264) at JKUAT matches FAO-56 eq. 21", () => {
  // dr 0.99449, declination -0.00530 rad, sunset hour angle 1.57090 rad:
  // Ra = 1440/π × 0.0820 × dr × (...) = 37.38 MJ/m²/day, × 0.408 = 15.25 mm/day.
  assert.equal(dayOfYear("2026-09-21"), 264);
  assert.ok(Math.abs(extraterrestrialRadiationMm(264, -1.0997) - 15.25) < 0.01);
  // Near the June solstice the sun gives about 12 % less than in September.
  assert.ok(extraterrestrialRadiationMm(172) < 13.5);
});

test("ET0 from a fixed 24-hour series equals the hand-worked Hargreaves value", () => {
  const series = diurnalSeries("2026-09-20T12:15:00Z", 24);
  const range = measuredTempRange(series, "2026-09-21T12:00:00Z");
  assert.deepEqual(range, { tmax_c: 26, tmin_c: 13, measured_hours: 24 });
  // 0.0023 × (19.5 + 17.8) × √13 × 15.25 = 4.717 mm/day.
  const et0 = estimateEt0("2026-09-21", range, null);
  assert.equal(et0?.source, "station");
  assert.ok(Math.abs((et0?.et0_mm_day ?? 0) - 4.717) <= 0.05);
});

test("ET0 does not change with the hour it is asked for", () => {
  // Two identical days; any 24 hours of them hold the whole cycle.
  const series = diurnalSeries("2026-09-19T21:00:00Z", 48);
  const values = [6, 9, 12, 15, 18, 21].map((eatHour) => {
    const at = new Date(Date.parse("2026-09-21T00:00:00Z") + (eatHour - 3) * 3600_000).toISOString();
    return estimateEt0("2026-09-21", measuredTempRange(series, at), null)?.et0_mm_day;
  });
  assert.equal(new Set(values).size, 1);
});

test("slots that were filled in rather than measured do not count", () => {
  // Five hours carried forward leave 19 measured.
  const series = diurnalSeries("2026-09-20T12:15:00Z", 24).map((o, i) =>
    i < 20 ? { ...o, imputed: ["temp_sht"] } : o,
  );
  const range = measuredTempRange(series, "2026-09-21T12:00:00Z");
  assert.equal(range?.measured_hours, 19);
  // Too few measured hours: today's regional forecast is used and labelled.
  const et0 = estimateEt0("2026-09-21", range, { tmax_c: 25.5, tmin_c: 14.3 });
  assert.equal(et0?.source, "regional_forecast");
  assert.equal(et0?.tmax_c, 25.5);
  // 0.0023 × (19.9 + 17.8) × √11.2 × 15.25 = 4.43 mm/day.
  assert.ok(Math.abs((et0?.et0_mm_day ?? 0) - 4.43) < 0.01);
  assert.equal(estimateEt0("2026-09-21", range, null), null);
});

test("the archive's measured days give the ET0 the audit found for late August and early September", () => {
  const series = getCsvRange("2026-08-27T21:00:00Z", "2026-09-08T21:00:00Z");
  const days = [...measuredDailyRanges(series)].filter(([, r]) => r.measured_hours >= 20);
  assert.ok(days.length >= 10);
  const et0 = days.map(([date, r]) => computeEt0(r.tmax_c, r.tmin_c, dayOfYear(date)));
  const mean = et0.reduce((a, b) => a + b, 0) / et0.length;
  assert.ok(mean > 4.2 && mean < 5.0, `mean ${mean.toFixed(2)} mm/day`);
});

test("roots start shallow and reach full depth by flowering", () => {
  assert.equal(rootDepthM(maize, "establishment"), 0.3);
  assert.equal(rootDepthM(maize, "vegetative"), 0.65);
  assert.equal(rootDepthM(maize, "flowering"), 1);
  assert.equal(rootDepthM(maize, "maturity"), 1);
  // Kale's 30 % would be 0.12 m; seedlings still get 0.2 m.
  assert.equal(rootDepthM(kale, "establishment"), 0.2);
});

test("light showers are not effective rain", () => {
  assert.equal(effectiveRainMm(2), 0);
  assert.equal(effectiveRainMm(10), 8);
});

// The crop table against its sources
// Every figure the advice turns on is pinned here: change one in the engine
// without changing it in FAO-56 and this fails.

interface CropExpectation {
  key: string;
  source: string;
  /** Kc_ini, Kc_mid and Kc_end of the FAO-56 curve */
  kc_ini: number;
  kc_mid: number;
  kc_end: number;
  /** Where FAO-56 gives a range for Kc_end, the range it has to sit in */
  kc_end_range?: [number, number];
  root_m: number;
  /** FAO-56 Table 22's range of maximum rooting depth */
  root_m_range?: [number, number];
  p: number;
  dries_down: boolean;
  heat: [number, number, number];
  heat_sensitive_stage: GrowthStage | null;
  planting_rain_mm: number;
}

const CROP_EXPECTATIONS: CropExpectation[] = [
  {
    key: "maize", source: "FAO-56 Table 12 (maize, field/grain) and Table 22",
    kc_ini: 0.30, kc_mid: 1.20, kc_end: 0.35, root_m: 1.0, root_m_range: [1.0, 1.7], p: 0.55,
    dries_down: true, heat: [32, 35, 38], heat_sensitive_stage: "flowering", planting_rain_mm: 40,
  },
  {
    key: "beans", source: "FAO-56 Table 12 (beans, dry) and Table 22",
    kc_ini: 0.40, kc_mid: 1.15, kc_end: 0.35, root_m: 0.6, root_m_range: [0.6, 0.9], p: 0.45,
    dries_down: true, heat: [28, 32, 35], heat_sensitive_stage: "flowering", planting_rain_mm: 30,
  },
  {
    // Not in FAO-56: the project's own, kept below the cabbage entry (0.5 to
    // 0.8 m, p 0.45) so a leaf crop is watered sooner and in smaller doses.
    key: "kale", source: "project's own, cabbage as the nearest FAO-56 entry",
    kc_ini: 0.70, kc_mid: 1.05, kc_end: 0.95, root_m: 0.4, p: 0.40,
    dries_down: false, heat: [28, 32, 35], heat_sensitive_stage: null, planting_rain_mm: 20,
  },
  {
    key: "tomato", source: "FAO-56 Table 12 and Table 22",
    kc_ini: 0.60, kc_mid: 1.15, kc_end: 0.80, kc_end_range: [0.70, 0.90],
    root_m: 0.7, root_m_range: [0.7, 1.5], p: 0.40,
    dries_down: false, heat: [30, 33, 36], heat_sensitive_stage: "flowering", planting_rain_mm: 25,
  },
  {
    key: "potato", source: "FAO-56 Table 12 and Table 22",
    kc_ini: 0.50, kc_mid: 1.15, kc_end: 0.75, root_m: 0.5, root_m_range: [0.4, 0.6], p: 0.35,
    dries_down: false, heat: [26, 29, 32], heat_sensitive_stage: "flowering", planting_rain_mm: 30,
  },
  {
    key: "coffee", source: "FAO-56 Table 12 (coffee, bare ground) and Table 22",
    kc_ini: 0.90, kc_mid: 0.95, kc_end: 0.95, root_m: 1.3, root_m_range: [0.9, 1.5], p: 0.40,
    dries_down: false, heat: [26, 30, 34], heat_sensitive_stage: null, planting_rain_mm: 50,
  },
  {
    // Not in FAO-56: the project's own, near the grazing pasture entry
    // (0.5 to 1.5 m, p 0.60).
    key: "napier", source: "project's own, grazing pasture as the nearest FAO-56 entry",
    kc_ini: 0.90, kc_mid: 1.05, kc_end: 0.95, root_m: 1.0, p: 0.55,
    dries_down: false, heat: [35, 38, 40], heat_sensitive_stage: null, planting_rain_mm: 35,
  },
];

test("every crop's Kc, root depth and p match the table they came from", () => {
  for (const want of CROP_EXPECTATIONS) {
    const crop = findCropProfile(want.key) as CropProfile;
    const where = `${want.key} (${want.source})`;
    assert.ok(crop, `${want.key} is missing from CROP_PROFILES`);
    assert.equal(crop.kc.establishment, want.kc_ini, `${where}: Kc_ini`);
    assert.equal(crop.kc.flowering, want.kc_mid, `${where}: Kc_mid`);
    assert.equal(crop.kc.maturity, want.kc_end, `${where}: Kc_end`);
    if (want.kc_end_range) {
      assert.ok(
        crop.kc.maturity >= want.kc_end_range[0] && crop.kc.maturity <= want.kc_end_range[1],
        `${where}: Kc_end outside the tabulated ${want.kc_end_range.join(" to ")}`,
      );
    }
    // The vegetative stage stands for FAO-56's development stage, which ramps
    // from Kc_ini to Kc_mid: it belongs between the two, near the midpoint.
    const midpoint = (want.kc_ini + want.kc_mid) / 2;
    assert.ok(
      crop.kc.vegetative > Math.min(want.kc_ini, want.kc_mid) - 1e-9 &&
        crop.kc.vegetative < Math.max(want.kc_ini, want.kc_mid) + 1e-9 &&
        Math.abs(crop.kc.vegetative - midpoint) <= 0.1,
      `${where}: development-stage Kc ${crop.kc.vegetative} is not near ${midpoint.toFixed(3)}`,
    );
    assert.equal(crop.root_depth_m, want.root_m, `${where}: root depth`);
    if (want.root_m_range) {
      assert.ok(
        crop.root_depth_m >= want.root_m_range[0] && crop.root_depth_m <= want.root_m_range[1],
        `${where}: root depth outside the tabulated ${want.root_m_range.join(" to ")} m`,
      );
    }
    assert.equal(crop.depletion_fraction, want.p, `${where}: p`);
    assert.equal(crop.planting_rain_mm, want.planting_rain_mm, `${where}: planting rain`);
    assert.deepEqual(
      [crop.heat.mild, crop.heat.moderate, crop.heat.severe], want.heat, `${where}: heat-stress thresholds`,
    );
    assert.equal(crop.heat_sensitive_stage, want.heat_sensitive_stage, `${where}: heat-sensitive stage`);
    assert.equal(driesDownAtMaturity(crop), want.dries_down, `${where}: dry-down at maturity`);
  }
  assert.equal(CROP_EXPECTATIONS.length, 7);
});

test("p is corrected for the day's demand, FAO-56 eq. 83", () => {
  // Maize at exactly 5 mm/day keeps the tabulated p; a lighter demand raises it.
  assert.equal(adjustedDepletionFraction(0.55, 5), 0.55);
  assert.equal(adjustedDepletionFraction(0.55, 3), 0.63);
  assert.equal(adjustedDepletionFraction(0.55, 8), 0.43);
  // FAO-56 keeps p inside 0.1 to 0.8 whatever the arithmetic gives.
  assert.equal(adjustedDepletionFraction(0.35, 30), 0.1);
  assert.equal(adjustedDepletionFraction(0.65, 0), 0.8);
});

test("the root-zone balance carries depletion day by day and never leaves [0, TAW]", () => {
  const days = ["d1", "d2", "d3", "d4"];
  const rain: Record<string, number> = { d3: 12 };
  // 4 mm/day of demand, 12 mm of rain on the third day (9.6 mm effective):
  // 4, 8, 2.4, 6.4.
  const run = runRootZoneBalance(days, () => 4, (d) => rain[d] ?? 0, 100);
  assert.equal(run.depletion_mm, 6.4);
  assert.equal(run.days_with_rain, 4);

  // A storm far larger than the root zone fills it and no more: the rest
  // drains past the roots instead of banking against future demand.
  const storm = runRootZoneBalance(["a", "b"], () => 4, (d) => (d === "a" ? 100 : 0), 24);
  assert.equal(storm.depletion_mm, 4);
  // Long dry runs stop at the empty zone, not beyond it.
  const dry = runRootZoneBalance(datesEnding("2026-09-21", 60), () => 4, () => 0, 24);
  assert.equal(dry.depletion_mm, 24);
});

test("depths are stated in 5 mm steps and rounded down", () => {
  assert.equal(floorToFiveMm(24.9), 20);
  assert.equal(floorToFiveMm(25), 25);
  assert.equal(floorToFiveMm(4.9), 0);
  assert.equal(floorToFiveMm(-3), 0);
});

const TODAY = "2026-09-21";

/** The date `n` days before TODAY. */
function ago(n: number): string {
  return datesEnding(TODAY, n + 1)[0];
}

/** A full balance window of station inputs: dry every day except those given. */
function inputs(o: { et0: number; rain?: Record<string, number | null>; forecast48h?: number | null }): FarmInputs {
  const days = datesEnding(TODAY, BALANCE_DAYS);
  const rain = o.rain ?? {};
  return {
    today: TODAY,
    et0: { et0_mm_day: o.et0, tmax_c: 26, tmin_c: 13, source: "station", station_hours: 24, ra_mm_day: 15.25 },
    past_et0: Object.fromEntries(days.slice(0, -1).map((d) => [d, { et0_mm: o.et0, source: "station" as const }])),
    rain: { source: "station_gauge", days: days.map((date) => ({ date, mm: date in rain ? rain[date] : 0 })) },
    regional_et0_mm_day: 4.1,
    forecast_rain_48h_mm: o.forecast48h === undefined ? 0 : o.forecast48h,
    soil: null,
  };
}

/** A zone filled to field capacity `n` days ago and dry since. */
function filledDaysAgo(n: number, o: { et0: number; forecast48h?: number | null }): FarmInputs {
  return inputs({ ...o, rain: { [ago(n)]: 400 } });
}

// Maize at 5 mm/day of ET₀: Kc 0.80 in the vegetative stage gives 4.00 mm/day
// of demand, a 0.65 m root zone holds 104 mm, and p rises to 0.59 at that
// demand, so the refill point is 61.4 mm.
const maizeBalance = (days: number, forecast48h?: number | null) =>
  computeWaterBalance(filledDaysAgo(days, { et0: 5, forecast48h }), maize, "vegetative");

test("the balance reads the root zone, not the week's rain total", () => {
  const wb = maizeBalance(15);
  assert.equal(wb.etc_mm_day, 4);
  assert.equal(wb.taw_mm, 104);
  assert.equal(wb.depletion_fraction_adjusted, 0.59);
  assert.equal(wb.readily_available_mm, 61.4);
  assert.equal(wb.depletion_mm, 60);
  assert.equal(wb.balance_days, BALANCE_DAYS);
  assert.equal(wb.balance_days_with_rain, BALANCE_DAYS);
  assert.equal(wb.balance_available, true);
  assert.equal(wb.weekly_requirement_mm, 28);
});

test("just below the refill point there is no irrigation, only the day it falls due", () => {
  const wb = maizeBalance(15);
  assert.ok(wb.depletion_mm < wb.readily_available_mm);
  const advice = computeIrrigationAdvice(wb, maize, "vegetative");
  assert.equal(advice.action, "NO_IRRIGATION");
  assert.equal(advice.depth_mm, 0);
  // (61.4 − 60) / 4 is under a day, so the answer is tomorrow.
  assert.equal(advice.days_until_irrigation, 1);
  assert.deepEqual(advice.reason_keys, ["farm_reason_below_raw"]);

  // Five days earlier the zone holds 20 mm more and the date moves out with it.
  const earlier = computeIrrigationAdvice(maizeBalance(10), maize, "vegetative");
  assert.equal(earlier.action, "NO_IRRIGATION");
  assert.equal(earlier.days_until_irrigation, 5);
});

test("at the refill point the advice is the depletion, rounded down to 5 mm", () => {
  const wb = maizeBalance(16);
  assert.equal(wb.depletion_mm, 64);
  assert.ok(wb.depletion_mm >= wb.readily_available_mm);
  const advice = computeIrrigationAdvice(wb, maize, "vegetative");
  assert.equal(advice.action, "IRRIGATE_NOW");
  assert.equal(advice.depth_mm, 60);
  assert.equal(advice.litres_per_m2, 60);
  assert.equal(advice.days_until_irrigation, null);
  assert.equal(advice.confidence, "HIGH");
  assert.ok(advice.reason_keys.includes("farm_reason_zone_at_raw"));
});

test("a zone empty for weeks is refilled over several passes, never beyond what it holds", () => {
  // 40 days at 4 mm/day would be 160 mm; the zone holds 104, and a single
  // pass is held to the 61.4 mm the crop can take up readily.
  const wb = maizeBalance(40);
  assert.equal(wb.depletion_mm, wb.taw_mm);
  assert.equal(wb.depletion_pct, 100);
  const advice = computeIrrigationAdvice(wb, maize, "vegetative");
  assert.equal(advice.depth_mm, 60);
  assert.equal(advice.remaining_mm, 40);
  assert.ok(advice.reason_keys.includes("farm_reason_split_passes"));
  assert.ok(advice.depth_mm + advice.remaining_mm <= wb.taw_mm);
});

test("a storm larger than the root zone does not suppress irrigation for weeks", () => {
  // Kale seedlings: a 0.2 m zone holds 32 mm, and 100 mm of rain yesterday
  // leaves 80 mm of effective rain with nowhere to go.
  const wb = computeWaterBalance(inputs({ et0: 7, rain: { [ago(1)]: 100 } }), kale, "establishment");
  assert.equal(wb.taw_mm, 32);
  assert.equal(wb.etc_mm_day, 4.9);
  assert.equal(wb.depletion_mm, 4.9);
  assert.equal(wb.readily_available_mm, 12.8);
  const advice = computeIrrigationAdvice(wb, kale, "establishment");
  assert.equal(advice.action, "NO_IRRIGATION");
  // 8 mm short of the refill point at 4.9 mm a day: two days, not a fortnight.
  assert.equal(advice.days_until_irrigation, 2);
});

test("rain in the forecast holds irrigation only when it covers most of the refill", () => {
  // 64 mm of depletion. 80 mm of forecast rain is 64 mm effective: a hold.
  const held = computeIrrigationAdvice(maizeBalance(16, 80), maize, "vegetative");
  assert.equal(held.action, "HOLD_RAIN_EXPECTED");
  assert.equal(held.depth_mm, 0);
  assert.ok(held.reason_keys.includes("farm_reason_rain_expected"));
  assert.equal(held.confidence, "MODERATE");

  // 10 mm of forecast rain is 8 mm effective against 64 mm: irrigate the rest.
  const part = computeIrrigationAdvice(maizeBalance(16, 10), maize, "vegetative");
  assert.equal(part.action, "IRRIGATE_NOW");
  assert.equal(part.depth_mm, 55);
  assert.ok(part.reason_keys.includes("farm_reason_forecast_part_covered"));
});

test("without a forecast the advice says so and is less sure", () => {
  const advice = computeIrrigationAdvice(maizeBalance(16, null), maize, "vegetative");
  assert.equal(advice.action, "IRRIGATE_NOW");
  assert.equal(advice.depth_mm, 60);
  assert.ok(advice.reason_keys.includes("farm_reason_forecast_unavailable"));
  assert.equal(advice.confidence, "MODERATE");
});

test("a wet zone gives no irrigation and says the rain covered the week", () => {
  // Filled ten days ago, then 25 mm and 20 mm inside the last week: 36 mm of
  // effective rain against 28 mm of demand leaves the zone all but full.
  const wb = computeWaterBalance(
    inputs({ et0: 5, rain: { [ago(10)]: 400, [ago(4)]: 25, [ago(1)]: 20 } }), maize, "vegetative",
  );
  assert.equal(wb.demand_7d_mm, 28);
  assert.equal(wb.effective_rain_7d_mm, 36);
  assert.equal(wb.depletion_mm, 4);
  const advice = computeIrrigationAdvice(wb, maize, "vegetative");
  assert.equal(advice.action, "NO_IRRIGATION");
  assert.equal(advice.days_until_irrigation, 14);
  assert.deepEqual(advice.reason_keys, ["farm_reason_below_raw", "farm_reason_rain_meets_demand"]);
});

test("missing rain days are counted, and too many stop the advice", () => {
  const gaps = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [ago(i + 2), null]));
  const wb = computeWaterBalance(inputs({ et0: 5, rain: { [ago(16)]: 400, ...gaps } }), maize, "vegetative");
  assert.equal(wb.balance_days_with_rain, BALANCE_DAYS - 6);
  assert.equal(wb.balance_available, true);
  // The six unread days still evaporated, so their demand stands.
  assert.equal(wb.depletion_mm, 64);
  // A gap in the record is never full confidence, however good the sources are.
  assert.equal(computeIrrigationAdvice(wb, maize, "vegetative").confidence, "MODERATE");

  const thin = Object.fromEntries(datesEnding(TODAY, 20).map((d) => [d, null]));
  const wbThin = computeWaterBalance(inputs({ et0: 5, rain: thin }), maize, "vegetative");
  assert.equal(wbThin.balance_available, false);
  const advice = computeIrrigationAdvice(wbThin, maize, "vegetative");
  assert.equal(advice.action, "DATA_TOO_THIN");
  assert.equal(advice.depth_mm, 0);
  assert.equal(advice.confidence, "LOW");
  assert.deepEqual(advice.reason_keys, ["farm_reason_balance_short", "farm_reason_weekly_requirement"]);
  // What is left to say is the week's requirement.
  assert.equal(wbThin.weekly_requirement_mm, 28);
});

test("a record shorter than the window runs anyway, and says how short", () => {
  // The regional model reaches back 31 days, so the fallback has to keep
  // working on a window that short.
  const short = Object.fromEntries(datesEnding(ago(31), BALANCE_DAYS - 31).map((d) => [d, null]));
  const wb = computeWaterBalance(inputs({ et0: 5, rain: short }), maize, "vegetative");
  assert.equal(wb.balance_days, 31);
  assert.equal(wb.balance_available, true);
  // A window that short starts too near today to claim full confidence.
  assert.equal(computeIrrigationAdvice(wb, maize, "vegetative").confidence, "MODERATE");
});

test("a crop that dries down before harvest is not watered at maturity", () => {
  // A zone dry enough that every one of these crops would otherwise be watered.
  const dry = filledDaysAgo(59, { et0: 7 });
  for (const crop of [maize, beans]) {
    const wb = computeWaterBalance(dry, crop, "maturity");
    assert.ok(wb.depletion_mm >= wb.readily_available_mm, `${crop.key} should be past the refill point`);
    const advice = computeIrrigationAdvice(wb, crop, "maturity");
    assert.equal(advice.action, "NO_IRRIGATION", `${crop.key} at maturity`);
    assert.equal(advice.depth_mm, 0);
    assert.deepEqual(advice.reason_keys, ["farm_reason_dry_down"]);
    // The stages before it are watered as usual.
    assert.equal(computeIrrigationAdvice(computeWaterBalance(dry, crop, "flowering"), crop, "flowering").action, "IRRIGATE_NOW");
  }
  // Kale is cut leaf by leaf and keeps growing, so maturity is watered as usual.
  const kaleWb = computeWaterBalance(dry, kale, "maturity");
  assert.equal(computeIrrigationAdvice(kaleWb, kale, "maturity").action, "IRRIGATE_NOW");
});

test("every crop at every stage gives an advice that fits its own root zone", () => {
  for (const crop of CROP_EXPECTATIONS.map((c) => findCropProfile(c.key) as CropProfile)) {
    for (const stage of STAGES) {
      for (const days of [0, 5, 15, 40]) {
        const wb = computeWaterBalance(filledDaysAgo(days, { et0: 5 }), crop, stage);
        const advice = computeIrrigationAdvice(wb, crop, stage);
        const where = `${crop.key}/${stage} after ${days} dry days`;
        assert.ok(wb.depletion_mm >= 0 && wb.depletion_mm <= wb.taw_mm, `${where}: Dr outside [0, TAW]`);
        assert.ok(wb.readily_available_mm <= wb.taw_mm, `${where}: RAW above TAW`);
        assert.ok(advice.depth_mm <= wb.depletion_mm, `${where}: depth above the depletion`);
        assert.ok(advice.depth_mm <= wb.taw_mm, `${where}: depth above what the zone holds`);
        assert.equal(advice.depth_mm % 5, 0, `${where}: depth not a 5 mm step`);
        if (advice.action === "IRRIGATE_NOW") {
          assert.ok(wb.depletion_mm >= wb.readily_available_mm, `${where}: watering a zone below the refill point`);
          assert.ok(advice.depth_mm >= 5, `${where}: pointless depth`);
        }
        if (advice.action === "NO_IRRIGATION" && advice.reason_keys[0] === "farm_reason_below_raw") {
          assert.ok((advice.days_until_irrigation ?? 0) >= 1, `${where}: no date for the next watering`);
        }
      }
    }
  }
});

test("the gauge is used when it reported on 6 of the last 7 days, otherwise the regional model", () => {
  const dates = datesEnding(TODAY, 30);
  const regional: RainDay[] = dates.map((date) => ({ date, mm: 1 }));
  const gauge = (missing: number): RainDay[] =>
    dates.map((date, i) => ({ date, mm: i >= 30 - missing ? null : 0 }));
  assert.equal(chooseRainRecord(gauge(1), regional)?.source, "station_gauge");
  assert.equal(chooseRainRecord(gauge(2), regional)?.source, "regional_model");
  assert.equal(chooseRainRecord(null, null), null);
});

test("confidence follows where the inputs came from", () => {
  const base = filledDaysAgo(16, { et0: 5 });
  const regionalRain: FarmInputs = { ...base, rain: { ...base.rain, source: "regional_model" } };
  const allRegional: FarmInputs = { ...regionalRain, et0: { ...base.et0, source: "regional_forecast" } };
  const confidence = (i: FarmInputs) =>
    computeIrrigationAdvice(computeWaterBalance(i, maize, "vegetative"), maize, "vegetative").confidence;
  assert.equal(confidence(base), "HIGH");
  assert.equal(confidence(regionalRain), "MODERATE");
  assert.equal(confidence(allRegional), "LOW");
});

test("the inputs fall back to the regional model and say so", () => {
  const now = Date.parse("2026-09-21T09:00:00Z");
  const days = datesEnding(TODAY, BALANCE_DAYS + 2).concat(["2026-09-22", "2026-09-23"]);
  const regional = {
    days: days.map((date) => ({ date, precip_mm: date === "2026-09-19" ? 12 : 0, tmax_c: 26, tmin_c: 14, et0_mm: 4.2 })),
    hours: Array.from({ length: 24 * 5 }, (_, i) => ({
      time: new Date(Date.parse("2026-09-19T21:00:00Z") + (i + 1) * 3600_000).toISOString(),
      precip_mm: i === 30 ? 3 : 0.1,
    })),
  };
  const farm = assembleFarmInputs(now, { station: null, stationRain: null, regional, soil: null });
  assert.ok(farm);
  assert.equal(farm.today, TODAY);
  assert.equal(farm.et0.source, "regional_forecast");
  assert.equal(farm.rain.source, "regional_model");
  assert.equal(farm.regional_et0_mm_day, 4.2);
  assert.equal(farm.rain.days.length, BALANCE_DAYS);
  // Today so far: the twelve hours ending 01:00 to 12:00 EAT, the one ending 07:00 with 3 mm.
  assert.equal(farm.rain.days[farm.rain.days.length - 1].mm, 4.1);
  assert.equal(farm.forecast_rain_48h_mm, 4.8);
  // No station and no regional record: no advice at all.
  assert.equal(assembleFarmInputs(now, { station: null, stationRain: null, regional: null, soil: null }), null);
});

test("heat stress reads the crop's own thresholds, not one set for all", () => {
  const at = (tmax: number) => estimateEt0("2026-09-21", { tmax_c: tmax, tmin_c: 15, measured_hours: 24 }, null)!;
  // 29 °C: nothing for a C4 fodder grass, mild for maize in flower, moderate
  // for potato, which sets tubers below it.
  assert.equal(evaluateCropStress(at(29), findCropProfile("napier")!, "vegetative").level, "NONE");
  assert.equal(evaluateCropStress(at(29), maize, "flowering").level, "MILD");
  assert.equal(evaluateCropStress(at(29), findCropProfile("potato")!, "vegetative").level, "MODERATE");
  assert.equal(evaluateCropStress(at(29), maize, "vegetative").level, "NONE");

  // The shift belongs to the stage that has a flower; kale's does not.
  const kaleFlower = evaluateCropStress(at(26), kale, "flowering");
  assert.equal(kaleFlower.level, "NONE");
  assert.equal(kaleFlower.mild_threshold_c, 28);
  assert.ok(!kaleFlower.reason_keys.includes("farm_reason_flowering_sensitive"));
  const maizeFlower = evaluateCropStress(at(33), maize, "flowering");
  assert.equal(maizeFlower.mild_threshold_c, 29);
  assert.equal(maizeFlower.level, "MODERATE");
  assert.ok(maizeFlower.reason_keys.includes("farm_reason_flowering_sensitive"));
  assert.equal(maizeFlower.peak_source, "station");

  // Thresholds are the crop's, whatever the stage.
  for (const want of CROP_EXPECTATIONS) {
    const crop = findCropProfile(want.key) as CropProfile;
    for (const stage of STAGES) {
      const shift = stage === want.heat_sensitive_stage ? 3 : 0;
      const signal = evaluateCropStress(at(want.heat[0] - shift), crop, stage);
      assert.equal(signal.level, "MILD", `${want.key}/${stage} at its own mild threshold`);
      assert.equal(evaluateCropStress(at(want.heat[2] - shift), crop, stage).level, "SEVERE", `${want.key}/${stage}`);
    }
  }
});

// 12:00 EAT on 21 September. The station's own sun times that day are 06:21
// and 18:28 EAT, so this sits well inside them.
const MIDDAY = "2026-09-21T09:00:00Z";

function situation(o: {
  wind: number;
  temp: number;
  rainProb: number;
  quality: string;
  /** When the advisory was built; midday unless the test is about the hour */
  at?: string;
  imputed?: string[];
}): SituationResult {
  return {
    generated_at: o.at ?? MIDDAY,
    current: { wind_speed_ms: o.wind, temperature_c: o.temp, humidity_pct: 60, imputed: o.imputed },
    risk: { rain_probability: o.rainProb },
    quality: { status: o.quality },
  } as unknown as SituationResult;
}

const SPRAYABLE = { wind: 2, temp: 24, rainProb: 0.1, quality: "GOOD" };

test("spraying is never suitable outside daylight, whatever the conditions say", () => {
  assert.equal(evaluateSprayWindow(situation(SPRAYABLE)).quality, "GOOD");

  // 23:41 EAT, the hour the live advisory called this window suitable.
  const night = evaluateSprayWindow(situation({ ...SPRAYABLE, at: "2026-09-21T20:41:00Z" }));
  assert.equal(night.quality, "AVOID");
  assert.equal(night.reason_keys[0], "farm_reason_outside_daylight");

  // Either side of sunrise: 06:00 EAT is still dark, 07:00 is not.
  assert.equal(evaluateSprayWindow(situation({ ...SPRAYABLE, at: "2026-09-21T03:00:00Z" })).quality, "AVOID");
  assert.equal(evaluateSprayWindow(situation({ ...SPRAYABLE, at: "2026-09-21T04:00:00Z" })).quality, "GOOD");
  // And 19:00 EAT, half an hour past sunset.
  assert.equal(evaluateSprayWindow(situation({ ...SPRAYABLE, at: "2026-09-21T16:00:00Z" })).quality, "AVOID");

  // The gate reads the hour the advisory was built, not the hour of the crop
  // year: midwinter and midsummer noon are both daylight here.
  for (const noon of ["2026-06-21T09:00:00Z", "2026-12-21T09:00:00Z"]) {
    assert.equal(evaluateSprayWindow(situation({ ...SPRAYABLE, at: noon })).quality, "GOOD", noon);
  }
});

test("a spray verdict resting on a filled-in reading is never GOOD", () => {
  for (const field of ["wind_spd", "temp_sht"]) {
    const filled = evaluateSprayWindow(situation({ ...SPRAYABLE, imputed: [field] }));
    assert.equal(filled.quality, "MARGINAL", field);
    assert.ok(filled.reason_keys.includes("farm_reason_spray_inputs_filled"), field);
  }
  // A reading the spray rules never read is not a reason to doubt the verdict.
  const other = evaluateSprayWindow(situation({ ...SPRAYABLE, imputed: ["humidity_sht"] }));
  assert.equal(other.quality, "GOOD");
  assert.ok(!other.reason_keys.includes("farm_reason_spray_inputs_filled"));

  // It takes the window down and never lifts one already refused.
  const windy = evaluateSprayWindow(situation({ ...SPRAYABLE, wind: 6, imputed: ["wind_spd"] }));
  assert.equal(windy.quality, "AVOID");
  assert.ok(windy.reason_keys.includes("farm_reason_spray_inputs_filled"));
});

test("the reasons that took a spray window down are listed before the ones that were met", () => {
  const worst = evaluateSprayWindow(
    situation({ wind: 6, temp: 24, rainProb: 0.6, quality: "POOR", at: "2026-09-21T20:41:00Z", imputed: ["temp_sht"] }),
  );
  assert.deepEqual(worst.reason_keys, [
    "farm_reason_outside_daylight",
    "farm_reason_wind_drift",
    "farm_reason_washoff",
    "farm_reason_spray_inputs_filled",
    "farm_reason_data_limited",
  ]);
});

test("every reason key the farm engine can emit is written in both languages", () => {
  const keys = Object.keys(STRINGS.en).filter((k) => k.startsWith("farm_"));
  assert.ok(keys.length > 60, `${keys.length} farm keys`);
  for (const k of keys) assert.ok(STRINGS.sw[k], `${k} has no Kiswahili`);

  const emitted = new Set<string>([
    ...evaluateSprayWindow(situation({ ...SPRAYABLE, at: "2026-09-21T20:41:00Z", imputed: ["wind_spd"] })).reason_keys,
    ...evaluateSprayWindow(situation({ wind: 0.2, temp: 29, rainProb: 0.3, quality: "POOR" })).reason_keys,
    ...evaluateSprayWindow(situation(SPRAYABLE)).reason_keys,
  ]);
  for (const k of emitted) {
    assert.ok(STRINGS.en[k], `${k} has no English`);
    assert.ok(STRINGS.sw[k], `${k} has no Kiswahili`);
  }
});

test("poor data quality lowers a spray window and never lifts one", () => {
  const windy = { wind: 6, temp: 24, rainProb: 0.1 };
  assert.equal(evaluateSprayWindow(situation({ ...windy, quality: "GOOD" })).quality, "AVOID");
  const poor = evaluateSprayWindow(situation({ ...windy, quality: "POOR" }));
  assert.equal(poor.quality, "AVOID");
  assert.ok(poor.reason_keys.includes("farm_reason_data_limited"));
  // Rain on the way is still a reason to keep the sprayer in the shed.
  assert.equal(evaluateSprayWindow(situation({ wind: 2, temp: 24, rainProb: 0.6, quality: "POOR" })).quality, "AVOID");
  // A window with nothing against it is only taken down to marginal.
  const calm = evaluateSprayWindow(situation({ wind: 2, temp: 24, rainProb: 0.1, quality: "POOR" }));
  assert.equal(calm.quality, "MARGINAL");
  assert.equal(evaluateSprayWindow(situation({ wind: 2, temp: 24, rainProb: 0.1, quality: "GOOD" })).quality, "GOOD");
});

test("planting needs a real wetting and a root zone that is not in deficit", () => {
  const dry = filledDaysAgo(40, { et0: 5 });
  const wbDry = computeWaterBalance(dry, maize, "establishment");
  const steady = inputs({ et0: 5, rain: Object.fromEntries(datesEnding(TODAY, 30).map((d) => [d, 2.5])) });
  const wbSteady = computeWaterBalance(steady, maize, "establishment");

  // 75 mm over the month, but never more than 2.5 mm in a day: nothing has
  // wet the seedbed, whatever the seasonal total says.
  const drizzle = evaluatePlantingOutlook(steady.rain, TODAY, maize, wbSteady);
  assert.equal(drizzle.rain_30d_mm, 75);
  assert.equal(drizzle.wetting_mm, 7.5);
  assert.equal(drizzle.favourable, false);
  assert.equal(drizzle.message_key, "farm_plant_no_wetting");

  // The same total with one soaking of 25 mm two days ago is a planting rain.
  const soaked = inputs({
    et0: 5,
    rain: { ...Object.fromEntries(datesEnding(TODAY, 30).map((d) => [d, 2])), [ago(2)]: 25 },
  });
  const outlook = evaluatePlantingOutlook(soaked.rain, TODAY, maize, computeWaterBalance(soaked, maize, "establishment"));
  assert.ok(outlook.rain_30d_mm >= maize.planting_rain_mm);
  assert.equal(outlook.wetting_mm, 29);
  assert.equal(outlook.wetting_required_mm, 20);
  assert.equal(outlook.favourable, true);
  assert.equal(outlook.message_key, "farm_plant_favourable");

  // A dry root zone and "conditions favour planting" must never appear together.
  const contradiction = evaluatePlantingOutlook(dry.rain, TODAY, maize, wbDry);
  assert.equal(contradiction.favourable, false);
  assert.equal(computeIrrigationAdvice(wbDry, maize, "establishment").action, "IRRIGATE_NOW");
});

test("the planting outlook uses the same rain record, and a missing day ends a dry spell", () => {
  const dates = datesEnding(TODAY, 30);
  const days = dates.map((date, i) => ({ date, mm: i === 19 ? null : i < 10 ? 5 : 0 }));
  const wb = computeWaterBalance(inputs({ et0: 5 }), maize, "establishment");
  const outlook = evaluatePlantingOutlook({ source: "station_gauge", days }, TODAY, maize, wb);
  assert.equal(outlook.rain_source, "station_gauge");
  assert.equal(outlook.rain_30d_mm, 50);
  assert.equal(outlook.rain_days_with_data, 29);
  assert.equal(outlook.dry_spell_days, 10);
  assert.equal(outlook.favourable, false);
  assert.equal(outlook.message_key, "farm_plant_dryspell");
});

test("the planting outlook carries the 48-hour forecast without letting it decide", () => {
  // Drizzle every day of the month: 75 mm in total and nothing that wet the
  // seedbed, whatever the next two days are forecast to bring.
  const drizzle = Object.fromEntries(datesEnding(TODAY, 30).map((d) => [d, 2.5]));
  const outlook = (forecast48h: number | null) => {
    const i = inputs({ et0: 5, rain: drizzle, forecast48h });
    return evaluatePlantingOutlook(i.rain, TODAY, maize, computeWaterBalance(i, maize, "establishment"));
  };

  assert.equal(outlook(60).forecast_rain_48h_mm, 60);
  assert.equal(outlook(null).forecast_rain_48h_mm, null);
  // 60 mm on the way is more than a seedbed needs, and it has wet nothing yet.
  for (const forecast of [null, 0, 60]) {
    assert.equal(outlook(forecast).favourable, false, `${forecast}`);
    assert.equal(outlook(forecast).message_key, "farm_plant_no_wetting", `${forecast}`);
  }
});

test("the stress signal counts the hours the day held above the threshold", () => {
  // The fixture day peaks at 26.0 °C at 15:00 EAT, on quarter-hour slots: it
  // crosses 25.0 °C at 14:18 and falls back through it at 16:09.
  const series = diurnalSeries("2026-09-20T12:15:00Z", 24);
  const day = { series, end: "2026-09-21T12:00:00Z" };
  const et0 = estimateEt0("2026-09-21", measuredTempRange(series, day.end), null)!;

  // One quarter-hour slot at the peak, stated to a tenth of an hour.
  assert.equal(measuredHoursAbove(day, 26), 0.3);
  assert.equal(measuredHoursAbove(day, 25), 1.8);
  assert.equal(measuredHoursAbove(day, 13), 24);
  assert.equal(measuredHoursAbove(day, 40), 0);

  // Coffee at 26 °C: the peak just reaches the mild threshold, and the count
  // says it was the one quarter hour rather than the afternoon.
  const coffee = evaluateCropStress(et0, findCropProfile("coffee")!, "vegetative", day);
  assert.equal(coffee.level, "MILD");
  assert.equal(coffee.mild_threshold_c, 26);
  assert.equal(coffee.hours_above_mild, 0.3);

  // The level is the peak alone, and the count never moves it.
  assert.equal(evaluateCropStress(et0, findCropProfile("coffee")!, "vegetative").level, "MILD");
  assert.equal(evaluateCropStress(et0, maize, "vegetative", day).hours_above_mild, 0);

  // Filled-in slots do not count, and a day the station barely covered gets no
  // figure at all rather than one that can only understate. Five hours carried
  // forward leave 19 measured, under the 20 the ET₀ range asks for.
  const filled = series.map((o, i) => (i < 20 ? { ...o, imputed: ["temp_sht"] } : o));
  assert.equal(measuredHoursAbove({ series: filled, end: day.end }, 13), 19);
  const thin = estimateEt0("2026-09-21", measuredTempRange(filled, day.end), { tmax_c: 26, tmin_c: 13 })!;
  assert.equal(thin.source, "regional_forecast");
  assert.equal(evaluateCropStress(thin, findCropProfile("coffee")!, "vegetative", day).hours_above_mild, null);

  // Nothing to count over is not zero hours.
  assert.equal(measuredHoursAbove({ series: [], end: day.end }, 20), null);
  assert.equal(measuredHoursAbove({ series, end: "2026-09-19T00:00:00Z" }, 20), null);
});

test("an unknown crop is refused with the list of crops", async () => {
  assert.equal(findCropProfile("rice"), null);
  const req = new Request("http://localhost/api/farm", {
    method: "POST",
    body: JSON.stringify({ crop: "rice", stage: "vegetative" }),
  });
  const res = await POST(req as never);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; valid_crops: string[] };
  assert.equal(body.error, "unknown_crop");
  assert.ok(body.valid_crops.includes("maize") && body.valid_crops.includes("kale"));
});

test("a year of the archive keeps the advice near what the crop actually used", () => {
  // The decision has memory, so the replay applies what it advises, the way a
  // farmer following the page would. Over the dry season, when no rain arrives
  // to confuse the accounting, the total applied has to land near total demand.
  const series = getCsvRange("2026-03-01T00:00:00Z", "2026-09-09T00:00:00Z");
  const ranges = measuredDailyRanges(series);
  const et0ByDate = new Map(
    [...ranges]
      .filter(([, r]) => r.measured_hours >= 20)
      .map(([date, r]) => [date, computeEt0(r.tmax_c, r.tmin_c, dayOfYear(date))] as const),
  );
  const dates = [...et0ByDate.keys()].sort().filter((d) => d >= "2026-06-01" && d <= "2026-09-08");
  assert.ok(dates.length > 90, `expected a dry season of days, got ${dates.length}`);

  const stage: GrowthStage = "vegetative";
  const kc = maize.kc[stage];
  let dr = 0;
  let applied = 0;
  let demand = 0;
  let events = 0;
  for (const date of dates) {
    const et0 = et0ByDate.get(date)!;
    const wb: WaterBalance = {
      ...computeWaterBalance(
        {
          today: date,
          et0: { et0_mm_day: et0, tmax_c: 26, tmin_c: 13, source: "station", station_hours: 24, ra_mm_day: 15 },
          past_et0: Object.fromEntries(
            datesEnding(date, BALANCE_DAYS).map((d) => [d, { et0_mm: et0ByDate.get(d) ?? et0, source: "station" as const }]),
          ),
          rain: { source: "station_gauge", days: datesEnding(date, BALANCE_DAYS).map((d) => ({ date: d, mm: 0 })) },
          regional_et0_mm_day: null,
          forecast_rain_48h_mm: 0,
          soil: null,
        },
        maize,
        stage,
      ),
      depletion_mm: Math.round(dr * 10) / 10,
    };
    demand += kc * et0;
    dr = Math.min(wb.taw_mm, dr + kc * et0);
    const advice = computeIrrigationAdvice({ ...wb, depletion_mm: Math.round(dr * 10) / 10 }, maize, stage);
    if (advice.action === "IRRIGATE_NOW") {
      applied += advice.depth_mm;
      dr = Math.max(0, dr - advice.depth_mm);
      events++;
    }
  }
  // The old rule advised its full depth every single day of this window.
  assert.ok(events < dates.length / 10, `${events} waterings in ${dates.length} dry days`);
  assert.ok(
    applied > 0.8 * demand && applied < 1.1 * demand,
    `applied ${applied.toFixed(0)} mm against ${demand.toFixed(0)} mm of demand`,
  );
});

test("a pass within the readily available water is given whole", () => {
  const due = maizeBalance(16, 0);
  const advice = computeIrrigationAdvice(due, maize, "vegetative");
  assert.equal(advice.action, "IRRIGATE_NOW");
  assert.ok(advice.depth_mm > 0 && advice.depth_mm <= floorToFiveMm(due.readily_available_mm));
  assert.equal(advice.remaining_mm, 0);
  assert.ok(!advice.reason_keys.includes("farm_reason_split_passes"));
});

// Irrigation the farmer records

const maizeWithApplied = (days: number, applied: { date: string; mm: number }[]) =>
  computeWaterBalance({ ...filledDaysAgo(days, { et0: 5, forecast48h: 0 }), applied }, maize, "vegetative");

test("water the farmer records comes off the depletion", () => {
  const without = maizeBalance(20, 0);
  const with30 = maizeWithApplied(20, [{ date: ago(5), mm: 30 }]);
  assert.equal(with30.depletion_mm, without.depletion_mm - 30);
  assert.equal(with30.irrigation_applied_mm, 30);
  assert.equal(with30.irrigation_days, 1);
});

test("a recorded pass counts in full where rain counts at its effective share", () => {
  // Filled 20 days back, so neither run reaches the full-zone ceiling, where
  // the two would be indistinguishable.
  const rained = computeWaterBalance(
    inputs({ et0: 5, rain: { [ago(20)]: 400, [ago(5)]: 20 }, forecast48h: 0 }),
    maize,
    "vegetative",
  );
  const watered = computeWaterBalance(
    { ...inputs({ et0: 5, rain: { [ago(20)]: 400 }, forecast48h: 0 }), applied: [{ date: ago(5), mm: 20 }] },
    maize,
    "vegetative",
  );
  // A day of 20 mm of rain reaches the root zone as 0.8 x 20 = 16 mm; 20 mm
  // applied reaches it as 20.
  assert.ok(rained.depletion_mm < rained.taw_mm, "the rained run must stay off the ceiling");
  assert.equal(rained.depletion_mm - watered.depletion_mm, 4);
});

test("recording yesterday's watering stops the advice repeating today", () => {
  const due = maizeBalance(16, 0);
  assert.equal(computeIrrigationAdvice(due, maize, "vegetative").action, "IRRIGATE_NOW");

  const depth = computeIrrigationAdvice(due, maize, "vegetative").depth_mm;
  const after = maizeWithApplied(16, [{ date: ago(1), mm: depth }]);
  const advice = computeIrrigationAdvice(after, maize, "vegetative");
  assert.equal(advice.action, "NO_IRRIGATION");
  assert.ok(advice.days_until_irrigation != null && advice.days_until_irrigation > 0);
});

test("water poured past field capacity is not banked", () => {
  const drowned = maizeWithApplied(20, [{ date: ago(10), mm: 150 }]);
  assert.equal(drowned.depletion_mm, 40);
  assert.equal(drowned.irrigation_applied_mm, 150);
});

test("a record outside the balance window changes nothing", () => {
  const outside = maizeWithApplied(20, [{ date: ago(BALANCE_DAYS + 5), mm: 40 }]);
  assert.equal(outside.depletion_mm, maizeBalance(20, 0).depletion_mm);
  assert.equal(outside.irrigation_days, 0);
});
