import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_DATA_COLOUR, THERMAL_STEPS, ndviColour, outlookColour, rainColour, thermalColour } from "../src/lib/afya/map-scales";
import {
  computeFloodRisk,
  countyProperties,
  parseCountyWeather,
  stationOutlookHours,
  stationOverrideFrom,
  type OpenMeteoLocation,
  type OutlookHour,
  type StationOverride,
} from "../src/lib/afya/map-data";
import type { SituationResult } from "../src/lib/afya/types";

const TODAY = "2026-09-21";
const eat = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00+03:00`).toISOString();

test("the Thermal layer colours air temperature in the legend's bins", () => {
  assert.deepEqual(
    THERMAL_STEPS.map((s) => s.label),
    ["< 14 °C", "14–18 °C", "18–22 °C", "22–26 °C", "26–30 °C", "≥ 30 °C"],
  );
  const colours = THERMAL_STEPS.map((s) => s.colour);
  assert.equal(thermalColour(13.9), colours[0]);
  assert.equal(thermalColour(14), colours[1]);
  assert.equal(thermalColour(21.9), colours[2]);
  assert.equal(thermalColour(22), colours[3]);
  assert.equal(thermalColour(29.9), colours[4]);
  assert.equal(thermalColour(30), colours[5]);
  assert.equal(thermalColour(41), colours[5]);
  assert.equal(new Set(colours).size, THERMAL_STEPS.length);
  assert.ok(!colours.includes(NO_DATA_COLOUR));
});

test("a missing value is grey on every layer, while zero is still a value", () => {
  assert.equal(thermalColour(null), NO_DATA_COLOUR);
  assert.equal(thermalColour(Number.NaN), NO_DATA_COLOUR);
  assert.equal(rainColour(null), NO_DATA_COLOUR);
  assert.equal(ndviColour(null), NO_DATA_COLOUR);
  assert.equal(outlookColour(null), NO_DATA_COLOUR);
  assert.notEqual(rainColour(0), NO_DATA_COLOUR);
  assert.notEqual(ndviColour(0), NO_DATA_COLOUR);
});

// Two days of hourly Open-Meteo output in Nairobi time, warming half a degree an
// hour from 12 °C at midnight; 15:00 today is missing.
function countyForecast(): OpenMeteoLocation {
  const time = Array.from({ length: 48 }, (_, i) => `${i < 24 ? TODAY : "2026-09-22"}T${String(i % 24).padStart(2, "0")}:00`);
  return {
    current: { temperature_2m: 17.5, relative_humidity_2m: 70 },
    hourly: {
      time,
      temperature_2m: time.map((_, i) => (i === 15 ? null : 12 + (i % 24) / 2)),
      relative_humidity_2m: time.map(() => 60),
      soil_moisture_0_to_1cm: time.map(() => 0.31),
    },
    daily: { time: [TODAY, "2026-09-22"], precipitation_sum: [6.4, 0] },
  };
}

test("each outlook hour keeps its temperature and WBGT, and a gap stays empty", () => {
  const w = parseCountyWeather(countyForecast(), Date.parse(eat("10:30")));
  assert.ok(w);
  assert.equal(w.rainTodayMm, 6.4);
  assert.equal(w.soilMoisture, 0.31);
  const nine = w.hours[0];
  assert.equal(nine.hour, "09:00");
  assert.equal(nine.temp_c, 16.5);
  assert.equal(nine.temp_source, "regional_forecast");
  assert.ok(nine.wbgt_c != null && nine.wbgt_c < nine.temp_c!);
  assert.equal(nine.category, "LOW");
  assert.deepEqual(w.hours[2], {
    hour: "15:00", category: null, wbgt_c: null, wbgt_source: null, temp_c: null, temp_source: null,
  });
  // 17.5 °C now against 18.5 °C at 13:00.
  assert.equal(w.trend, "rising");
  assert.equal(parseCountyWeather({}, Date.now()), null);
});

function regional(tempC: number): OutlookHour[] {
  return ["09:00", "12:00", "15:00", "18:00"].map((hour) => ({
    hour, category: "LOW", wbgt_c: 16, wbgt_source: "regional_forecast", temp_c: tempC, temp_source: "regional_forecast",
  }));
}

function station(nowMs: number, measured: StationOverride["measured"]): StationOverride {
  // The station forecast every 15 minutes for nine hours.
  const forecast = Array.from({ length: 36 }, (_, i) => ({
    time: new Date(nowMs + (i + 1) * 15 * 60_000).toISOString(),
    value: 21.6,
  }));
  return { countyName: "Kiambu", wbgt: 19, isRealData: true, measured, forecast };
}

test("Kiambu takes the station's measurement for hours already past today", () => {
  const now = Date.parse(eat("13:10"));
  const hours = stationOutlookHours(now, station(now, [
    { ts: eat("09:00"), temp_sht: 19.4, wet_bulb_globe_temp: 16.2 },
    { ts: eat("12:00"), temp_sht: 24.8, wet_bulb_globe_temp: 19.3 },
  ]), regional(22));

  assert.deepEqual(hours[0], {
    hour: "09:00", category: "LOW", wbgt_c: 16.2, wbgt_source: "station_measured", temp_c: 19.4, temp_source: "station_measured",
  });
  assert.equal(hours[1].temp_c, 24.8);
  assert.equal(hours[1].category, "ELEVATED");
  // Ahead: the station's WBGT forecast colours the outlook; air temperature stays regional.
  for (const h of hours.slice(2)) {
    assert.equal(h.wbgt_source, "station_forecast");
    assert.equal(h.category, "HIGH");
    assert.equal(h.temp_c, 22);
    assert.equal(h.temp_source, "regional_forecast");
  }
});

test("a filled-in station slot is not passed off as a measurement", () => {
  const now = Date.parse(eat("13:10"));
  const hours = stationOutlookHours(now, station(now, [
    { ts: eat("09:00"), temp_sht: 19.4, wet_bulb_globe_temp: 16.2, imputed: ["temp_sht"] },
    { ts: eat("12:00"), temp_sht: 24.8, wet_bulb_globe_temp: 19.3, imputed: ["humidity_sht"] },
  ]), regional(22));
  assert.equal(hours[0].temp_source, "regional_forecast");
  assert.equal(hours[0].temp_c, 22);
  // Temperature measured, humidity not: the WBGT stays regional.
  assert.equal(hours[1].temp_source, "station_measured");
  assert.equal(hours[1].wbgt_source, "regional_forecast");
});

test("a stale station is not shown as Kiambu's current state", () => {
  const now = Date.parse(eat("10:30"));
  const situation = {
    data_source: "CONDUIT_ARCHIVE",
    quality: { freshness_minutes: 20_000 },
    current: { wbgt_c: 23 },
    forecast_series: [],
  } as unknown as SituationResult;
  const override = stationOverrideFrom(situation, []);
  assert.equal(override.isRealData, false);
  const p = countyProperties({ name: "Kiambu", name_sw: "Kiambu" }, parseCountyWeather(countyForecast(), now), null, 17.5, override, now);
  assert.deepEqual(p.sources, ["Open-Meteo"]);
  assert.equal(p.confidence, "MODERATE");
  assert.ok(p.outlook_hours.every((h) => h.temp_source !== "station_measured"));
});

test("a county Open-Meteo did not answer for is unavailable, never LOW", () => {
  const p = countyProperties({ name: "Machakos", name_sw: "Machakos" }, null, null, 21, undefined, Date.now());
  assert.equal(p.weather_available, false);
  assert.equal(p.outlook_category, null);
  assert.equal(p.flood_risk, null);
  assert.equal(p.rain_today_mm, null);
  assert.equal(p.soil_moisture, null);
  assert.equal(p.temperature_anomaly_c, null);
  assert.ok(p.outlook_hours.every((h) => h.category === null && h.temp_c === null));
  assert.deepEqual(p.sources, []);
});

test("flood risk is left open when it turns on a missing value", () => {
  assert.equal(computeFloodRisk(null, 0.35), null);
  // Too little rain for the soil to matter.
  assert.equal(computeFloodRisk(2, null), "LOW");
  assert.equal(computeFloodRisk(8, null), null);
  assert.equal(computeFloodRisk(8, 0.3), "ELEVATED");
  assert.equal(computeFloodRisk(8, 0.2), "LOW");
  assert.equal(computeFloodRisk(20, null), "ELEVATED");
  assert.equal(computeFloodRisk(35, 0.28), "HIGH");
  assert.equal(computeFloodRisk(35, 0.27), "ELEVATED");
  assert.equal(computeFloodRisk(35, null), null);
});
