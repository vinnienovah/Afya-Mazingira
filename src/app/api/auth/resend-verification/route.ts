import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { sql } from "drizzle-orm";
import {
  hasResendConfigured,
  createVerificationToken,
  sendVerificationEmail,
  lastTokenAgeMs,
  withinResendCooldown,
  verificationEmailCap,
} from "@/lib/auth/verification";
import { databaseUnavailable, readJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

const ResendSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  lang: z.enum(["en", "sw"]).default("en"),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "resendVerification");
  if (limited) return limited;

  const body = await readJsonBody(req, ResendSchema);
  if ("response" in body) return body.response;
  const { email, lang } = body.data;

  // Always return a generic success shape regardless of whether the
  // account exists, so this endpoint can't be used to enumerate emails.
  const generic = NextResponse.json({ ok: true });
  if (!hasResendConfigured()) return generic;
  if (!hasDatabase()) return databaseUnavailable();

  try {
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).orderBy(users.id).limit(1);
    if (!user || user.email_verified) return generic;

    const ageMs = await lastTokenAgeMs(user.id);
    if (withinResendCooldown(ageMs)) return generic;

    const cap = await verificationEmailCap(user.id);
    if (cap === "global") {
      return NextResponse.json({ error: "email_quota" }, { status: 429, headers: { "Retry-After": "3600" } });
    }
    // One address gets a few links an hour, however often it is asked for.
    if (cap === "address") return generic;

    const token = await createVerificationToken(user.id);
    try {
      await sendVerificationEmail(user.email, user.name, token, lang);
    } catch (err) {
      console.warn("[afya] resend-verification email failed:", (err as Error).message);
    }
    return generic;
  } catch (err) {
    console.error("Resend-verification error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
