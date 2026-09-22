import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseRainRecord,
  computeEt0,
  computeIrrigationAdvice,
  computeWaterBalance,
  effectiveRainMm,
  estimateEt0,
  evaluateCropStress,
  evaluatePlantingOutlook,
  extraterrestrialRadiationMm,
  findCropProfile,
  irrigationDepthRange,
  measuredDailyRanges,
  measuredTempRange,
  rootDepthM,
  type CropProfile,
  type FarmInputs,
  type RainDay,
  type TempSlot,
} from "../src/lib/afya/farm-engine";
import { assembleFarmInputs } from "../src/lib/afya/farm-inputs";
import { getCsvRange } from "../src/lib/afya/csv-source";
import { datesEnding, dayOfYear } from "../src/lib/afya/nairobi-time";
import { POST } from "../src/app/api/farm/route";

const maize = findCropProfile("maize") as CropProfile;
const kale = findCropProfile("kale") as CropProfile;

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

const TODAY = "2026-09-21";

function inputs(o: { et0: number; rain: Record<string, number | null>; forecast48h?: number | null }): FarmInputs {
  const days = datesEnding(TODAY, 30);
  return {
    today: TODAY,
    et0: { et0_mm_day: o.et0, tmax_c: 26, tmin_c: 13, source: "station", station_hours: 24, ra_mm_day: 15.25 },
    past_et0: Object.fromEntries(days.slice(0, -1).map((d) => [d, { et0_mm: o.et0, source: "station" as const }])),
    rain: { source: "station_gauge", days: days.map((date) => ({ date, mm: o.rain[date] ?? 0 })) },
    regional_et0_mm_day: 4.1,
    forecast_rain_48h_mm: o.forecast48h === undefined ? 0 : o.forecast48h,
    soil: null,
  };
}

test("a wet week needs no irrigation", () => {
  // 7 days of maize at 4.0 mm/day is 28 mm; 45 mm of rain gives 36 mm effective.
  const wb = computeWaterBalance(inputs({ et0: 5, rain: { "2026-09-16": 25, "2026-09-19": 20 } }), maize, "vegetative");
  assert.equal(wb.demand_7d_mm, 28);
  assert.equal(wb.effective_rain_7d_mm, 36);
  assert.equal(wb.net_irrigation_7d_mm, 0);
  const advice = computeIrrigationAdvice(wb);
  assert.equal(advice.action, "NO_IRRIGATION");
  assert.equal(advice.depth_range_mm, null);
  assert.deepEqual(advice.reason_keys, ["farm_reason_rain_meets_demand"]);
  assert.equal(advice.confidence, "HIGH");
});

test("a dry week gives the shortfall as the depth", () => {
  // 28 mm of demand against one 6 mm day (4.8 mm effective) and a 1.5 mm shower (none).
  const wb = computeWaterBalance(inputs({ et0: 5, rain: { "2026-09-18": 6, "2026-09-20": 1.5 } }), maize, "vegetative");
  assert.equal(wb.rain_7d_mm, 7.5);
  assert.equal(wb.effective_rain_7d_mm, 4.8);
  assert.equal(wb.net_irrigation_7d_mm, 23.2);
  const advice = computeIrrigationAdvice(wb);
  assert.equal(advice.action, "IRRIGATE_NOW");
  assert.deepEqual(advice.depth_range_mm, { low: 25, high: 25 });
  assert.equal(advice.depth_mm, 25);
  assert.equal(advice.litres_per_m2, 25);
});

test("rain in the forecast holds irrigation back", () => {
  const wb = computeWaterBalance(inputs({ et0: 5, rain: {}, forecast48h: 14 }), maize, "vegetative");
  assert.ok(wb.net_irrigation_7d_mm >= 5);
  const advice = computeIrrigationAdvice(wb);
  assert.equal(advice.action, "HOLD_RAIN_EXPECTED");
  assert.equal(advice.depth_range_mm, null);
  assert.ok(advice.reason_keys.includes("farm_reason_rain_expected"));
  assert.equal(advice.confidence, "MODERATE");
});

test("a shallow root zone caps the depth, as a range across the clay bounds", () => {
  // Kale seedlings, 0.2 m of roots, hold 24 to 40 mm; the dry week asks for 34.3 mm.
  const wb = computeWaterBalance(inputs({ et0: 7, rain: {} }), kale, "establishment");
  assert.deepEqual(wb.total_available_range_mm, { low: 24, high: 40 });
  assert.equal(wb.net_irrigation_7d_mm, 34.3);
  const advice = computeIrrigationAdvice(wb);
  assert.deepEqual(advice.depth_range_mm, { low: 25, high: 35 });
  assert.ok(advice.reason_keys.includes("farm_reason_root_zone_cap"));
  assert.deepEqual(irrigationDepthRange(12, { low: 24, high: 40 }), { low: 10, high: 10 });
});

test("without a forecast the advice says so and is less sure", () => {
  const wb = computeWaterBalance(inputs({ et0: 5, rain: {}, forecast48h: null }), maize, "vegetative");
  const advice = computeIrrigationAdvice(wb);
  assert.equal(advice.action, "IRRIGATE_NOW");
  assert.ok(advice.reason_keys.includes("farm_reason_forecast_unavailable"));
  assert.equal(advice.confidence, "MODERATE");
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
  const base = inputs({ et0: 5, rain: {} });
  const regionalRain: FarmInputs = { ...base, rain: { ...base.rain, source: "regional_model" } };
  const allRegional: FarmInputs = { ...regionalRain, et0: { ...base.et0, source: "regional_forecast" } };
  const confidence = (i: FarmInputs) => computeIrrigationAdvice(computeWaterBalance(i, maize, "vegetative")).confidence;
  assert.equal(confidence(base), "HIGH");
  assert.equal(confidence(regionalRain), "MODERATE");
  assert.equal(confidence(allRegional), "LOW");
});

test("the inputs fall back to the regional model and say so", () => {
  const now = Date.parse("2026-09-21T09:00:00Z");
  const days = datesEnding(TODAY, 32).concat(["2026-09-22", "2026-09-23"]);
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
  // Today so far: the twelve hours ending 01:00 to 12:00 EAT, the one ending 07:00 with 3 mm.
  assert.equal(farm.rain.days[farm.rain.days.length - 1].mm, 4.1);
  assert.equal(farm.forecast_rain_48h_mm, 4.8);
  // No station and no regional record: no advice at all.
  assert.equal(assembleFarmInputs(now, { station: null, stationRain: null, regional: null, soil: null }), null);
});

test("heat stress reads the day's peak air temperature, not WBGT", () => {
  const et0 = estimateEt0("2026-09-21", { tmax_c: 29, tmin_c: 15, measured_hours: 24 }, null)!;
  const stress = evaluateCropStress(et0, "flowering");
  assert.equal(stress.level, "MILD");
  assert.equal(stress.peak_temp_c, 29);
  assert.equal(stress.peak_source, "station");
  assert.equal(evaluateCropStress(et0, "vegetative").level, "NONE");
});

test("the planting outlook uses the same rain record, and a missing day ends a dry spell", () => {
  const dates = datesEnding(TODAY, 30);
  const days = dates.map((date, i) => ({ date, mm: i === 19 ? null : i < 10 ? 5 : 0 }));
  const outlook = evaluatePlantingOutlook({ source: "station_gauge", days }, TODAY, maize);
  assert.equal(outlook.rain_source, "station_gauge");
  assert.equal(outlook.rain_30d_mm, 50);
  assert.equal(outlook.rain_days_with_data, 29);
  assert.equal(outlook.dry_spell_days, 10);
  assert.equal(outlook.favourable, false);
  assert.equal(outlook.message_key, "farm_plant_dryspell");
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
