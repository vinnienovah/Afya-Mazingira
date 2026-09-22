import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { sql } from "drizzle-orm";
import { verifyPassword, createSession, sessionCookie } from "@/lib/auth/logic";
import { databaseUnavailable, readJsonBody } from "@/lib/http";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

const SignInSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "signIn");
  if (limited) return limited;
  if (!hasDatabase()) return databaseUnavailable();

  const body = await readJsonBody(req, SignInSchema);
  if ("response" in body) return body.response;
  const { email, password } = body.data;

  // Guessing one account's password from many addresses is slowed down too.
  const accountLimited = rateLimitKey("signInAccount", email);
  if (accountLimited) return accountLimited;

  try {
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).orderBy(users.id).limit(1);
    if (!user || !user.password_hash || !user.password_salt) {
      // Either no account, or the account was created via Google sign-in
      // and has no local password to check against.
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    if (!verifyPassword(password, user.password_hash, user.password_salt)) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    if (!user.email_verified) {
      return NextResponse.json({ error: "email_not_verified", email: user.email }, { status: 403 });
    }

    const token = await createSession(user.id);
    const res = NextResponse.json({ id: user.id, name: user.name, email: user.email });
    res.headers.set("Set-Cookie", sessionCookie(token));
    return res;
  } catch (err) {
    console.error("Sign-in error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
