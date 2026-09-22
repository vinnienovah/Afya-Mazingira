import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activityPlans } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { PlanCreateSchema } from "@/lib/afya/activity-plan";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "The request body is not valid JSON." }, { status: 400 });
  }
  const parsed = PlanCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", message: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const [plan] = await db
    .insert(activityPlans)
    .values({ ...parsed.data, user_id: user.id })
    .returning();
  return NextResponse.json(plan, { status: 201 });
}
