import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activityPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { runPipeline } from "@/lib/afya/pipeline";
import { checkPlanWindow, planActivity, RecommendationRequestSchema } from "@/lib/afya/activity-plan";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline, Vercel's default function timeout is short.
export const maxDuration = 30;

// Re-plans a saved plan against the latest forecasts. The saved result is
// replaced only by a new one: when no window can be found (the range has
// passed, say) the plan keeps the result it had and the reason is returned.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const planId = parseInt(id, 10);
  if (isNaN(planId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [plan] = await db
    .select()
    .from(activityPlans)
    .where(and(eq(activityPlans.id, planId), eq(activityPlans.user_id, user.id)));

  if (!plan) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = RecommendationRequestSchema.safeParse({
    activity: plan.activity_type,
    duration_minutes: plan.duration_minutes,
    window_start: plan.available_start,
    window_end: plan.available_end,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_plan", message: "This plan has an activity or time the planner does not accept. Edit it and save it again." },
      { status: 400 },
    );
  }

  const early = checkPlanWindow(parsed.data, Date.now());
  if (early) {
    return NextResponse.json({ error: early.error, message: early.message, details: early.details }, { status: early.status });
  }

  const situation = await runPipeline({ activityKey: plan.activity_type, durationMinutes: plan.duration_minutes });
  const outcome = planActivity(parsed.data, {
    station: situation.forecast_series,
    quality: situation.quality,
    rain: { probability: situation.risk.rain_probability, at: situation.current.time },
    regional: situation.regional_outlook,
  }, Date.now());
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, message: outcome.message, details: outcome.details }, { status: outcome.status });
  }

  const [updated] = await db
    .update(activityPlans)
    .set({ last_result: outcome.result, updated_at: new Date() })
    .where(and(eq(activityPlans.id, planId), eq(activityPlans.user_id, user.id)))
    .returning();

  return NextResponse.json({
    ...updated,
    result: outcome.result,
    source: outcome.result.source,
    situation: { quality: situation.quality },
  });
}
