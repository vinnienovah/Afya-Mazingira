import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activityPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { PlanUpdateSchema, rangeProblem } from "@/lib/afya/activity-plan";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const planId = parseInt(id, 10);
  if (isNaN(planId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "The request body is not valid JSON." }, { status: 400 });
  }
  const parsed = PlanUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const changes = parsed.data;

  const [plan] = await db
    .select()
    .from(activityPlans)
    .where(and(eq(activityPlans.id, planId), eq(activityPlans.user_id, user.id)));
  if (!plan) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A change to one end of the range is checked against the other end as stored.
  const start = changes.available_start ?? plan.available_start;
  const end = changes.available_end ?? plan.available_end;
  const problem = rangeProblem(Date.parse(start), Date.parse(end), changes.duration_minutes ?? plan.duration_minutes);
  if (problem) return NextResponse.json({ error: problem.error, message: problem.message }, { status: 400 });

  // A saved window belongs to the plan it was found for: when the activity,
  // length or range changes without a new result, the old one is dropped.
  const reshaped =
    (changes.activity_type !== undefined && changes.activity_type !== plan.activity_type) ||
    (changes.duration_minutes !== undefined && changes.duration_minutes !== plan.duration_minutes) ||
    start !== plan.available_start ||
    end !== plan.available_end;
  const update = { ...changes, updated_at: new Date() };
  if (changes.last_result === undefined && reshaped) update.last_result = null;

  const [updated] = await db
    .update(activityPlans)
    .set(update)
    .where(and(eq(activityPlans.id, planId), eq(activityPlans.user_id, user.id)))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const planId = parseInt(id, 10);
  if (isNaN(planId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const deleted = await db
    .delete(activityPlans)
    .where(and(eq(activityPlans.id, planId), eq(activityPlans.user_id, user.id)))
    .returning();
  if (!deleted.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
