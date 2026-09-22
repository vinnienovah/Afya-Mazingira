import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  buildExplanationFacts,
  buildFarmExplanationFacts,
  detectIntent,
  generateExplanation,
  modelFacts,
  templateExplanation,
  type ProviderSpec,
  type QuestionIntent,
} from "../src/lib/afya/explanation";
import { horizonScores } from "../src/lib/afya/forecast-engine";
import type { ChirpsContext, Era5Context, Lang, SituationResult } from "../src/lib/afya/types";
import { liveSituation, LIVE_MAIZE_ADVISORY } from "./live-situation";

const PLAN = {
  start: "2026-09-22T13:48:16.335Z",
  end: "2026-09-22T15:48:16.335Z",
  activity: "field_work",
  duration_minutes: 120,
  reasons: ["reason_lower_exposure", "reason_low_rain"],
};

function template(
  lang: Lang,
  intent: QuestionIntent,
  options: { mode?: "standard" | "plain"; situation?: SituationResult; farm?: boolean; plan?: boolean } = {},
): string {
  const facts = buildExplanationFacts(options.situation ?? liveSituation(), options.plan ? PLAN : null);
  const farm = options.farm ? buildFarmExplanationFacts(LIVE_MAIZE_ADVISORY, { lang }) : null;
  return templateExplanation({ facts, farm, intent, mode: options.mode ?? "standard", lang });
}

// Facts given to the model

test("unavailable regional context is left out of the facts, not passed on as placeholders", () => {
  const s = liveSituation();
  const empty = (ctx: object) =>
    Object.fromEntries(Object.keys(ctx).map((k) => [k, k === "available" ? false : null]));
  const unavailable = liveSituation({
    era5: empty(s.era5) as Era5Context,
    chirps: empty(s.chirps) as ChirpsContext,
  });
  const facts = buildExplanationFacts(unavailable);
  assert.equal(facts.era5_temp_anomaly, null);
  assert.equal(facts.era5_humidity_anomaly, null);
  assert.equal(facts.chirps_7d_mm, null);

  const shown = modelFacts(facts, "en");
  for (const key of Object.keys(shown)) assert.doesNotMatch(key, /era5|rain_last_7_days/);
  assert.ok(!Object.values(shown).includes(9.3));

  // The shape the rain and ERA5 context take once their values are null.
  const nulled = liveSituation({
    era5: { ...s.era5, available: false, local_temp_anomaly_c: null, local_humidity_anomaly: null } as unknown as SituationResult["era5"],
    chirps: { ...s.chirps, available: false, chirps_7d_mm: null } as unknown as SituationResult["chirps"],
  });
  const fromNull = modelFacts(buildExplanationFacts(nulled), "en");
  assert.ok(!("era5_temp_anomaly_c" in fromNull));
  assert.ok(!("rain_last_7_days_mm" in fromNull));
  assert.ok(Object.values(fromNull).every((v) => v !== null && v !== undefined));
});

test("a missing forecast horizon is null, never 0", () => {
  const facts = buildExplanationFacts(liveSituation({ forecast: [] }));
  assert.equal(facts.forecast_3h, null);
  assert.equal(facts.forecast_3h_lower, null);
  assert.ok(!("forecast_wbgt_3h_c" in modelFacts(facts, "en")));
  assert.match(template("en", "overview", { situation: liveSituation({ forecast: [] }) }), /forecast is unavailable/);
});

test("the model sees Nairobi clock times and the window it is asked about", () => {
  const shown = modelFacts(buildExplanationFacts(liveSituation()), "en");
  assert.equal(shown.expected_peak_time, "13:45");
  assert.equal(shown.best_window, "17:53–18:53");
  assert.equal(shown.latest_reading_time, "11:45");

  const plan = buildExplanationFacts(liveSituation(), PLAN);
  assert.equal(plan.window_source, "plan");
  assert.equal(plan.best_window_time_range, "16:48–18:48");
  assert.equal(plan.best_window_wbgt_max, 18.9);
  assert.equal(modelFacts(plan, "en").best_window, "16:48–18:48");
});

test("farm facts prefer the depth range to the single depth", () => {
  const farm = buildFarmExplanationFacts(LIVE_MAIZE_ADVISORY, { lang: "en" });
  assert.equal(farm.flat.farm_irrigation_depth_range_mm, "65–110");
  assert.ok(!("farm_irrigation_depth_mm" in farm.flat));
  assert.ok(!("farm_irrigation_litres_per_m2" in farm.flat));
  assert.deepEqual(
    { low: farm.irrigation?.depth_low_mm, high: farm.irrigation?.depth_high_mm },
    { low: 65, high: 110 },
  );
  assert.match(String(farm.flat.farm_irrigation_reasons), /the crop used more water than the rain gave it/);
  assert.equal(farm.flat.farm_field_work_window, "16:48–18:48");
});

test("farm facts read a changed advisory field by field", () => {
  // New fields appear as facts, missing ones are simply absent, unknown keys are spelled out.
  const farm = buildFarmExplanationFacts({
    crop: { label_en: "Beans", label_sw: "Maharagwe" },
    stage: "vegetative",
    water_balance: { et0_mm_day: 4.6, et0_source: "station Hargreaves", rain_7d_mm: null },
    irrigation: { action: "CHECK_SOIL", depth_range_mm: null, reason_keys: ["farm_reason_new_rule"], advice_key: "farm_advice_check" },
  }, { lang: "en" });
  assert.equal(farm.flat.farm_et0_mm_day, 4.6);
  assert.equal(farm.flat.farm_et0_source, "station Hargreaves");
  assert.ok(!("farm_rain_7d_mm" in farm.flat));
  assert.equal(farm.flat.farm_irrigation_reasons, "new rule");
  assert.equal(farm.flat.farm_irrigation_advice, "farm advice check");
  assert.equal(farm.irrigation?.depth_low_mm, null);
  assert.equal(farm.spray, null);
  assert.match(
    templateExplanation({ facts: buildExplanationFacts(liveSituation()), farm, intent: "irrigation", mode: "standard", lang: "en" }),
    /Check the soil by hand before irrigating beans/,
  );

  // Nothing usable at all still gives an answer.
  const empty = buildFarmExplanationFacts(null);
  assert.deepEqual(empty.flat, {});
});

test("without rainfall and soil data there is no irrigation advice", () => {
  const farm = buildFarmExplanationFacts(LIVE_MAIZE_ADVISORY, { lang: "en", waterAvailable: false });
  assert.equal(farm.irrigation, null);
  assert.equal(farm.flat.farm_water_advice_available, false);
  assert.ok(!Object.keys(farm.flat).some((k) => /irrigation|depletion|soil_moisture/.test(k)));
  // Spray advice needs only the station, so it stays.
  assert.equal(farm.flat.farm_spray_quality, "MARGINAL");
  const facts = buildExplanationFacts(liveSituation());
  assert.match(
    templateExplanation({ facts, farm, intent: "irrigation", mode: "standard", lang: "en" }),
    /Irrigation advice is not available right now/,
  );
  assert.match(
    templateExplanation({ facts, farm, intent: "irrigation", mode: "standard", lang: "sw" }),
    /Ushauri wa umwagiliaji haupatikani kwa sasa/,
  );
});

// The written fallback

test("questions are routed by intent in both languages", () => {
  const cases: [string, QuestionIntent][] = [
    ["Why is exposure rising?", "heat"],
    ["What does this mean for outdoor work?", "heat"],
    ["Why is this the recommended time?", "best_time"],
    ["How reliable is this data right now?", "reliability"],
    ["Should I irrigate today?", "irrigation"],
    ["When is the best time to spray?", "spray"],
    ["How is the rainfall this week?", "rain"],
    ["Kwa nini kupatwa kunazidi?", "heat"],
    ["Hii ina maana gani kwa kazi za nje?", "heat"],
    ["Kwa nini huu ndio wakati unaopendekezwa?", "best_time"],
    ["Data hii ina uhakika kiasi gani sasa hivi?", "reliability"],
    ["Je, nimwagilie leo?", "irrigation"],
    ["Ni wakati gani mzuri wa kunyunyizia dawa?", "spray"],
    ["Hali ya mvua ikoje wiki hii?", "rain"],
    ["Explain the current situation", "overview"],
    ["Fupisha hali ya sasa", "overview"],
  ];
  for (const [question, intent] of cases) assert.equal(detectIntent(question), intent, question);
  assert.equal(detectIntent(null, "farm"), "farm");
  assert.equal(detectIntent("", "plan"), "best_time");
  assert.equal(detectIntent("What is going on?", "situation"), "overview");
});

test("a peak still ahead is not called the peak", () => {
  // 11:45 reading, peak forecast for 13:45: the old text said "at its thermal peak".
  const en = template("en", "overview");
  assert.doesNotMatch(en, /at its thermal peak/);
  assert.match(en, /Exposure has not peaked yet: WBGT should reach 20\.1°C around 13:45\./);
  assert.match(template("sw", "overview"), /bado hakujafika kilele: WBGT inatarajiwa kufika 20\.1°C karibu saa 13:45/);
  assert.match(template("en", "overview", { mode: "plain" }), /The hardest time to be outside should be around 13:45\./);

  // With the peak at the latest reading, it is described as now.
  const atPeak = liveSituation({ expected_peak: { time: "2026-09-22T08:45:00.000Z", wbgt_c: 19.5 } });
  assert.match(template("en", "overview", { situation: atPeak }), /Exposure is at about its highest for the next 9 hours now/);
  assert.match(template("en", "overview", { situation: atPeak, mode: "plain" }), /Right now is about as hot as it will get/);
  assert.match(template("sw", "overview", { situation: atPeak }), /karibu na kiwango chake cha juu zaidi/);
  assert.match(template("en", "best_time", { situation: atPeak }), /below the 19\.5°C peak at 11:45\./);
  assert.match(template("sw", "best_time", { situation: atPeak }), /chini ya kilele cha 19\.5°C cha saa 11:45\./);
});

test("each intent answers its own question", () => {
  const farm = { farm: true };
  assert.match(template("en", "irrigation", farm), /^Irrigate maize now, about 65–110 mm/);
  assert.match(template("sw", "irrigation", farm), /^Mwagilia mahindi sasa, takriban milimita 65–110/);
  assert.match(template("en", "irrigation", { ...farm, mode: "plain" }), /^Water your maize now: about 65 to 110 litres/);
  assert.match(template("en", "spray", farm), /Spraying conditions right now are marginal/);
  assert.match(template("en", "spray", farm), /16:48–18:48/);
  assert.match(template("sw", "spray", farm), /Hali ya kunyunyizia dawa kwa sasa ni ya wastani/);
  assert.match(template("en", "rain"), /shows no rain.*rain signal.*25%.*14\.9 mm/);
  assert.match(template("sw", "rain"), /hakionyeshi mvua.*25%.*milimita 14\.9/);
  const reliability = template("en", "reliability");
  assert.match(reliability, /^Data quality is GOOD\. The latest station reading is 31 minutes old\./);
  assert.ok(reliability.includes(`${horizonScores("3h").mae.toFixed(2)}°C`), reliability);
  assert.match(template("sw", "reliability"), /^Ubora wa data: NZURI\. Kipimo cha mwisho cha kituo kina umri wa dakika 31\./);
  assert.match(template("en", "best_time"), /^The lowest-exposure 60-minute window for general outdoor activity is 17:53–18:53\./);
  assert.match(template("en", "best_time"), /between 17\.8 and 18\.2°C, below the 20\.1°C peak expected around 13:45/);
  assert.match(template("sw", "best_time"), /^Dirisha la dakika 60 lenye kupatwa na joto kidogo zaidi kwa shughuli za nje ni 17:53–18:53\./);
  assert.match(template("en", "heat"), /^WBGT in the shade is 19\.5°C now and is forecast to rise to 20\.0°C within 3 hours\./);
  assert.match(template("en", "heat"), /the usual change at this time of day/);
  // An answer to one question does not recite the others.
  assert.doesNotMatch(template("en", "rain"), /WBGT/);
  assert.doesNotMatch(template("en", "irrigation", farm), /17:53/);
});

test("a plan's Why? is answered about the plan's own window", () => {
  const en = template("en", "best_time", { plan: true });
  assert.match(en, /^Your plan's recommended window is 16:48–18:48\./);
  assert.match(en, /between 17\.8 and 18\.9°C/);
  assert.doesNotMatch(en, /17:53/);
  assert.match(template("sw", "best_time", { plan: true }), /^Dirisha linalopendekezwa kwa mpango wako ni 16:48–18:48\./);
  assert.match(template("en", "best_time", { plan: true, mode: "plain" }), /^For your plan, 16:48–18:48 is the best time\./);
});

test("the Kiswahili fallback has no English category words", () => {
  const sw = template("sw", "overview");
  assert.doesNotMatch(sw, /\b(?:moderate|GOOD|ELEVATED)\b/);
  assert.match(sw, /utata wa wastani/);
  assert.match(sw, /Hatari ya kupatwa na joto ni IMEINUKA/);
});

// The model chain

function provider(name: ProviderSpec["name"], reply: string | (() => Promise<string>), calls: string[]): ProviderSpec {
  return {
    name,
    run: async () => {
      calls.push(name);
      return typeof reply === "string" ? reply : reply();
    },
  };
}

test("a correct English reply is used; a wrong one falls through to the next provider", async (t) => {
  t.mock.method(console, "warn", () => {});
  const calls: string[] = [];
  const result = await generateExplanation({
    situation: liveSituation(),
    lang: "en",
    providers: [
      provider("gemini", "Thermal exposure risk is HIGH and WBGT is 19.8°C.", calls),
      provider("groq", "The JKUAT area is in a Hot / High-Radiation Exposure state and thermal exposure risk is ELEVATED. WBGT is 19.5°C, forecast 18.8-21.2°C in 3 hours.", calls),
      provider("openai", "never reached", calls),
    ],
  });
  assert.deepEqual(calls, ["gemini", "groq"]);
  assert.equal(result.source, "llm");
  assert.equal(result.provider, "groq");
});

test("when every reply is rejected the fallback answers the question asked", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const result = await generateExplanation({
    situation: liveSituation(),
    lang: "sw",
    question: "Hali ya mvua ikoje wiki hii?",
    providers: [provider("gemini", "Mvua ya siku 7 ilikuwa milimita 40.", [])],
  });
  assert.equal(result.source, "deterministic");
  assert.equal(result.intent, "rain");
  assert.match(result.text, /milimita 14\.9/);
  assert.match(String(warn.mock.calls[0].arguments[0]), /gemini reply rejected: number "40"/);
});

test("slow providers are cut off and the whole answer stays within the budget", async (t) => {
  t.mock.method(console, "warn", () => {});
  const calls: string[] = [];
  const never = () => new Promise<string>(() => {});
  const started = Date.now();
  const result = await generateExplanation({
    situation: liveSituation(),
    lang: "en",
    providers: [
      provider("gemini", never, calls),
      provider("groq", never, calls),
      provider("openai", never, calls),
      provider("anthropic", never, calls),
    ],
    budgetMs: 400,
    providerTimeoutMs: 150,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.source, "deterministic");
  assert.ok(elapsed < 600, `took ${elapsed} ms`);
  assert.ok(calls.length >= 2 && calls.length <= 3, `tried ${calls.join(", ")}`);
});

test("a forced fallback never calls a provider", async () => {
  const calls: string[] = [];
  const result = await generateExplanation({
    situation: liveSituation(),
    lang: "en",
    forceFallback: true,
    providers: [provider("gemini", "Thermal exposure risk is ELEVATED.", calls)],
  });
  assert.deepEqual(calls, []);
  assert.equal(result.provider, "deterministic");
});

test("the explain route answers malformed JSON with 400 before any work", async () => {
  const { POST } = await import("../src/app/api/ai/explain/route");
  const response = await POST(new NextRequest("https://afya.example/api/ai/explain", {
    method: "POST",
    body: "{\"lang\": \"en\",",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_json" });
});

test("a depth range whose ends are equal is stated as one depth", () => {
  const advisory = {
    ...LIVE_MAIZE_ADVISORY,
    irrigation: { ...LIVE_MAIZE_ADVISORY.irrigation, depth_mm: 10, litres_per_m2: 10, depth_range_mm: { low: 10, high: 10 } },
  };
  const farm = buildFarmExplanationFacts(advisory, { lang: "en" });
  assert.equal(farm.flat.farm_irrigation_depth_range_mm, 10);
  assert.deepEqual({ low: farm.irrigation?.depth_low_mm, high: farm.irrigation?.depth_high_mm }, { low: 10, high: null });
});
