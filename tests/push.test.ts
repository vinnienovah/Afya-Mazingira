import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { deliverPush, sendPushToUser, vapidDetails, hasPushConfigured, type PushSender } from "../src/lib/push";
import type { PushSubscription } from "../src/db/schema";

const env = process.env as Record<string, string | undefined>;

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, env[k]]));
  Object.assign(env, values);
  for (const [k, v] of Object.entries(values)) if (v === undefined) delete env[k];
  return Promise.resolve(run()).finally(() => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });
}

test("without VAPID keys nothing is sent and no error is raised", async () => {
  await withEnv({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, DATABASE_URL: undefined }, async () => {
    assert.equal(hasPushConfigured(), false);
    assert.equal(await sendPushToUser(1, { title: "AFYA MAZINGIRA", body: "Heat risk is HIGH from 13:00." }), 0);
  });
  // A public key alone cannot send either.
  await withEnv({ VAPID_PUBLIC_KEY: "BPublicKey", VAPID_PRIVATE_KEY: undefined }, () => {
    assert.equal(vapidDetails(), null);
  });
});

test("with VAPID keys but no database, nothing is sent", async () => {
  await withEnv({ VAPID_PUBLIC_KEY: "BPublicKey", VAPID_PRIVATE_KEY: "private", DATABASE_URL: undefined }, async () => {
    assert.equal(await sendPushToUser(1, { title: "t", body: "b" }), 0);
  });
});

test("the VAPID contact is always a mailto: or https: address", async () => {
  const keys = { VAPID_PUBLIC_KEY: "BPublicKey", VAPID_PRIVATE_KEY: "private" };
  await withEnv({ ...keys, VAPID_EMAIL: "alerts@afya.example" }, () => {
    assert.equal(vapidDetails()?.subject, "mailto:alerts@afya.example");
  });
  await withEnv({ ...keys, VAPID_EMAIL: "https://afya.example/contact" }, () => {
    assert.equal(vapidDetails()?.subject, "https://afya.example/contact");
  });
  await withEnv({ ...keys, VAPID_EMAIL: undefined, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, () => {
    assert.match(vapidDetails()!.subject, /^https:/);
  });
});

function subscription(id: number): PushSubscription {
  return { id, user_id: 7, endpoint: `https://push.example/${id}`, p256dh: "key", auth: "auth", created_at: new Date() };
}

test("subscriptions the push service reports as gone are returned for removal", async (t) => {
  t.mock.method(console, "warn", () => {});
  const bodies: string[] = [];
  const send: PushSender = async (sub, body) => {
    bodies.push(body);
    if (sub.id === 2) throw Object.assign(new Error("Received unexpected response code"), { statusCode: 410 });
    if (sub.id === 3) throw Object.assign(new Error("Not found"), { statusCode: 404 });
    if (sub.id === 4) throw Object.assign(new Error("Server error"), { statusCode: 500 });
    return {};
  };
  const vapid = { subject: "mailto:a@b.c", publicKey: "p", privateKey: "k" };
  const result = await deliverPush([1, 2, 3, 4].map(subscription), { title: "AFYA MAZINGIRA", body: "Test", url: "/plan" }, vapid, send);
  assert.equal(result.sent, 1);
  // A server error may be temporary, so that subscription is kept.
  assert.deepEqual(result.gone, [2, 3]);
  assert.deepEqual(JSON.parse(bodies[0]), { title: "AFYA MAZINGIRA", body: "Test", url: "/plan" });
});

test("a notification can only point at a page on this site", async () => {
  const bodies: string[] = [];
  const send: PushSender = async (_sub, body) => { bodies.push(body); };
  const vapid = { subject: "mailto:a@b.c", publicKey: "p", privateKey: "k" };
  await deliverPush([subscription(1)], { title: "t", body: "b", url: "https://evil.example" }, vapid, send);
  await deliverPush([subscription(1)], { title: "t", body: "b", url: "//evil.example" }, vapid, send);
  assert.deepEqual(bodies.map((b) => JSON.parse(b).url), ["/notifications", "/notifications"]);
});

test("the test-push route needs a database, and the status route does not", async () => {
  await withEnv({ DATABASE_URL: undefined, VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, RESEND_API_KEY: undefined }, async () => {
    const send = await import("../src/app/api/push/send/route");
    const response = await send.POST(new NextRequest("https://afya.example/api/push/send", { method: "POST" }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "database_unavailable");

    const status = await import("../src/app/api/notifications/status/route");
    assert.deepEqual(await (await status.GET()).json(), {
      database_configured: false,
      email_configured: false,
      push_configured: false,
      // With no database there is no record of the daily check to report.
      last_checked_at: null,
    });
  });
});
