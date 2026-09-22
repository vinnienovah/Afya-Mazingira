import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPipeline } from "@/lib/afya/pipeline";
import { buildFarmAdvisory, CROP_KEYS, findCropProfile } from "@/lib/afya/farm-engine";
import { loadFarmInputs } from "@/lib/afya/farm-inputs";

// Safety net for the (usually much faster) station and Open-Meteo fetches,
// Vercel's default function timeout is short.
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
    const { stage } = parsed.data;
    const crop = findCropProfile(parsed.data.crop);
    if (!crop) {
      return NextResponse.json({ error: "unknown_crop", valid_crops: CROP_KEYS }, { status: 400 });
    }

    // Farmers plan field work across the working day, so evaluate a
    // longer activity window than the default situation call.
    const [situation, inputs] = await Promise.all([
      runPipeline({ activityKey: "field_work", durationMinutes: 120 }),
      loadFarmInputs(),
    ]);
    // Irrigation needs a temperature range and a rain record, from the station
    // or the regional model; without either there is no advice to give.
    if (!inputs) {
      return NextResponse.json({ error: "farm_inputs_unavailable" }, { status: 503 });
    }
    const advisory = buildFarmAdvisory(situation, crop, stage, inputs);

    return NextResponse.json({
      advisory,
      situation: {
        state: situation.state,
        quality: situation.quality,
        risk: situation.risk,
        current: situation.current,
        expected_peak: situation.expected_peak,
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
