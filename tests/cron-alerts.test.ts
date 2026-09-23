import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorized, runAlertCheck, type AlertRunDeps, type AlertRunRecord,
} from "../src/app/api/cron/check-alerts/run";
import type { NotificationRule, User } from "../src/db/schema";
import type { ForecastPoint, SituationResult } from "../src/lib/afya/types";

const HOUR = 3600_000;
// 08:00 EAT on 22 September 2026, when the daily job runs.
const NOW = Date.UTC(2026, 8, 22, 5, 0);
const iso = (ms: number) => new Date(ms).toISOString();

// A day that climbs to a HIGH peak at 14:00, so the heat rules have something
// to fire on.
function forecast(): ForecastPoint[] {
  return Array.from({ length: 37 }, (_, i) => {
    const hour = 8 + i / 4;
    const value = hour <= 14 ? 17 + (25 - 17) * ((hour - 8) / 6) : 25 - (hour - 14) * 0.8;
    const v = Math.round(value * 10) / 10;
    return { time: iso(NOW + i * 900_000), value: v, lower: v - 1, upper: v + 1, horizon_minutes: i * 15 };
  });
}

function situation(): SituationResult {
  const series = forecast();
  return {
    generated_at: iso(NOW),
    location: "JKUAT / Juja",
    demo_mode: false,
    data_source: "CONDUIT_LIVE",
    quality: { status: "GOOD", freshness_minutes: 5, flags: [], updated_at: iso(NOW) },
    current: {
      time: iso(NOW), temperature_c: 22, humidity_pct: 70, pressure_hpa: 850,
      wind_speed_ms: 1, wind_direction_deg: 90, wind_gust_ms: 2,
      visible_signal: 200, infrared_signal: 200, wet_bulb_c: 17, wbgt_c: 18,
      rain_observed: false,
    },
    state: { state_id: 1, since: iso(NOW - 2 * HOUR), previous_state_id: 0, transition_likelihood: null },
    forecast: [],
    forecast_series: series,
    risk: { thermal: "ELEVATED", rain_probability: 0.1, uncertainty: "LOW", data_quality: "GOOD" },
    best_time: null,
    expected_peak: { time: iso(NOW + 6 * HOUR), wbgt_c: 25 },
    state_history_24h: [],
    contributors: [],
    era5: { available: false } as SituationResult["era5"],
    chirps: { available: false } as SituationResult["chirps"],
    sentinel: {
      sentinel2_available: false, sentinel2_acquired: null, sentinel2_ndvi_mean: null,
      sentinel3_available: false, sentinel3_acquired: null, sentinel3_lst_c: null,
    },
    regional_outlook: [],
  };
}

function rule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: 1,
    user_id: 7,
    name: "Midday heat",
    rule_type: "exposure_tier",
    activity_type: "outdoor_work",
    enabled: true,
    last_triggered_at: null,
    created_at: new Date(NOW - 7 * 24 * HOUR),
    updated_at: new Date(NOW - 7 * 24 * HOUR),
    ...overrides,
  };
}

const USER: User = {
  id: 7,
  name: "Achieng Otieno",
  email: "achieng@example.com",
  password_hash: null,
  password_salt: null,
  google_id: null,
  avatar_url: null,
  auth_provider: "password",
  language: "en",
  email_verified: true,
  email_verified_at: new Date(NOW - 30 * 24 * HOUR),
  created_at: new Date(NOW - 30 * 24 * HOUR),
};

interface Spy {
  emails: { to: string; subject: string; lang: string }[];
  pushes: { to: number; title: string }[];
  marked: number[];
  runs: AlertRunRecord[];
}

function deps(overrides: Partial<AlertRunDeps> = {}): { deps: AlertRunDeps; spy: Spy } {
  const spy: Spy = { emails: [], pushes: [], marked: [], runs: [] };
  return {
    spy,
    deps: {
      now: NOW,
      situation: situation(),
      yesterdayPeak: null,
      rules: [rule()],
      plans: [],
      owner: async () => USER,
      canEmail: true,
      sendEmail: async (user, subject, _lines, _url, _cta, lang) => {
        spy.emails.push({ to: user.email, subject, lang });
      },
      sendPush: async (user, payload) => {
        spy.pushes.push({ to: user.id, title: payload.title });
        return 1;
      },
      markTriggered: async (ruleId) => { spy.marked.push(ruleId); },
      recordRun: async (record) => { spy.runs.push(record); },
      ...overrides,
    },
  };
}

test("the run is refused unless the request carries the cron secret", () => {
  assert.equal(authorized("s3cret", "Bearer s3cret"), true);
  assert.equal(authorized("s3cret", "Bearer wrong"), false);
  assert.equal(authorized("s3cret", "s3cret"), false);
  assert.equal(authorized("s3cret", null), false);
});

test("with no secret configured every request is refused, the blank one included", () => {
  assert.equal(authorized(undefined, "Bearer undefined"), false);
  assert.equal(authorized(undefined, null), false);
  assert.equal(authorized("", "Bearer "), false);
});

test("the route answers 401 without the secret, before touching anything else", async () => {
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "s3cret";
  try {
    const { GET } = await import("../src/app/api/cron/check-alerts/route");
    for (const header of [undefined, "Bearer wrong", "s3cret"]) {
      const res = await GET(new Request("https://afya.test/api/cron/check-alerts", {
        headers: header ? { authorization: header } : {},
      }) as never);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "unauthorized" });
    }
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
});

test("a rule that fires sends one email and one push, and is marked as fired", async () => {
  const { deps: d, spy } = deps();
  const result = await runAlertCheck(d);

  assert.equal(result.triggered, 1);
  assert.equal(spy.emails.length, 1);
  assert.equal(spy.emails[0].to, "achieng@example.com");
  assert.equal(spy.pushes.length, 1);
  assert.deepEqual(spy.marked, [1]);
  assert.equal(result.emails_sent, 1);
  assert.equal(result.pushes_sent, 1);
});

test("a rule already fired today is left alone", async () => {
  const { deps: d, spy } = deps({ rules: [rule({ last_triggered_at: new Date(NOW - HOUR) })] });
  const result = await runAlertCheck(d);

  assert.equal(result.triggered, 0);
  assert.equal(spy.emails.length, 0);
  assert.equal(spy.pushes.length, 0);
  assert.deepEqual(spy.marked, []);
});

test("without an email provider the push still goes out", async () => {
  const { deps: d, spy } = deps({ canEmail: false });
  const result = await runAlertCheck(d);

  assert.equal(spy.emails.length, 0);
  assert.equal(spy.pushes.length, 1);
  assert.equal(result.email_configured, false);
});

test("a failed email is counted and does not stop the push or the next rule", async () => {
  const { deps: d, spy } = deps({
    rules: [rule({ id: 1 }), rule({ id: 2, name: "Second" })],
    sendEmail: async () => { throw new Error("Resend HTTP 500"); },
  });
  const result = await runAlertCheck(d);

  assert.equal(result.triggered, 2);
  assert.equal(result.emails_sent, 0);
  assert.equal(result.pushes_sent, 2);
  assert.equal(result.errors, 2);
  assert.match(result.error_messages[0], /rule 1 email: Resend HTTP 500/);
  assert.deepEqual(spy.marked, [1, 2]);
});

test("every run is recorded, including one that fires nothing at all", async () => {
  const { deps: d, spy } = deps({ rules: [] });
  const result = await runAlertCheck(d);

  assert.equal(spy.runs.length, 1);
  assert.deepEqual(spy.runs[0], {
    ran_at: new Date(NOW),
    rules_evaluated: 0,
    triggered: 0,
    emails_sent: 0,
    pushes_sent: 0,
    errors: 0,
  });
  assert.equal(result.rules_evaluated, 0);
});

test("the run record carries what the run did", async () => {
  const { deps: d, spy } = deps();
  await runAlertCheck(d);

  assert.deepEqual(spy.runs[0], {
    ran_at: new Date(NOW),
    rules_evaluated: 1,
    triggered: 1,
    emails_sent: 1,
    pushes_sent: 1,
    errors: 0,
  });
});

test("a run whose record cannot be written still reports the alerts it sent", async () => {
  const { deps: d, spy } = deps({
    recordRun: async () => { throw new Error("relation alert_runs does not exist"); },
  });
  const result = await runAlertCheck(d);

  assert.equal(result.triggered, 1);
  assert.equal(spy.emails.length, 1);
  assert.match(result.error_messages.at(-1)!, /run record: relation alert_runs does not exist/);
});

test("a rule whose owner is gone is skipped without sending anything", async () => {
  const { deps: d, spy } = deps({ owner: async () => undefined });
  const result = await runAlertCheck(d);

  assert.equal(result.triggered, 0);
  assert.equal(spy.emails.length, 0);
  assert.deepEqual(spy.marked, []);
});

test("a Kiswahili user is written to in Kiswahili", async () => {
  const { deps: d, spy } = deps({ owner: async () => ({ ...USER, language: "sw" }) });
  await runAlertCheck(d);

  assert.equal(spy.emails[0].lang, "sw");
});
