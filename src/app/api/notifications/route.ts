import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { notificationRules } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";

const CreateRuleSchema = z.object({
  name: z.string().min(1).max(200),
  rule_type: z.enum(["state_transition", "exposure_tier", "best_time", "rain", "data_quality"]),
  activity_type: z.string().optional(),
  enabled: z.boolean().default(true),
});

export async function GET() {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const rules = await db
    .select()
    .from(notificationRules)
    .where(eq(notificationRules.user_id, user.id))
    .orderBy(desc(notificationRules.updated_at));
  return NextResponse.json(rules);
}

export async function POST(req: NextRequest) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const [rule] = await db
    .insert(notificationRules)
    .values({ ...parsed.data, user_id: user.id })
    .returning();
  return NextResponse.json(rule, { status: 201 });
}
