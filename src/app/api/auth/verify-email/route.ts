import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { consumeVerificationToken } from "@/lib/auth/verification";
import { databaseUnavailable, readJsonBody } from "@/lib/http";

const VerifySchema = z.object({ token: z.string().min(10) });

export async function POST(req: NextRequest) {
  if (!hasDatabase()) return databaseUnavailable();
  const body = await readJsonBody(req, VerifySchema);
  if ("response" in body) return body.response;

  try {
    const result = await consumeVerificationToken(body.data.token);
    if (!result) {
      return NextResponse.json({ error: "token_invalid_or_expired" }, { status: 400 });
    }

    const [user] = await db.select().from(users).where(eq(users.id, result.userId)).limit(1);
    return NextResponse.json({ ok: true, email: user?.email });
  } catch (err) {
    console.error("Verify-email error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
