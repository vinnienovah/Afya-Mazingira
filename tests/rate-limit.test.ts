import { test } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowLimiter, clientIp, rateLimit, rateLimitKey, LIMITS } from "../src/lib/rate-limit";

test("the window slides: requests free up as the oldest ones age out", () => {
  const limiter = new SlidingWindowLimiter(3, 60_000);
  const t0 = 1_000_000;
  assert.equal(limiter.check("ip", t0).ok, true);
  assert.equal(limiter.check("ip", t0 + 10_000).ok, true);
  assert.equal(limiter.check("ip", t0 + 20_000).remaining, 0);
  const blocked = limiter.check("ip", t0 + 30_000);
  assert.equal(blocked.ok, false);
  // The first request leaves the window at t0 + 60 s, 30 s from now.
  assert.equal(blocked.retryAfterSeconds, 30);
  assert.equal(limiter.check("ip", t0 + 59_999).ok, false);
  assert.equal(limiter.check("ip", t0 + 60_001).ok, true);
  // A refused request does not count against the caller.
  assert.equal(limiter.check("ip", t0 + 60_002).ok, false);
});

test("keys are counted separately", () => {
  const limiter = new SlidingWindowLimiter(1, 60_000);
  assert.equal(limiter.check("a", 0).ok, true);
  assert.equal(limiter.check("a", 1).ok, false);
  assert.equal(limiter.check("b", 2).ok, true);
});

test("memory stays bounded by dropping expired and then the oldest keys", () => {
  const limiter = new SlidingWindowLimiter(5, 1_000, 100);
  for (let i = 0; i < 1_000; i++) limiter.check(`ip-${i}`, i);
  assert.ok(limiter.size <= 100, `holds ${limiter.size} keys`);
  // The most recent callers are still being counted.
  for (let n = 0; n < 4; n++) limiter.check("ip-999", 1_000);
  assert.equal(limiter.check("ip-999", 1_000).ok, false);
});

test("the caller's IP comes from the first forwarded address", () => {
  const req = (headers: Record<string, string>) => new Request("https://example.test/", { headers });
  assert.equal(clientIp(req({ "x-forwarded-for": "41.90.1.2, 10.0.0.1" })), "41.90.1.2");
  assert.equal(clientIp(req({ "x-real-ip": "41.90.1.3" })), "41.90.1.3");
  assert.equal(clientIp(req({})), "unknown");
});

test("a request over a named limit gets 429 with Retry-After", async () => {
  const req = new Request("https://example.test/api/auth/sign-up", { headers: { "x-forwarded-for": "198.51.100.7" } });
  for (let i = 0; i < LIMITS.signUp.limit; i++) assert.equal(rateLimit(req, "signUp"), null);
  const refused = rateLimit(req, "signUp");
  assert.ok(refused);
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  assert.equal((await refused.json()).error, "rate_limited");
  // Another address is unaffected.
  const other = new Request("https://example.test/api/auth/sign-up", { headers: { "x-forwarded-for": "198.51.100.8" } });
  assert.equal(rateLimit(other, "signUp"), null);
});

test("one account is limited whichever address the attempts come from", () => {
  for (let i = 0; i < LIMITS.signInAccount.limit; i++) assert.equal(rateLimitKey("signInAccount", "wanjiru@example.com"), null);
  assert.equal(rateLimitKey("signInAccount", "wanjiru@example.com")?.status, 429);
  assert.equal(rateLimitKey("signInAccount", "otieno@example.com"), null);
});
