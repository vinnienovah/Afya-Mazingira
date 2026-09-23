import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, hasDatabase } from "@/db";
import { userPreferences, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { databaseUnavailable, readJsonBody } from "@/lib/http";

export async function GET() {
  if (!hasDatabase()) return databaseUnavailable();
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

// Only what the app reads back. user_preferences also carries units and
// notification_prefs, which nothing reads; the columns keep their defaults
// rather than accepting values that would never be used.
const UpdatePrefsSchema = z.object({
  language: z.enum(["en", "sw"]).optional(),
  preferred_activities: z.array(z.string()).optional(),
});

export async function PATCH(req: NextRequest) {
  if (!hasDatabase()) return databaseUnavailable();
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await readJsonBody(req, UpdatePrefsSchema);
  if ("response" in body) return body.response;

  const { language, preferred_activities } = body.data;

  // Update user language if provided
  if (language) {
    await db.update(users).set({ language }).where(eq(users.id, user.id));
  }

  // Upsert preferences
  const updateData: Record<string, unknown> = { updated_at: new Date() };
  if (language) updateData.language = language;
  if (preferred_activities) updateData.preferred_activities = preferred_activities;

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
      preferred_activities: preferred_activities ?? [],
    });
  }

  return NextResponse.json({ ok: true });
}
