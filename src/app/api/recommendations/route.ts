import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPipeline } from "@/lib/afya/pipeline";
import { findBestTime } from "@/lib/afya/best-time-engine";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { db } from "@/db";
import { activityRecommendations } from "@/db/schema";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline — Vercel's default function timeout is short.
export const maxDuration = 30;

const RecommendSchema = z.object({
  activity: z.string().min(1),
  duration_minutes: z.number().int().min(5).max(480),
  window_start: z.string(), // ISO
  window_end: z.string(),   // ISO
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RecommendSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

    const { activity, duration_minutes, window_start, window_end } = parsed.data;

    const situation = await runPipeline({
      activityKey: activity,
      durationMinutes: duration_minutes,
    });

    const result = findBestTime(
      activity,
      duration_minutes,
      window_start,
      window_end,
      situation.forecast_series,
      situation.quality,
    );

    if (!result) {
      if (situation.quality.status === "POOR") {
        return NextResponse.json(
          { error: "quality_poor", message: "AFYA MAZINGIRA cannot make a high-confidence recommendation right now." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "no_window", message: "No suitable window found in the given range." }, { status: 404 });
    }

    // Log to recommendations audit table (best-effort, don't block response)
    const user = await getSessionFromCookies().catch(() => null);
    if (user) {
      db.insert(activityRecommendations).values({
        user_id: user.id,
        activity_type: activity,
        duration_minutes,
        available_start: window_start,
        available_end: window_end,
        recommended_start: result.recommended.start,
        recommended_end: result.recommended.end,
        risk_level: situation.risk.thermal,
        explanation_json: {
          reasons: result.recommended.reasons,
          quality: situation.quality.status,
          uncertainty: situation.risk.uncertainty,
        },
      }).catch(() => { /* non-blocking */ });
    }

    return NextResponse.json({ result, situation: {
      state: situation.state,
      quality: situation.quality,
      risk: situation.risk,
      expected_peak: situation.expected_peak,
    } });
  } catch (err) {
    console.error("Recommendation API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
