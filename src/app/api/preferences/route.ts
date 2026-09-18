import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { userPreferences, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";

export async function GET() {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.user_id, user.id));

  return NextResponse.json({
    language: user.language,
    name: user.name,
    email: user.email,
    preferences: prefs ?? null,
  });
}

const UpdatePrefsSchema = z.object({
  language: z.enum(["en", "sw"]).optional(),
  units: z.enum(["C", "F"]).optional(),
  preferred_activities: z.array(z.string()).optional(),
  notification_prefs: z.record(z.string(), z.boolean()).optional(),
});

export async function PATCH(req: NextRequest) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = UpdatePrefsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { language, units, preferred_activities, notification_prefs } = parsed.data;

  // Update user language if provided
  if (language) {
    await db.update(users).set({ language }).where(eq(users.id, user.id));
  }

  // Upsert preferences
  const updateData: Record<string, unknown> = { updated_at: new Date() };
  if (language) updateData.language = language;
  if (units) updateData.units = units;
  if (preferred_activities) updateData.preferred_activities = preferred_activities;
  if (notification_prefs) updateData.notification_prefs = notification_prefs;

  const [existing] = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(eq(userPreferences.user_id, user.id));

  if (existing) {
    await db.update(userPreferences).set(updateData).where(eq(userPreferences.user_id, user.id));
  } else {
    await db.insert(userPreferences).values({
      user_id: user.id,
      language: language ?? "en",
      units: units ?? "C",
      preferred_activities: preferred_activities ?? [],
      notification_prefs: notification_prefs ?? {},
    });
  }

  return NextResponse.json({ ok: true });
}
