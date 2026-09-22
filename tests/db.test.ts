import { test } from "node:test";
import assert from "node:assert/strict";
import { db, getDb, hasDatabase, DatabaseUnavailableError } from "../src/db";
import { users } from "../src/db/schema";

// Runs with no database configured, as in CI.
delete process.env.DATABASE_URL;

test("the database module loads without DATABASE_URL and fails only when used", async () => {
  assert.equal(hasDatabase(), false);
  assert.throws(() => getDb(), DatabaseUnavailableError);
  await assert.rejects(async () => {
    await db.select().from(users).limit(1);
  }, DatabaseUnavailableError);
  // Best-effort writes that attach their own catch still settle quietly.
  const settled = await db.insert(users).values({ name: "x", email: "x@y.z" }).catch(() => "handled");
  assert.equal(settled, "handled");
});

test("with DATABASE_URL set, the client is created on first use without connecting", () => {
  process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/none";
  try {
    assert.equal(hasDatabase(), true);
    const client = getDb();
    assert.equal(getDb(), client);
    assert.equal(typeof db.select, "function");
  } finally {
    delete process.env.DATABASE_URL;
  }
});
