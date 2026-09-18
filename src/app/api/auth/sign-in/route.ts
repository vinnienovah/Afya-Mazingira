import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, createSession, sessionCookie } from "@/lib/auth/logic";

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = SignInSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { email, password } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
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
