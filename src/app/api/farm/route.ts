import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPipeline } from "@/lib/afya/pipeline";
import { buildFarmAdvisory } from "@/lib/afya/farm-engine";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline, Vercel's default function timeout is short.
export const maxDuration = 30;

const FarmSchema = z.object({
  crop: z.string().default("maize"),
  stage: z.enum(["establishment", "vegetative", "flowering", "maturity"]).default("vegetative"),
});

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = FarmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    const { crop, stage } = parsed.data;

    // Farmers plan field work across the working day, so evaluate a
    // longer activity window than the default situation call.
    const situation = await runPipeline({ activityKey: "field_work", durationMinutes: 120 });
    // Irrigation depends on real rainfall and soil moisture; without them
    // there is no advice to give, rather than advice built on placeholders.
    if (situation.era5.available === false || situation.chirps.available === false) {
      return NextResponse.json({ error: "context_unavailable" }, { status: 503 });
    }
    const advisory = buildFarmAdvisory(situation, crop, stage);

    return NextResponse.json({
      advisory,
      situation: {
        state: situation.state,
        quality: situation.quality,
        risk: situation.risk,
        current: situation.current,
        expected_peak: situation.expected_peak,
        era5: situation.era5,
        chirps: situation.chirps,
        demo_mode: situation.demo_mode,
        best_time_note: situation.best_time_note ?? null,
        data_source: situation.data_source,
      },
    });
  } catch (err) {
    console.error("Farm API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
