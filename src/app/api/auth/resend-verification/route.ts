import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  hasResendConfigured,
  createVerificationToken,
  sendVerificationEmail,
  lastTokenAgeMs,
  withinResendCooldown,
} from "@/lib/auth/verification";
import type { Lang } from "@/lib/afya/types";

const ResendSchema = z.object({
  email: z.string().email(),
  lang: z.enum(["en", "sw"]).default("en"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ResendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    const { email, lang } = parsed.data;

    // Always return a generic success shape regardless of whether the
    // account exists, so this endpoint can't be used to enumerate emails.
    const generic = NextResponse.json({ ok: true });

    if (!hasResendConfigured()) return generic;

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || user.email_verified) return generic;

    const ageMs = await lastTokenAgeMs(user.id);
    if (withinResendCooldown(ageMs)) return generic;

    const token = await createVerificationToken(user.id);
    try {
      await sendVerificationEmail(user.email, user.name, token, lang as Lang);
    } catch (err) {
      console.warn("[afya] resend-verification email failed:", (err as Error).message);
    }
    return generic;
  } catch (err) {
    console.error("Resend-verification error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
