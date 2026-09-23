import { test } from "node:test";
import assert from "node:assert/strict";
import { flagText, modelName, t } from "../src/lib/afya/i18n";
import { evaluateQuality } from "../src/lib/afya/data-quality";
import { FORECAST_MODEL_NAME } from "../src/lib/afya/forecast-engine";
import type { DemoObservation } from "../src/lib/afya/demo-observations";
import type { Lang } from "../src/lib/afya/types";

const LANGS: Lang[] = ["en", "sw"];

// Every flag the quality checks and the pipeline can raise.
const FLAGS = [
  "no_observations",
  "stale_data",
  "observation_age_elevated",
  "missing_fields:temp_sht,wind_spd",
  "gaps_filled_recently:9",
  "temp_sensor_disagreement",
  "humidity_out_of_range",
  "temp_out_of_range",
  "firmware_wbgt_below_wet_bulb",
  "duplicate_timestamps_removed:3",
  "station_health_bad:wind",
  "forecast_horizon_elapsed",
  "forecast_fell_back_to_no_change",
  "regional_context_unavailable",
];

test("every quality flag reads as a sentence in both languages, with its value filled in", () => {
  for (const lang of LANGS) {
    for (const flag of FLAGS) {
      const text = flagText(lang, flag);
      assert.ok(text, `${lang}: ${flag} has no wording`);
      assert.ok(!text.includes("{"), `${lang}: ${flag} left a placeholder`);
      assert.ok(!text.includes(flag.split(":")[0]), `${lang}: ${flag} shows its own key`);
    }
  }
  assert.equal(flagText("en", "missing_fields:wind_spd"), t("en", "flag_missing_fields").replace("{value}", "wind_spd"));
  assert.equal(flagText("sw", "duplicate_timestamps_removed:3")?.includes("3"), true);
});

test("a flag with no wording is left out rather than shown as a key", () => {
  assert.equal(flagText("en", "some_future_check"), null);
  assert.equal(flagText("sw", "some_future_check:4"), null);
});

test("the firmware fault the station reports reaches the reader in words", () => {
  const end = Date.UTC(2026, 8, 22, 9, 0);
  const series: DemoObservation[] = Array.from({ length: 24 }, (_, i) => ({
    ts: new Date(end - (23 - i) * 900_000).toISOString(),
    rg1: 0, rg2: 0, rg1tt: 0, rg2tt: 0,
    temp_bmx: 24, press_bmx: 850, temp_mcp: 24, temp_sht: 24, humidity_sht: 50,
    si1145_vis: 600, si1145_ir: 3000, si1145_uv: 0,
    wind_spd: 1, wind_dir: 90, wind_gust: 2, heat_idx: 24,
    // The live fault: the station's own WBGT below its own wet bulb.
    wet_bulb_temp: 17, wet_bulb_globe_temp: 19.1, firmware_wbgt: 16, imputed: [],
  }));
  const quality = evaluateQuality(series, new Date(end).toISOString());
  assert.equal(quality.status, "GOOD");
  assert.ok(quality.flags.includes("firmware_wbgt_below_wet_bulb"));
  for (const lang of LANGS) {
    const text = flagText(lang, "firmware_wbgt_below_wet_bulb")!;
    assert.ok(text.includes("WBGT"));
    assert.ok(text.length > 40);
  }
});

test("the forecast model is named in the reader's language, and an unknown one as it is", () => {
  assert.equal(modelName("en", FORECAST_MODEL_NAME), "Seasonal anomaly");
  assert.equal(modelName("sw", FORECAST_MODEL_NAME), "Tofauti ya msimu");
  assert.equal(modelName("sw", "No change"), "Hakuna mabadiliko");
  assert.equal(modelName("sw", "Gradient boosting"), "Gradient boosting");
});
