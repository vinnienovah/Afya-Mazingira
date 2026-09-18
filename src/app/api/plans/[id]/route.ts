import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { activityPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";

const UpdatePlanSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  activity_type: z.string().min(1).optional(),
  activity_label: z.string().optional(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  available_start: z.string().optional(),
  available_end: z.string().optional(),
  preferred_start: z.string().nullable().optional(),
  last_result: z.unknown().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const planId = parseInt(id, 10);
  if (isNaN(planId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = UpdatePlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const [updated] = await db
    .update(activityPlans)
    .set({ ...parsed.data, updated_at: new Date() })
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
