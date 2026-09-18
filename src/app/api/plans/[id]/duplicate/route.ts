import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activityPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const planId = parseInt(id, 10);
  if (isNaN(planId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [orig] = await db
    .select()
    .from(activityPlans)
    .where(and(eq(activityPlans.id, planId), eq(activityPlans.user_id, user.id)));

  if (!orig) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [copy] = await db
    .insert(activityPlans)
    .values({
      user_id: user.id,
      name: `${orig.name} (copy)`,
      activity_type: orig.activity_type,
      activity_label: orig.activity_label,
      duration_minutes: orig.duration_minutes,
      available_start: orig.available_start,
      available_end: orig.available_end,
      preferred_start: orig.preferred_start,
      last_result: orig.last_result,
    })
    .returning();

  return NextResponse.json(copy, { status: 201 });
}
