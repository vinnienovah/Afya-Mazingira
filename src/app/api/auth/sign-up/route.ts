import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, hasDatabase } from "@/db";
import { users, userPreferences } from "@/db/schema";
import { sql } from "drizzle-orm";
import { hashPassword, createSession, sessionCookie } from "@/lib/auth/logic";
import {
  hasResendConfigured, createVerificationToken, sendVerificationEmail, verificationEmailCap,
} from "@/lib/auth/verification";
import { databaseUnavailable, readJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

const SignUpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  lang: z.enum(["en", "sw"]).default("en"),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "signUp");
  if (limited) return limited;
  if (!hasDatabase()) return databaseUnavailable();

  const body = await readJsonBody(req, SignUpSchema);
  if ("response" in body) return body.response;
  const { name, email, password, lang } = body.data;

  try {
    const existing = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (existing.length) {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }

    // Without an email provider (local development) there is no way to send
    // the link, so the account is verified straight away.
    const autoVerify = !hasResendConfigured();
    if (!autoVerify && (await verificationEmailCap(null)) === "global") {
      return NextResponse.json({ error: "email_quota" }, { status: 429, headers: { "Retry-After": "3600" } });
    }

    const { hash, salt } = hashPassword(password);
    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        password_hash: hash,
        password_salt: salt,
        email_verified: autoVerify,
        email_verified_at: autoVerify ? new Date() : null,
      })
      .returning();

    await db.insert(userPreferences).values({ user_id: newUser.id });

    if (autoVerify) {
      const token = await createSession(newUser.id);
      const res = NextResponse.json(
        { id: newUser.id, name: newUser.name, email: newUser.email, verified: true },
        { status: 201 },
      );
      res.headers.set("Set-Cookie", sessionCookie(token));
      return res;
    }

    const token = await createVerificationToken(newUser.id);
    let emailSendFailed = false;
    try {
      await sendVerificationEmail(newUser.email, newUser.name, token, lang);
    } catch (err) {
      emailSendFailed = true;
      console.warn("[afya] verification email send failed:", (err as Error).message);
    }

    return NextResponse.json(
      { verified: false, email: newUser.email, email_send_failed: emailSendFailed },
      { status: 201 },
    );
  } catch (err) {
    console.error("Sign-up error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
