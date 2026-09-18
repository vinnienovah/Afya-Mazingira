import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { notificationRules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";

const UpdateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  rule_type: z.enum(["state_transition", "exposure_tier", "best_time", "rain", "data_quality"]).optional(),
  activity_type: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ruleId = parseInt(id, 10);
  if (isNaN(ruleId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = UpdateRuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const [updated] = await db
    .update(notificationRules)
    .set({ ...parsed.data, updated_at: new Date() })
    .where(and(eq(notificationRules.id, ruleId), eq(notificationRules.user_id, user.id)))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ruleId = parseInt(id, 10);
  if (isNaN(ruleId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const deleted = await db
    .delete(notificationRules)
    .where(and(eq(notificationRules.id, ruleId), eq(notificationRules.user_id, user.id)))
    .returning();
  if (!deleted.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
