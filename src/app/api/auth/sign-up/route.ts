import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users, userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, createSession, sessionCookie } from "@/lib/auth/logic";
import { hasResendConfigured, createVerificationToken, sendVerificationEmail } from "@/lib/auth/verification";
import { DEMO_EMAIL } from "@/lib/afya/constants";
import type { Lang } from "@/lib/afya/types";

const SignUpSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  lang: z.enum(["en", "sw"]).default("en"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = SignUpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { name, email, password, lang } = parsed.data;

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }

    // The public demo account, and any account created while no email
    // provider is configured (local dev), is auto-verified — mirrors this
    // codebase's convention of degrading gracefully rather than becoming
    // unusable when an external credential is absent.
    const autoVerify = email === DEMO_EMAIL || !hasResendConfigured();

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
      await sendVerificationEmail(newUser.email, newUser.name, token, lang as Lang);
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
