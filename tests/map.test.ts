import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_DATA_COLOUR, THERMAL_STEPS, ndviColour, outlookColour, rainColour, thermalColour } from "../src/lib/afya/map-scales";
import {
  computeFloodRisk,
  countyProperties,
  FLOOD_THRESHOLDS,
  getRegionalOutlook,
  parseCountyWeather,
  regionalWeatherAsOf,
  STATION_RAIN_SOURCE,
  stationOutlookHours,
  stationOverrideFrom,
  type OpenMeteoLocation,
  type OutlookHour,
  type StationOverride,
} from "../src/lib/afya/map-data";
import type { SituationResult } from "../src/lib/afya/types";
import { getStrings, tf } from "../src/lib/afya/i18n";

const LANGS = ["en", "sw"] as const;

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
      soil_moisture_0_to_7cm: time.map(() => 0.31),
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
  return { countyName: "Kiambu", wbgt: 19, isRealData: true, measured, forecast, rainTodayMm: null };
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
  const override = stationOverrideFrom(situation, [], 41.5);
  assert.equal(override.isRealData, false);
  // The gauge total goes with the rest of the station's data when it is stale.
  assert.equal(override.rainTodayMm, null);
  const p = countyProperties({ name: "Kiambu", name_sw: "Kiambu" }, parseCountyWeather(countyForecast(), now), null, 17.5, override, now);
  assert.deepEqual(p.sources, ["Open-Meteo"]);
  assert.equal(p.confidence, "MODERATE");
  assert.equal(p.rain_today_mm, 6.4);
  assert.ok(p.outlook_hours.every((h) => h.temp_source !== "station_measured"));
});

test("a local rain gauge never replaces Kiambu county rainfall", () => {
  const now = Date.parse(eat("13:10"));
  const weather = () => parseCountyWeather(countyForecast(), now);
  const kiambu = { name: "Kiambu", name_sw: "Kiambu" };

  const measured = countyProperties(kiambu, weather(), null, 17.5, { ...station(now, []), rainTodayMm: 32.4 }, now);
  assert.equal(measured.rain_today_mm, 6.4);
  assert.deepEqual(measured.sources, ["Open-Meteo"]);
  assert.ok(!measured.sources.includes(STATION_RAIN_SOURCE));
  // The station's 32.4 mm cannot raise the county-wide regional category.
  assert.equal(measured.flood_risk, "ELEVATED");

  // Too little of the day at the gauge: the model's rain stands, unmarked.
  const modelled = countyProperties(kiambu, weather(), null, 17.5, station(now, []), now);
  assert.equal(modelled.rain_today_mm, 6.4);
  assert.deepEqual(modelled.sources, ["Open-Meteo"]);
  assert.equal(modelled.flood_risk, "ELEVATED");

  // The gauge stands in Kiambu only.
  const elsewhere = countyProperties({ name: "Nairobi", name_sw: "Nairobi" }, weather(), null, 17.5, { ...station(now, []), rainTodayMm: 32.4 }, now);
  assert.equal(elsewhere.rain_today_mm, 6.4);
  assert.deepEqual(elsewhere.sources, ["Open-Meteo"]);
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

test("flood-conducive conditions are left open when they turn on a missing value", () => {
  assert.equal(computeFloodRisk(null, 0.35), null);
  // Too little rain for the soil to matter.
  assert.equal(computeFloodRisk(2, null), "LOW");
  assert.equal(computeFloodRisk(8, null), null);
  assert.equal(computeFloodRisk(8, 0.3), "ELEVATED");
  assert.equal(computeFloodRisk(8, 0.2), "LOW");
  assert.equal(computeFloodRisk(20, null), "ELEVATED");
  assert.equal(computeFloodRisk(35, 0.3), "HIGH");
  assert.equal(computeFloodRisk(35, 0.2), "ELEVATED");
  assert.equal(computeFloodRisk(35, null), null);
});

// The page prints these numbers, so they have to be the ones the categories use.
test("the wet-soil bar sits at the 0-7 cm field-capacity middle, and the page is given it", () => {
  assert.deepEqual(FLOOD_THRESHOLDS, {
    high_rain_mm: 30,
    elevated_rain_mm: 15,
    wet_soil_rain_mm: 5,
    wet_soil_m3: 0.25,
  });
  const { high_rain_mm, elevated_rain_mm, wet_soil_rain_mm, wet_soil_m3 } = FLOOD_THRESHOLDS;
  assert.equal(computeFloodRisk(high_rain_mm, wet_soil_m3), "HIGH");
  assert.equal(computeFloodRisk(high_rain_mm, wet_soil_m3 - 0.01), "ELEVATED");
  assert.equal(computeFloodRisk(elevated_rain_mm, null), "ELEVATED");
  assert.equal(computeFloodRisk(wet_soil_rain_mm, wet_soil_m3), "ELEVATED");
  assert.equal(computeFloodRisk(wet_soil_rain_mm, wet_soil_m3 - 0.01), "LOW");
  assert.equal(computeFloodRisk(wet_soil_rain_mm - 0.1, null), "LOW");
});

// The page used to send the reader to the source for these numbers.
test("both languages carry the conditions copy, with the real thresholds filled in", () => {
  const { high_rain_mm, elevated_rain_mm, wet_soil_rain_mm, wet_soil_m3 } = FLOOD_THRESHOLDS;
  const soil = wet_soil_m3.toFixed(2);
  const values = { high: high_rain_mm, elevated: elevated_rain_mm, wet: wet_soil_rain_mm, soil };

  for (const lang of LANGS) {
    const strings = getStrings(lang);
    for (const key of [
      "flood_title", "flood_subtitle", "flood_levels_title", "flood_held_reading", "flood_mm_today_gauge",
      "flood_cond_high", "flood_cond_elevated", "flood_cond_low", "flood_high_count", "flood_elevated_count",
    ]) {
      assert.ok(strings[key], `${lang} is missing ${key}`);
    }
    // The chips describe conditions; they are not stamped with a hazard band.
    const chips = [strings.flood_cond_high, strings.flood_cond_elevated, strings.flood_cond_low].join(" ");
    assert.ok(!/HIGH|ELEVATED|LOW|JUU|ILIYOINUKA/.test(chips), `${lang}: ${chips}`);
    // The soil label follows the layer the check reads.
    assert.ok(strings.flood_soil_moisture.includes("7"), strings.flood_soil_moisture);

    for (const key of ["flood_level_high_rule", "flood_level_elevated_rule", "flood_level_low_rule"]) {
      const rule = tf(lang, key, values);
      assert.ok(!rule.includes("{"), `${lang} ${key} left a placeholder: ${rule}`);
    }
    const high = tf(lang, "flood_level_high_rule", values);
    assert.ok(high.includes(String(high_rain_mm)) && high.includes(soil), high);
    assert.ok(tf(lang, "flood_level_low_rule", values).includes(String(wet_soil_rain_mm)));
    assert.ok(tf(lang, "flood_held_reading", { time: "14:05 EAT" }).includes("14:05 EAT"));
  }
});

test("the map copy says what a county and this server actually hold", () => {
  for (const lang of LANGS) {
    const strings = getStrings(lang);
    for (const key of [
      "map_satellite_not_configured", "map_time_not_used", "map_soil_0_7",
      "regional_intelligence_sub", "regional_intelligence_sub_ndvi", "regional_intelligence_sub_none",
    ]) {
      assert.ok(strings[key], `${lang} is missing ${key}`);
    }
    // The GeoJSON's origin is unrecorded, so the footer names no dataset.
    assert.ok(!/official|rasmi/i.test(strings.map_boundaries_note), strings.map_boundaries_note);
    assert.ok(!strings.map_soil_0_1, `${lang} still carries the 0-1 cm label`);
    // The mode control did nothing but change fill opacity; it and its strings are gone.
    for (const key of ["environmental_surface", "county_summary", "view_as"]) {
      assert.ok(!strings[key], `${lang} still carries ${key}`);
    }
    for (const status of ["GOOD", "DEGRADED", "POOR"]) {
      assert.ok(strings[`quality_${status.toLowerCase()}`], `${lang} is missing quality_${status}`);
    }
  }
  // The map's quality badge reads these, so Kiswahili no longer shows "GOOD".
  assert.equal(getStrings("sw").quality_good, "NZURI");
});

test("the county request asks for the 0-7 cm soil layer, and the reading comes from it", async () => {
  const nowMs = Date.parse("2026-09-21T09:40:00+03:00");
  const hours = Array.from({ length: 24 }, (_, i) => `${TODAY}T${String(i).padStart(2, "0")}:00`);
  const realFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    if (!requested.includes("api.open-meteo.com")) return new Response("{}", { status: 200 });
    const count = new URL(String(input)).searchParams.get("latitude")!.split(",").length;
    const body = Array.from({ length: count }, () => ({
      current: { temperature_2m: 24, relative_humidity_2m: 55 },
      hourly: {
        time: hours,
        temperature_2m: hours.map(() => 24),
        relative_humidity_2m: hours.map(() => 55),
        soil_moisture_0_to_7cm: hours.map(() => 0.26),
      },
      daily: { time: [TODAY], precipitation_sum: [8] },
    }));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const out = await getRegionalOutlook(undefined, nowMs);
    assert.ok(requested.includes("soil_moisture_0_to_7cm"), requested);
    assert.ok(!requested.includes("soil_moisture_0_to_1cm"), requested);
    // The free tier refuses this eleven-county batch at two days.
    assert.ok(requested.includes("forecast_days=1"), requested);
    const county = out.features[0].properties;
    assert.ok(Math.abs(county.soil_moisture! - 0.26) < 1e-10);
    // 8 mm on soil just above the 0.25 m³/m³ bar.
    assert.equal(county.flood_risk, "ELEVATED");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// One request covers every county, so a refusal would empty the whole map.
test("when the county fetch is refused, the last read still fills the map", async () => {
  const nowMs = Date.parse("2026-09-21T12:10:00+03:00");
  const location = (temp: number) => ({
    current: { time: eat("12:00"), temperature_2m: temp, relative_humidity_2m: 55 },
    hourly: {
      time: ["09:00", "12:00", "15:00", "18:00"].map((h) => `${TODAY}T${h}`),
      temperature_2m: [temp - 3, temp, temp + 1, temp - 2],
      relative_humidity_2m: [70, 55, 50, 65],
      soil_moisture_0_to_7cm: [0.15, 0.15, 0.14, 0.14],
    },
    daily: { time: [TODAY], precipitation_sum: [1.2] },
  });
  const realFetch = globalThis.fetch;
  let refuse = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (!String(input).includes("api.open-meteo.com")) return new Response("{}", { status: 200 });
    if (refuse) return new Response("rate limited", { status: 429 });
    const count = new URL(String(input)).searchParams.get("latitude")!.split(",").length;
    const body = Array.from({ length: count }, (_, i) => location(24 + (i % 5)));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const first = await getRegionalOutlook(undefined, nowMs);
    const read = first.features.filter((f) => f.properties.outlook_hours.some((h) => h.temp_c !== null));
    assert.ok(read.length >= 2, `first read filled ${read.length} counties`);
    assert.equal(regionalWeatherAsOf(nowMs), null, "a fresh read is not stood in for");

    refuse = true;
    const later = nowMs + 10 * 60_000;
    const second = await getRegionalOutlook(undefined, later);
    const held = second.features.filter((f) => f.properties.outlook_hours.some((h) => h.temp_c !== null));
    assert.equal(held.length, read.length, "the refusal emptied the map");
    assert.equal(regionalWeatherAsOf(later), nowMs, "the page is not told when the values were read");
  } finally {
    globalThis.fetch = realFetch;
  }
});


test("even a fresh station cannot replace county-wide regional weather", () => {
  const now = Date.parse(eat("10:30"));
  const w = parseCountyWeather(countyForecast(), now);
  const withStation = countyProperties({ name: "Kiambu", name_sw: "Kiambu" }, w, null, 20, station(now, []), now);
  const withoutStation = countyProperties({ name: "Kiambu", name_sw: "Kiambu" }, w, null, 20, undefined, now);
  assert.deepEqual(withStation, withoutStation);
});
