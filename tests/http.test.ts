import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { NextRequest } from "next/server";
import { readJsonBody, databaseUnavailable } from "../src/lib/http";

// Runs with no database configured, as in CI.
delete process.env.DATABASE_URL;

const Schema = z.object({ name: z.string().min(1), enabled: z.boolean().default(true) });

function post(body: string) {
  return new NextRequest("https://afya.example/api/test", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

test("a body that is not JSON is a 400, not a 500", async () => {
  const result = await readJsonBody(post("{name: oops"), Schema);
  assert.ok("response" in result);
  assert.equal(result.response.status, 400);
  assert.deepEqual(await result.response.json(), { error: "invalid_json" });

  const empty = await readJsonBody(post(""), Schema);
  assert.ok("response" in empty && empty.response.status === 400);
});

test("JSON that does not fit the schema is a 400 with invalid_input", async () => {
  const result = await readJsonBody(post(JSON.stringify({ name: "" })), Schema);
  assert.ok("response" in result);
  assert.equal(result.response.status, 400);
  assert.deepEqual(await result.response.json(), { error: "invalid_input" });
});

test("a valid body comes back parsed, with defaults applied", async () => {
  const result = await readJsonBody(post(JSON.stringify({ name: "Midday heat" })), Schema);
  assert.ok("data" in result);
  assert.deepEqual(result.data, { name: "Midday heat", enabled: true });
});

test("routes that need the database answer 503 with a reason", async () => {
  const response = databaseUnavailable();
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /DATABASE_URL is not set/);

  const notifications = await import("../src/app/api/notifications/route");
  const list = await notifications.GET();
  assert.equal(list.status, 503);
  assert.equal((await list.json()).error, "database_unavailable");

  const preferences = await import("../src/app/api/preferences/route");
  assert.equal((await preferences.PATCH(post("{bad"))).status, 503);
});

test("a route that does not need the database still works without one", async () => {
  const me = await import("../src/app/api/auth/me/route");
  const response = await me.GET();
  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
});
