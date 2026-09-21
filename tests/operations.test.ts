import { test } from "node:test";
import assert from "node:assert/strict";
import { assessActivity } from "../src/lib/afya/operations";
import type { ForecastPoint } from "../src/lib/afya/types";

// 09:00 EAT on 1 September 2026, and a forecast that is hot from 12:00 to 15:00.
const NOW = Date.UTC(2026, 8, 1, 6, 0);

function forecast(): ForecastPoint[] {
  return Array.from({ length: 37 }, (_, i) => {
    const time = new Date(NOW + i * 900_000).toISOString();
    const localHour = 9 + i / 4;
    const value = localHour >= 12 && localHour <= 15 ? 26 : 18;
    return { time, value, lower: value - 1, upper: value + 1, horizon_minutes: i * 15 };
  });
}

test("an activity in the hot hours is flagged and pointed to a cooler window", () => {
  const a = assessActivity(
    { id: 1, name: "Pour", start_hour: 12, end_hour: 14, activity_type: "construction" },
    forecast(),
    NOW,
  );
  assert.equal(a.affected, true);
  assert.equal(a.peak_wbgt_c, 26);
  assert.match(a.text_en, /peaks at 18\.0°C/);
});

test("an activity in cool hours is not flagged", () => {
  const a = assessActivity(
    { id: 2, name: "Weeding", start_hour: 9, end_hour: 11, activity_type: "field_work" },
    forecast(),
    NOW,
  );
  assert.equal(a.affected, false);
  assert.equal(a.peak_wbgt_c, 18);
});

test("an activity past the end of the forecast says so instead of guessing", () => {
  const a = assessActivity(
    { id: 3, name: "Night shift", start_hour: 22, end_hour: 23, activity_type: "outdoor_work" },
    forecast(),
    NOW,
  );
  assert.equal(a.peak_wbgt_c, null);
  assert.match(a.text_en, /Beyond the 9-hour forecast/);
});
