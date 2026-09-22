import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/health/route";

test("without a database the app still reports itself up, and says the database is not configured", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const res = await GET();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, database: "not_configured" });
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});
