import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activityPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { runPipeline } from "@/lib/afya/pipeline";
import { findBestTime } from "@/lib/afya/best-time-engine";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline, Vercel's default function timeout is short.
export const maxDuration = 30;

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

  const situation = await runPipeline({ activityKey: plan.activity_type, durationMinutes: plan.duration_minutes });
  const result = findBestTime(
    plan.activity_type,
    plan.duration_minutes,
    plan.available_start,
    plan.available_end,
    situation.forecast_series,
    situation.quality,
  );

  const [updated] = await db
    .update(activityPlans)
    .set({ last_result: result as unknown as Record<string, unknown>, updated_at: new Date() })
    .where(eq(activityPlans.id, planId))
    .returning();

  return NextResponse.json({ ...updated, result });
}
