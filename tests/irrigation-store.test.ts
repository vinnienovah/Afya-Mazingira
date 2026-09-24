import { test } from "node:test";
import assert from "node:assert/strict";
import { readLog, readServerLog, subscribe, writeLog } from "../src/lib/afya/irrigation-store";

const KEY = "afya.irrigation.v1";

// The store reads the browser's own localStorage. Node has none, so each test
// installs one; a store that throws stands in for a full or blocked one.
function installStorage(text: string | null, opts: { blocked?: boolean } = {}) {
  const held = new Map<string, string>();
  if (text !== null) held.set(KEY, text);
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => {
        if (opts.blocked) throw new Error("blocked");
        return held.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (opts.blocked) throw new Error("blocked");
        held.set(k, v);
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return held;
}

test("an empty device has an empty log", () => {
  installStorage(null);
  assert.deepEqual(readLog(), []);
});

test("what is written comes back", () => {
  const held = installStorage(null);
  writeLog([{ date: "2026-09-20", mm: 25 }]);
  assert.equal(held.get(KEY), '[{"date":"2026-09-20","mm":25}]');
  assert.deepEqual(readLog(), [{ date: "2026-09-20", mm: 25 }]);
});

test("the same stored text gives back the same array, so a render cannot loop", () => {
  installStorage('[{"date":"2026-09-18","mm":12}]');
  assert.equal(readLog(), readLog(), "useSyncExternalStore compares snapshots by identity");
});

test("rubbish in the store is not rubbish out", () => {
  for (const text of ["not json", '{"date":"2026-09-17"}', '["a string"]', '[{"date":5,"mm":"x"}]']) {
    installStorage(text);
    assert.deepEqual(readLog(), [], `stored text: ${text}`);
  }
});

test("a blocked store costs the record, not the advice", () => {
  installStorage(null, { blocked: true });
  assert.deepEqual(readLog(), []);
  assert.doesNotThrow(() => writeLog([{ date: "2026-09-16", mm: 25 }]));
});

test("a write tells whoever is listening", () => {
  installStorage(null);
  let told = 0;
  const stop = subscribe(() => told++);
  writeLog([{ date: "2026-09-15", mm: 25 }]);
  assert.equal(told, 1);
  stop();
  writeLog([{ date: "2026-09-14", mm: 10 }]);
  assert.equal(told, 1, "a listener that has stopped is not told");
});

test("the server has no device log", () => {
  installStorage('[{"date":"2026-09-13","mm":25}]');
  assert.deepEqual(readServerLog(), []);
});
