import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users, userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, createSession, sessionCookie } from "@/lib/auth/logic";

const SignUpSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = SignUpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { name, email, password } = parsed.data;

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }

    const { hash, salt } = hashPassword(password);
    const [newUser] = await db
      .insert(users)
      .values({ name, email, password_hash: hash, password_salt: salt })
      .returning();

    // Create default preferences
    await db.insert(userPreferences).values({ user_id: newUser.id });

    const token = await createSession(newUser.id);
    const res = NextResponse.json(
      { id: newUser.id, name: newUser.name, email: newUser.email },
      { status: 201 },
    );
    res.headers.set("Set-Cookie", sessionCookie(token));
    return res;
  } catch (err) {
    console.error("Sign-up error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
