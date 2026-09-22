import { test } from "node:test";
import assert from "node:assert/strict";
import { parseActivityKey, readPreferredActivity, situationUrl } from "../src/lib/preferred-activity";

test("only known activity profiles are accepted as the default activity", () => {
  assert.equal(parseActivityKey("sports"), "sports");
  assert.equal(parseActivityKey("field_work"), "field_work");
  assert.equal(parseActivityKey("sports; drop"), null);
  assert.equal(parseActivityKey(""), null);
  assert.equal(parseActivityKey(undefined), null);
});

test("the default activity shares the plain situation address; others ask for their own window", () => {
  assert.equal(situationUrl(null), "/api/situation");
  assert.equal(situationUrl("general"), "/api/situation");
  assert.equal(situationUrl("construction"), "/api/situation?activity=construction");
});

test("reading the saved activity outside a browser gives none instead of failing", () => {
  assert.equal(readPreferredActivity(), null);
});
