import { test } from "node:test";
import assert from "node:assert/strict";
import reference from "./fixtures/liljegren-reference.json";
import { getCsvCoverage, getCsvRows } from "../src/lib/afya/csv-source";
import { a04Audit, stationHours, A04_STATION } from "../src/lib/afya/wbgt-audit";

const coverage = getCsvCoverage()!;
const rows = getCsvRows(Date.parse(coverage.minIso), Date.parse(coverage.maxIso));
const report = a04Audit(rows);

test("A04 covers every hour the committed archive holds readings for", () => {
  assert.equal(report.hours, reference.totals.hours);
  assert.equal(report.samples, reference.totals.samples);
  assert.equal(report.samples, rows.length);
  assert.equal(report.firstHourUtc, "2025-06-01T00:00:00.000Z");
  assert.equal(report.lastHourUtc, "2026-09-08T23:00:00.000Z");
  assert.equal(report.byHourOfDay.length, 24);
});

test("the audit table matches the Python, hour of day by hour of day", () => {
  assert.equal(report.byHourOfDay.length, reference.a04_by_hour_eat.length);
  for (const [i, hour] of report.byHourOfDay.entries()) {
    const python = reference.a04_by_hour_eat[i];
    assert.deepEqual(
      hour,
      {
        hourEat: python.hour_eat,
        hours: python.hours,
        samples: python.samples,
        firmwareMeanC: python.firmware_mean_c,
        modelMeanC: python.model_mean_c,
        meanSignedC: python.mean_signed_c,
        meanAbsC: python.mean_abs_c,
        minSignedC: python.min_signed_c,
        maxSignedC: python.max_signed_c,
      },
      `hour ${python.hour_eat}`,
    );
  }
  assert.equal(report.meanSignedC, reference.totals.mean_signed_c);
  assert.equal(report.meanAbsC, reference.totals.mean_abs_c);
});

/** Firmware minus estimate over the given EAT hours, weighted by hours of data. */
function meanDifference(hours: number[]): number {
  const rows = report.byHourOfDay.filter((hour) => hours.includes(hour.hourEat));
  const weight = rows.reduce((total, hour) => total + hour.hours, 0);
  return rows.reduce((total, hour) => total + hour.meanSignedC * hour.hours, 0) / weight;
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => from + i);

test("the firmware reads below the estimate at every hour, and furthest in the sun", () => {
  for (const hour of report.byHourOfDay) {
    assert.ok(hour.meanSignedC < 0, `hour ${hour.hourEat} is ${hour.meanSignedC}`);
    assert.ok(hour.meanAbsC >= Math.abs(hour.meanSignedC));
  }
  // the same two checks the Python project makes on its own run of this audit
  assert.ok(meanDifference(range(10, 16)) < -4, `${meanDifference(range(10, 16))}`);
  assert.ok(meanDifference(range(8, 12)) < -6, `${meanDifference(range(8, 12))}`);

  // mid-morning is the worst of it, the hours after sunset the least
  const worst = report.byHourOfDay.reduce((a, b) => (a.meanSignedC < b.meanSignedC ? a : b));
  const closest = report.byHourOfDay.reduce((a, b) => (a.meanSignedC > b.meanSignedC ? a : b));
  assert.ok(worst.hourEat >= 8 && worst.hourEat <= 12, `worst at ${worst.hourEat}`);
  assert.ok(closest.hourEat >= 17 && closest.hourEat <= 20, `closest at ${closest.hourEat}`);
  assert.ok(worst.meanSignedC < closest.meanSignedC - 5);
  // the daily mean gap is several degrees, far beyond anything the irradiance
  // estimate's own spread could account for at night, when it contributes nothing
  assert.ok(report.meanSignedC < -3);
  assert.ok(meanDifference(range(0, 6)) < -1.5);
});

test("every hour of day carries its own count", () => {
  const hours = report.byHourOfDay.reduce((total, hour) => total + hour.hours, 0);
  const samples = report.byHourOfDay.reduce((total, hour) => total + hour.samples, 0);
  assert.equal(hours, report.hours);
  assert.equal(samples, report.samples);
  for (const hour of report.byHourOfDay) {
    assert.ok(hour.hours > 400, `hour ${hour.hourEat} has ${hour.hours}`);
    assert.ok(hour.samples >= hour.hours);
  }
});

test("the report never states a difference without the estimate's uncertainty", () => {
  assert.equal(report.uncertainty.irradiance_r2, 0.674);
  assert.equal(report.uncertainty.irradiance_rmse_wm2, 154.9);
  assert.equal(report.uncertainty.fit_hours, 110);
  assert.equal(report.uncertainty.fit_days, 10);
  assert.match(report.uncertainty.note, /estimated .*not measured/);
  assert.match(report.uncertainty.note, /0\.674/);
  assert.match(report.verdict, /calibrated, not measured/);
});

test("the audit is pure: the same rows give the same report", () => {
  const again = a04Audit(rows.map((row) => ({ ...row })));
  assert.deepEqual(again, report);
});

test("an hour is audited only when every input it needs has a reading", () => {
  const hourly = stationHours(
    [
      { ts: "2026-09-01T09:00:00+00:00", temp_sht: "24", humidity_sht: "50", press_bmx: "852", wind_spd: "1", si1145_ir: "4000", wet_bulb_globe_temp: "18" },
      { ts: "2026-09-01T09:30:00+00:00", temp_sht: "26", humidity_sht: "46", press_bmx: "852", wind_spd: "2", si1145_ir: "5000", wet_bulb_globe_temp: "19" },
      // the pressure never reports, so this hour has no model run
      { ts: "2026-09-01T10:00:00+00:00", temp_sht: "27", humidity_sht: "44", press_bmx: "", wind_spd: "2", si1145_ir: "5200", wet_bulb_globe_temp: "20" },
      { ts: "not a time", temp_sht: "27", humidity_sht: "44", press_bmx: "852", wind_spd: "2", si1145_ir: "5200", wet_bulb_globe_temp: "20" },
    ],
    A04_STATION,
  );

  assert.equal(hourly.length, 1);
  const hour = hourly[0];
  assert.equal(hour.samples, 2);
  assert.equal(hour.airTempC, 25);
  assert.equal(hour.irCounts, 4500);
  assert.equal(hour.firmwareWbgtC, 18.5);
  // the estimate is the model's, not the station's: it has to be its own field
  assert.ok(hour.ghiWm2 > 0);
  assert.ok(Number.isFinite(hour.wbgtC));
});
