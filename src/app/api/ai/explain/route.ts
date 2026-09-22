import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPipeline } from "@/lib/afya/pipeline";
import { generateExplanation, buildExplanationFacts, buildFarmExplanationFacts } from "@/lib/afya/explanation";
import { buildFarmAdvisory, findCropProfile, type GrowthStage } from "@/lib/afya/farm-engine";
import { loadFarmInputs } from "@/lib/afya/farm-inputs";
import type { Lang } from "@/lib/afya/types";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline, plus the LLM call itself, Vercel's default function timeout
// is short.
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
  context: z.string().optional(),
  crop: z.string().optional(),
  stage: z.enum(["establishment", "vegetative", "flowering", "maturity"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ExplainSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }

    const { lang, question, force_fallback, mode, context, crop, stage } = parsed.data;

    const situation = await runPipeline();
    const facts = buildExplanationFacts(situation);
    // An unknown crop gets no farm facts rather than another crop's.
    const farmCrop = context === "farm" ? findCropProfile(crop ?? "maize") : null;
    const farmInputs = farmCrop ? await loadFarmInputs() : null;
    const extraFacts = farmCrop && farmInputs
      ? buildFarmExplanationFacts(buildFarmAdvisory(situation, farmCrop, (stage ?? "vegetative") as GrowthStage, farmInputs))
      : undefined;
    const result = await generateExplanation(
      situation,
      lang as Lang,
      question,
      force_fallback,
      mode,
      extraFacts,
    );

    return NextResponse.json({
      explanation: result.text,
      source: result.source,
      provider: result.provider,
      mode: result.mode,
      lang,
      facts,
    });
  } catch (err) {
    console.error("Explain API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
