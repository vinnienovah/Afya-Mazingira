import { test } from "node:test";
import assert from "node:assert/strict";
import { appUrl } from "../src/lib/app-url";

const KEYS: string[] = ["NEXT_PUBLIC_APP_URL", "VERCEL_URL", "NODE_ENV"];

/** Runs the body with exactly these variables set, then puts the rest back. */
function withEnv(env: Record<string, string>, body: () => void) {
  const saved = KEYS.map((key) => [key, process.env[key]] as const);
  try {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, env);
    body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Collects anything written to console.warn while the body runs. */
function warnings(body: () => void): string[] {
  const collected: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { collected.push(args.join(" ")); };
  try {
    body();
  } finally {
    console.warn = original;
  }
  return collected;
}

test("the configured address wins, without its trailing slash", () => {
  withEnv({ NEXT_PUBLIC_APP_URL: "https://afya-mazingira.vercel.app/", VERCEL_URL: "other.vercel.app" }, () => {
    assert.equal(appUrl(), "https://afya-mazingira.vercel.app");
  });
  withEnv({ NEXT_PUBLIC_APP_URL: "https://afya.example" }, () => {
    assert.equal(appUrl(), "https://afya.example");
  });
});

test("a deploy that forgot the variable links to itself, not to localhost", () => {
  withEnv({ VERCEL_URL: "afya-mazingira-abc123.vercel.app" }, () => {
    assert.equal(appUrl(), "https://afya-mazingira-abc123.vercel.app");
  });
  // Vercel sets it bare, but a scheme in it must not produce https://https://.
  withEnv({ VERCEL_URL: "https://afya-mazingira-abc123.vercel.app/" }, () => {
    assert.equal(appUrl(), "https://afya-mazingira-abc123.vercel.app");
  });
});

test("an empty variable counts as unset", () => {
  withEnv({ NEXT_PUBLIC_APP_URL: "   ", VERCEL_URL: "afya.vercel.app" }, () => {
    assert.equal(appUrl(), "https://afya.vercel.app");
  });
});

test("outside production the placeholder is used without complaint", () => {
  withEnv({ NODE_ENV: "development" }, () => {
    assert.deepEqual(warnings(() => assert.equal(appUrl(), "http://localhost:3000")), []);
  });
});

test("in production with no usable address the placeholder is warned about, once", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    const first = warnings(() => assert.equal(appUrl(), "http://localhost:3000"));
    assert.equal(first.length, 1);
    assert.match(first[0], /NEXT_PUBLIC_APP_URL/);
    assert.match(first[0], /VERCEL_URL/);
    // Once per process: the daily alert run would otherwise repeat it per email.
    assert.deepEqual(warnings(() => appUrl()), []);
  });
});
