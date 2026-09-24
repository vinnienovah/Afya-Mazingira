import { test } from "node:test";
import assert from "node:assert/strict";
import type { Geometry } from "geojson";
import { containsPoint, countySamples, summarizeSamples } from "../src/lib/afya/spatial-sampling";
import { aggregateCountyWeather, parseCountyWeather } from "../src/lib/afya/map-data";

const geometry: Geometry = { type: "MultiPolygon", coordinates: [
  [[[0,0],[2,0],[2,2],[0,2],[0,0]], [[0.5,0.5],[1.5,0.5],[1.5,1.5],[0.5,1.5],[0.5,0.5]]],
  [[[3,0],[4,0],[4,1],[3,1],[3,0]]],
] };
test("sampling respects holes and includes separate polygon parts", () => {
  const samples = countySamples(geometry);
  assert.ok(samples.length > 2);
  assert.ok(samples.every((p) => containsPoint(geometry, p.lng, p.lat)));
  assert.ok(samples.some((p) => p.lng > 3));
  assert.ok(samples.some((p) => p.lng < 2));
  assert.equal(containsPoint(geometry, 1, 1), false);
});
test("sampled area shares use weights and missing coverage suppresses results", () => {
  const samples = Array.from({ length: 5 }, (_, i) => ({ lat: i, lng: 0, weight: 1 }));
  const good = summarizeSamples(samples, [18,20,22,24,null]);
  assert.equal(good.mean, 21);
  assert.equal(good.min, 18);
  assert.equal(good.max, 24);
  assert.equal(good.above_pct, 50);
  assert.equal(good.coverage_pct, 80);
  const bad = summarizeSamples(samples, [18,20,22,null,null]);
  assert.equal(bad.mean, null);
  assert.equal(bad.above_pct, null);
  assert.equal(bad.coverage_pct, 60);
});
test("county aggregation averages WBGT calculated at each point and preserves missing hours", () => {
  const samples = [{lat:0,lng:0,weight:1},{lat:0,lng:1,weight:1}];
  const values = [20,30].map((temp) => parseCountyWeather({current:{temperature_2m:temp,relative_humidity_2m:60}}, Date.now()));
  const result = aggregateCountyWeather(samples, values);
  assert.equal(result?.tempC, 25);
  assert.equal(result?.spatial?.valid_samples, 2);
  assert.ok(result?.hours.every((h) => h.category === null && h.spatial?.wbgt.coverage_pct === 0));
  assert.equal(aggregateCountyWeather(samples, [values[0],null]), null);
});
