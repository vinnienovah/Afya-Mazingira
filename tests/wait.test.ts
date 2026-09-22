import { test } from "node:test";
import assert from "node:assert/strict";
import { within } from "../src/lib/afya/wait";

const after = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

test("a quick answer comes back as it is, null included", async () => {
  assert.equal(await within(after(5, "done"), 200), "done");
  assert.equal(await within(after(5, null), 200), null);
});

test("a slow answer gives undefined on time, and the work still finishes", async () => {
  let finished = false;
  const slow = after(80, "late").then((v) => {
    finished = true;
    return v;
  });
  const started = Date.now();
  assert.equal(await within(slow, 20), undefined);
  assert.ok(Date.now() - started < 70);
  assert.equal(await slow, "late");
  assert.ok(finished);
});
