import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { activityPlans } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";

const CreatePlanSchema = z.object({
  name: z.string().min(1).max(200),
  activity_type: z.string().min(1),
  activity_label: z.string().optional(),
  duration_minutes: z.number().int().min(5).max(480),
  available_start: z.string(),
  available_end: z.string(),
  preferred_start: z.string().optional(),
  last_result: z.unknown().optional(),
});

export async function GET() {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const plans = await db
    .select()
    .from(activityPlans)
    .where(eq(activityPlans.user_id, user.id))
    .orderBy(desc(activityPlans.updated_at));
  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = CreatePlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const [plan] = await db
    .insert(activityPlans)
    .values({ ...parsed.data, user_id: user.id })
    .returning();
  return NextResponse.json(plan, { status: 201 });
}
