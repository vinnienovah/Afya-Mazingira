import { test } from "node:test";
import assert from "node:assert/strict";
import { decideGoogleLink, stateCookie, clearStateCookie } from "../src/lib/auth/google";
import { sessionCookie, clearSessionCookie } from "../src/lib/auth/logic";

test("a Google sign-in claims an address nobody proved, instead of keeping its password", () => {
  // Someone registered the victim's address with their own password and never verified it.
  assert.equal(
    decideGoogleLink({ googleEmailVerified: true, linked: false, existing: { googleId: null, emailProven: false } }),
    "claim",
  );
  // The owner proved the address through our own link: safe to attach Google.
  assert.equal(
    decideGoogleLink({ googleEmailVerified: true, linked: false, existing: { googleId: null, emailProven: true } }),
    "link",
  );
  assert.equal(decideGoogleLink({ googleEmailVerified: true, linked: false, existing: null }), "create");
  assert.equal(decideGoogleLink({ googleEmailVerified: true, linked: true, existing: null }), "sign_in");
  // Google itself has not verified the address: it proves nothing.
  assert.equal(
    decideGoogleLink({ googleEmailVerified: false, linked: false, existing: { googleId: null, emailProven: false } }),
    "refuse_unverified",
  );
  assert.equal(decideGoogleLink({ googleEmailVerified: false, linked: false, existing: null }), "refuse_unverified");
  // The address already belongs to another Google account.
  assert.equal(
    decideGoogleLink({ googleEmailVerified: true, linked: false, existing: { googleId: "other-sub", emailProven: true } }),
    "refuse_conflict",
  );
});

test("cookies are Secure in production only", () => {
  const env = process.env as Record<string, string | undefined>;
  const before = env.NODE_ENV;
  try {
    env.NODE_ENV = "production";
    for (const cookie of [sessionCookie("t"), clearSessionCookie(), stateCookie("s"), clearStateCookie()]) {
      assert.match(cookie, /; HttpOnly; SameSite=Lax; .*; Secure$/);
    }
    env.NODE_ENV = "development";
    for (const cookie of [sessionCookie("t"), clearSessionCookie(), stateCookie("s"), clearStateCookie()]) {
      assert.doesNotMatch(cookie, /Secure/);
    }
  } finally {
    env.NODE_ENV = before;
  }
});
