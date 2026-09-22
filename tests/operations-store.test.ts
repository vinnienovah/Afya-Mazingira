import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addActivity, EXAMPLE_ACTIVITIES, parseActivities, removeActivity, serialiseActivities, setActivityStatus,
} from "../src/lib/afya/operations-store";

test("activities saved in the browser come back as they were", () => {
  const list = addActivity(EXAMPLE_ACTIVITIES, { name: "Concrete pour", start_hour: 6, end_hour: 9, activity_type: "construction" });
  assert.deepEqual(parseActivities(serialiseActivities(list)), list);
});

test("nothing stored, or anything unreadable, falls back to the examples", () => {
  assert.equal(parseActivities(null), null);
  assert.equal(parseActivities("not json"), null);
  assert.equal(parseActivities(JSON.stringify([{ id: 1 }])), null);
  assert.equal(parseActivities(JSON.stringify({ version: 99, activities: [] })), null);
});

test("an empty saved list stays empty rather than bringing the examples back", () => {
  assert.deepEqual(parseActivities(serialiseActivities([])), []);
});

test("entries that do not parse are left out and the rest are kept", () => {
  const raw = JSON.stringify({
    version: 1,
    activities: [
      { id: 7, name: "Weeding", start_hour: 7, end_hour: 9, activity_type: "field_work", status: "active" },
      { id: 8, name: "", start_hour: 7, end_hour: 9, activity_type: "general", status: "active" },
      { id: 9, name: "Night shift", start_hour: 30, end_hour: 9, activity_type: "general", status: "active" },
      { id: 10, name: "Pour", start_hour: 7, end_hour: 9, activity_type: "construction", status: "deleted" },
    ],
  });
  assert.deepEqual(parseActivities(raw)?.map((a) => a.id), [7]);
});

test("archiving sets an activity aside and restoring brings it back unchanged", () => {
  const archived = setActivityStatus(EXAMPLE_ACTIVITIES, 2, "archived");
  assert.equal(archived.length, EXAMPLE_ACTIVITIES.length);
  assert.equal(archived.find((a) => a.id === 2)?.status, "archived");
  assert.deepEqual(setActivityStatus(archived, 2, "active"), EXAMPLE_ACTIVITIES);
});

test("deleting removes only that activity", () => {
  assert.deepEqual(removeActivity(EXAMPLE_ACTIVITIES, 3).map((a) => a.id), [1, 2, 4]);
});

test("new activities get an unused id and start active", () => {
  const list = addActivity(removeActivity(EXAMPLE_ACTIVITIES, 4), { name: "Pour", start_hour: 6, end_hour: 8, activity_type: "construction" });
  const added = list.at(-1)!;
  assert.equal(added.id, 4);
  assert.equal(added.status, "active");
  assert.equal(new Set(list.map((a) => a.id)).size, list.length);
});

test("the starter activities are marked as examples", () => {
  assert.equal(EXAMPLE_ACTIVITIES.length, 4);
  assert.ok(EXAMPLE_ACTIVITIES.every((a) => a.example && a.name_key));
});
