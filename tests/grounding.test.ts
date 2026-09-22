import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGrounding, groundingFromFacts, type Grounding } from "../src/lib/afya/grounding";
import { buildExplanationFacts, buildFarmExplanationFacts, modelFacts } from "../src/lib/afya/explanation";
import { horizonScores } from "../src/lib/afya/forecast-engine";
import type { Lang } from "../src/lib/afya/types";
import { liveSituation, LIVE_MAIZE_ADVISORY } from "./live-situation";

// Grounding exactly as generateExplanation builds it for the live situation.
function grounding(lang: Lang, options: { farm?: boolean; plan?: boolean; question?: string } = {}): Grounding {
  const plan = options.plan
    ? { start: "2026-09-22T13:48:16.335Z", end: "2026-09-22T15:48:16.335Z", activity: "field_work", duration_minutes: 120 }
    : null;
  const facts = buildExplanationFacts(liveSituation(), plan);
  const farm = options.farm ? buildFarmExplanationFacts(LIVE_MAIZE_ADVISORY, { lang }) : null;
  const risks = [facts.thermal_risk_level];
  if (plan && facts.best_window_risk) risks.push(facts.best_window_risk);
  return groundingFromFacts(modelFacts(facts, lang, farm), risks, facts.quality, options.question);
}

function assertPasses(text: string, g: Grounding) {
  const verdict = checkGrounding(text, g);
  assert.deepEqual(verdict, { ok: true }, text);
}

function assertRejected(text: string, g: Grounding, reason: RegExp) {
  const verdict = checkGrounding(text, g);
  assert.equal(verdict.ok, false, text);
  if (!verdict.ok) assert.match(verdict.reason, reason);
}

test("an English overview naming the Hot / High-Radiation state next to the ELEVATED band passes", () => {
  // The old check read "High" in the state name as a second risk band.
  assertPasses(
    "The JKUAT area is currently in a Hot / High-Radiation Exposure state, with an ELEVATED thermal exposure risk. " +
      "The current WBGT in the shade is 19.5°C, with an air temperature of 23.9°C and 54% humidity.",
    grounding("en"),
  );
  assertPasses(
    "Thermal exposure risk is ELEVATED due to high radiation and low ventilation, so take care with strenuous work.",
    grounding("en"),
  );
  assertPasses("Thermal exposure risk is ELEVATED with moderate uncertainty in the forecast.", grounding("en"));
});

test("a range written with a hyphen is two temperatures, not a negative one", () => {
  const g = grounding("en");
  assertPasses("WBGT is forecast to reach 20.0°C in 3 hours (range 18.8-21.2°C, moderate uncertainty).", g);
  assertPasses("The 3-hour range is 18.8°C - 21.2°C.", g);
  assertPasses("The 3-hour range is between 18.8 and 21.2 °C.", g);
});

test("rounded temperatures, 12-hour times and the model's error pass", () => {
  const g = grounding("en");
  assertPasses(
    "Right now the WBGT is 19.5 °C and the air temperature is 23.9 °C. The thermal risk level is ELEVATED. " +
      "The forecast shows about 20°C in three hours and around 17°C by the evening, with the highest exposure " +
      `expected at 1:45 PM. The model's typical error at 3 hours is ${horizonScores("3h").mae.toFixed(2)}°C. The best time for a one-hour outdoor ` +
      "activity is 5:53 PM to 6:53 PM.",
    g,
  );
  assertPasses("It feels warm, about 24°C in the air, and the hottest time is around 1:45 this afternoon.", g);
  assertPasses("The best time to be outside today is from 5:53 to 6:53 in the evening.", g);
  assertPasses("WBGT is about 20 degrees Celsius now.", g);
});

test("the live Swahili replies from Gemini pass", () => {
  const g = grounding("sw");
  assertPasses(
    "Hali ya mazingira ni Joto / Mionzi Mikali na hatari ya joto IMEINUKA. Kiwango cha sasa cha WBGT ni 19.5, " +
      "joto la sasa ni 23.9, na unyevu ni 54. Ubora wa data ni mzuri. Sababu za hali hii ni kuwa uingizaji hewa ni " +
      "mdogo na mazingira yako karibu na kipindi cha mionzi ya juu. Wakati mzuri wa shughuli ni kuanzia 17:53 hadi 18:53.",
    g,
  );
  assertPasses(
    "Leo kuna joto kali na mazingira yako karibu na kipindi cha mionzi ya juu, tena uingizaji hewa ni mdogo. " +
      "Tunatarajia joto litaongezeka haraka. Wakati mzuri wa kufanya kazi za nje au mazoezi ni kuanzia saa 17:53 " +
      "hadi 18:53 jioni ambapo kutakuwa na baridi kiasi.",
    g,
  );
});

test("Swahili replies with °C, ranges and Swahili clock times pass", () => {
  const g = grounding("sw");
  assertPasses(
    "WBGT kivulini ni 19.5°C sasa na inatarajiwa kufika 20.0°C baada ya saa 3 (kati ya 18.8 na 21.2°C). " +
      "Kilele cha 20.1°C kinatarajiwa karibu saa 13:45. Hatari ya kupatwa na joto ni IMEINUKA. Dirisha bora ni 17:53–18:53.",
    g,
  );
  // Swahili time counts from 06:00: saa 7:45 mchana is 13:45, saa 11:53 jioni is 17:53.
  assertPasses("Joto litakuwa kali zaidi karibu saa 7:45 mchana. Wakati mzuri ni kuanzia saa 11:53 jioni hadi saa 12:53 jioni.", g);
  assertPasses("Ubora wa data: NZURI. Kipimo cha mwisho kina umri wa dakika 31.", g);
});

test("farm answers may use the advice's depth range, soil moisture and rain", () => {
  const g = grounding("en", { farm: true, question: "Should I irrigate my maize today, and how much?" });
  // The live English farm reply.
  assertPasses(
    "Yes, you should irrigate your maize today. The recommended irrigation action is IRRIGATE_NOW with a depth of 65 mm. " +
      "Your current soil moisture is at 18 percent, and root-zone depletion is at 100 percent.",
    g,
  );
  assertPasses("Irrigate now with about 65–110 mm, since crop demand (2.89 mm a day) exceeded the 14.9 mm of rain in 7 days.", g);
  assertPasses("Ndiyo, mwagilia mahindi leo, takriban milimita 65 hadi 110. Unyevu wa udongo ni asilimia 18 tu.", grounding("sw", { farm: true }));
});

test("a plan's own window may be explained, and the default window may not", () => {
  const g = grounding("en", { plan: true, question: "Why is 16:48–18:48 the recommended window?" });
  assertPasses(
    "16:48–18:48 is recommended because the forecast WBGT stays between 17.8 and 18.9°C then, well below the " +
      "20.1°C peak expected around 13:45.",
    g,
  );
  assertRejected("The best window is 17:53–18:53.", g, /time/);
});

test("altered readings, ranges and derived numbers are rejected", () => {
  const g = grounding("en");
  assertRejected("The current WBGT is 19.8°C and thermal exposure risk is ELEVATED.", g, /19\.8/);
  assertRejected("The +3 h forecast is 20.0°C (range 18.8–22.4°C).", g, /22\.4/);
  assertRejected("It will reach about 22°C this afternoon.", g, /22/);
  assertRejected("WBGT will rise by 0.6°C over the next two hours.", g, /0\.6/);
  assertRejected("Humidity is 45% and the thermal exposure risk is ELEVATED.", g, /45/);
  assertRejected("WBGT is about 67°F in the shade.", g, /67/);
  // The anomaly is +9.3 °C; writing it as negative flips its meaning.
  assertRejected("ERA5 puts the area at -9.3°C against the regional value.", g, /-9\.3/);
  assertRejected("Irrigate your maize with 50 mm of water today.", grounding("en", { farm: true }), /50/);
  assertRejected("Unyevu ni 45 na joto la hewa ni 23.9.", grounding("sw"), /45/);
});

test("clock times that are not in the facts are rejected, in any format", () => {
  const g = grounding("en");
  assertRejected("The peak of 20.1°C is expected around 14:15.", g, /14:15/);
  assertRejected("The best window is 5:30 PM to 6:30 PM.", g, /5:30 PM/);
  assertRejected("Wakati mzuri ni kuanzia saa 16:30 hadi 17:30.", grounding("sw"), /16:30/);
  // Swahili time for 16:53, an hour before the real window.
  assertRejected("Wakati mzuri ni kuanzia saa 10:53 jioni.", grounding("sw"), /10:53/);
});

test("a risk band or data-quality category other than the real one is rejected", () => {
  const g = grounding("en");
  assertRejected("Thermal exposure risk is HIGH, so avoid strenuous work.", g, /HIGH/);
  assertRejected("The heat risk is low today, so enjoy being outside.", g, /LOW/);
  assertRejected("It is a low-risk time to work outside.", g, /LOW/);
  assertRejected("Data quality is DEGRADED, so treat the forecast with caution.", g, /DEGRADED/);
  assertRejected("Hatari ya kupatwa na joto ni JUU SANA.", grounding("sw"), /VERY_HIGH/);
  assertRejected("Kiwango cha sasa cha WBGT ni 19.5, na hatari ya joto ni JUU.", grounding("sw"), /HIGH/);
  // Other risks keep their own words.
  assertPasses("Rain risk is low and the thermal exposure risk is ELEVATED.", g);
  assertPasses("There is a low risk of rain this afternoon.", g);
});

test("medical claims are rejected", () => {
  assertRejected("People with asthma should go to hospital if they feel unwell.", grounding("en"), /medical/);
  assertRejected("Nenda hospitali ukijisikia vibaya.", grounding("sw"), /medical/);
});
