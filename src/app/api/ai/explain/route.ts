import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPipeline } from "@/lib/afya/pipeline";
import { generateExplanation, buildFarmExplanationFacts, type FarmFacts } from "@/lib/afya/explanation";
import { buildFarmAdvisory, findCropProfile, type GrowthStage } from "@/lib/afya/farm-engine";
import { loadFarmInputs } from "@/lib/afya/farm-inputs";
import type { Lang, SituationResult } from "@/lib/afya/types";
import { readJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline; the model calls themselves stop after about 8 seconds.
export const maxDuration = 30;

const ExplainSchema = z.object({
  lang: z.enum(["en", "sw"]).default("en"),
  question: z.string().max(500).optional(),
  force_fallback: z.boolean().default(false),
  // "standard" = full technical explanation
  // "plain"    = simplified, non-technical wording (same validated facts)
  mode: z.enum(["standard", "plain"]).default("standard"),
  // Which page is asking, lets the AI draw on that page's own facts (e.g.
  // the Farm Advisory page's irrigation decision) instead of only the
  // general situation/forecast facts, which have nothing about crops.
  context: z.string().max(40).optional(),
  crop: z.string().max(40).optional(),
  stage: z.enum(["establishment", "vegetative", "flowering", "maturity"]).optional(),
  // A plan's own recommended window, so its "Why?" is answered about that
  // window and not the situation's default one-hour window.
  window_start: z.iso.datetime().optional(),
  window_end: z.iso.datetime().optional(),
  activity: z.string().max(40).optional(),
  duration_minutes: z.number().int().min(5).max(720).optional(),
  reasons: z.array(z.string().max(60)).max(8).optional(),
});

async function farmFacts(situation: SituationResult, cropKey: string, stage: GrowthStage, lang: Lang): Promise<FarmFacts | null> {
  // An unknown crop gets no farm facts rather than another crop's.
  const crop = findCropProfile(cropKey);
  if (!crop) return null;
  // Water advice needs the station's (or the regional model's) rain and
  // temperatures; without them it is left out rather than built on
  // placeholders, as on the Farm page.
  try {
    const inputs = await loadFarmInputs();
    if (!inputs) return buildFarmExplanationFacts(null, { waterAvailable: false, lang });
    return buildFarmExplanationFacts(buildFarmAdvisory(situation, crop, stage, inputs), { lang });
  } catch (err) {
    console.warn("[afya-ai] farm advisory unavailable:", err instanceof Error ? err.message : err);
    return buildFarmExplanationFacts(null, { waterAvailable: false, lang });
  }
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "aiExplain");
  if (limited) return limited;

  const body = await readJsonBody(req, ExplainSchema);
  if ("response" in body) return body.response;
  const {
    lang, question, force_fallback, mode, context, crop, stage,
    window_start, window_end, activity, duration_minutes, reasons,
  } = body.data;

  try {
    const isFarm = context === "farm";
    // The Farm page plans field work over a longer window than the default call.
    const situation = await runPipeline(isFarm ? { activityKey: "field_work", durationMinutes: 120 } : {});
    const plan = window_start && window_end && Date.parse(window_end) > Date.parse(window_start)
      ? { start: window_start, end: window_end, activity, duration_minutes, reasons }
      : null;
    const farm = isFarm
      ? await farmFacts(situation, crop ?? "maize", stage ?? "vegetative", lang)
      : null;

    const result = await generateExplanation({
      situation,
      lang,
      question,
      mode,
      context: plan ? "plan" : context,
      forceFallback: force_fallback,
      farm,
      plan,
    });

    return NextResponse.json({
      explanation: result.text,
      source: result.source,
      provider: result.provider,
      mode: result.mode,
      intent: result.intent,
      lang,
      facts: result.facts,
    });
  } catch (err) {
    console.error("Explain API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
