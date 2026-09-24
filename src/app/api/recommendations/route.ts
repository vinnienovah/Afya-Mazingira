import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/afya/pipeline";
import {
  checkPlanWindow, planActivity, RecommendationRequestSchema,
  type PlannedWindow, type RecommendationRequest,
} from "@/lib/afya/activity-plan";
import { activityRecommendations } from "@/db/schema";
import type { SituationResult } from "@/lib/afya/types";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline, Vercel's default function timeout is short.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "The request body is not valid JSON." }, { status: 400 });
  }
  const parsed = RecommendationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "invalid_input",
      message: "Give a known activity, a duration of 5 to 480 minutes, and ISO start and end times.",
      fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))],
    }, { status: 400 });
  }
  const request = parsed.data;

  // A range that has already passed is refused before any forecast is run.
  const early = checkPlanWindow(request, Date.now());
  if (early) {
    return NextResponse.json({ error: early.error, message: early.message, details: early.details }, { status: early.status });
  }

  try {
    const situation = await runPipeline({
      activityKey: request.activity,
      durationMinutes: request.duration_minutes,
    });
    const outcome = planActivity(request, {
      station: situation.forecast_series,
      quality: situation.quality,
      rain: { probability: situation.risk.rain_probability, at: situation.current.time },
      regional: situation.regional_outlook,
    }, Date.now());
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, message: outcome.message, details: outcome.details }, { status: outcome.status });
    }

    await logRecommendation(request, outcome.result, situation);

    return NextResponse.json({
      result: outcome.result,
      source: outcome.result.source,
      situation: {
        state: situation.state,
        quality: situation.quality,
        risk: situation.risk,
        expected_peak: situation.expected_peak,
      },
    });
  } catch (err) {
    console.error("Recommendation API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// The audit row is optional: without a database, or signed out, the
// recommendation is still returned. The database and session modules are
// loaded only here because loading them fails when DATABASE_URL is unset.
async function logRecommendation(request: RecommendationRequest, result: PlannedWindow, situation: SituationResult) {
  if (!process.env.DATABASE_URL) return;
  try {
    const [{ getSessionFromCookies }, { db }] = await Promise.all([import("@/lib/auth/logic"), import("@/db")]);
    const user = await getSessionFromCookies();
    if (!user) return;
    await db.insert(activityRecommendations).values({
      user_id: user.id,
      activity_type: request.activity,
      duration_minutes: request.duration_minutes,
      available_start: request.window_start,
      available_end: request.window_end,
      recommended_start: result.recommended.start,
      recommended_end: result.recommended.end,
      risk_level: result.recommended.risk,
      explanation_json: {
        reasons: result.recommended.reasons,
        source: result.source,
        coverage: result.coverage,
        station_quality: situation.quality.status,
        uncertainty: situation.risk.uncertainty,
      },
    });
  } catch (err) {
    console.warn("[afya] recommendation not logged:", err instanceof Error ? err.message : err);
  }
}
