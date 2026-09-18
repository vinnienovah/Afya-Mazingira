import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPipeline } from "@/lib/afya/pipeline";
import { generateExplanation, buildExplanationFacts } from "@/lib/afya/explanation";
import type { Lang } from "@/lib/afya/types";

const ExplainSchema = z.object({
  lang: z.enum(["en", "sw"]).default("en"),
  question: z.string().max(500).optional(),
  force_fallback: z.boolean().default(false),
  // "standard" = full technical explanation
  // "plain"    = simplified, non-technical wording (same validated facts)
  mode: z.enum(["standard", "plain"]).default("standard"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ExplainSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }

    const { lang, question, force_fallback, mode } = parsed.data;

    const situation = runPipeline();
    const facts = buildExplanationFacts(situation);
    const result = await generateExplanation(
      situation,
      lang as Lang,
      question,
      force_fallback,
      mode,
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
