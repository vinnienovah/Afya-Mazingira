import { test } from "node:test";
import assert from "node:assert/strict";
import { assessActivity } from "../src/lib/afya/operations";
import type { ForecastPoint } from "../src/lib/afya/types";

// 09:00 EAT on 1 September 2026, and a forecast that is hot from 12:00 to 15:00.
const NOW = Date.UTC(2026, 8, 1, 6, 0);
const HOUR = 3600_000;

function forecast(from = NOW, hot = (localHour: number) => localHour >= 12 && localHour <= 15): ForecastPoint[] {
  return Array.from({ length: 37 }, (_, i) => {
    const time = new Date(from + i * 900_000).toISOString();
    const localHour = new Date(from + i * 900_000 + 3 * HOUR).getUTCHours() + ((i * 15) % 60) / 60;
    const value = hot(localHour) ? 26 : 18;
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
  assert.equal(a.judged?.partial, false);
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

test("an activity already under way is judged on what is left of it today, not tomorrow", () => {
  const now = NOW + 6.5 * HOUR; // 15:30
  const a = assessActivity(
    { id: 4, name: "Training", start_hour: 14, end_hour: 16, activity_type: "sports" },
    forecast(now),
    now,
  );
  assert.notEqual(a.peak_wbgt_c, null);
  assert.equal(a.judged?.from, new Date(now).toISOString());
  assert.equal(a.judged?.to, new Date(NOW + 7 * HOUR).toISOString());
});

test("a window the forecast only partly reaches is judged only up to where it ends", () => {
  const a = assessActivity(
    { id: 5, name: "Evening event", start_hour: 16, end_hour: 20, activity_type: "outdoor_event" },
    forecast(),
    NOW,
  );
  assert.equal(a.judged?.partial, true);
  assert.equal(a.judged?.to, new Date(NOW + 9 * HOUR + 15 * 60_000).toISOString()); // 18:15
  assert.match(a.text_en, /from 16:00 to 18:15, where the forecast ends/);
});

test("the cooler window offered is in daylight, on the quarter hour and fully forecast", () => {
  // Hot all afternoon, cool only after dark: the night is not offered.
  const now = NOW + 4 * HOUR; // 13:00
  const series = forecast(now, (h) => h < 19);
  const a = assessActivity(
    { id: 6, name: "Pour", start_hour: 13, end_hour: 15, activity_type: "construction" },
    series,
    now,
  );
  assert.equal(a.affected, true);
  assert.match(a.text_en, /no cooler daylight window/);
  // With a cool morning the offer is the first cool hour, on the quarter hour.
  const morning = forecast(NOW, (h) => h >= 11.5);
  const b = assessActivity(
    { id: 7, name: "Pour", start_hour: 13, end_hour: 14, activity_type: "construction" },
    morning,
    NOW,
  );
  const [, from, to] = b.text_en.match(/(\d\d:\d\d)–(\d\d:\d\d) peaks at/) ?? [];
  assert.equal(from, "09:00");
  assert.equal(to, "10:00");
});
