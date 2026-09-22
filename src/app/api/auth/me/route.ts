import { NextResponse } from "next/server";
import { hasDatabase } from "@/db";
import { getSessionFromCookies } from "@/lib/auth/logic";

export async function GET() {
  // Without a database no session can be checked, which is the same as signed out.
  const user = hasDatabase() ? await getSessionFromCookies() : null;
  // Signed out is a normal answer here, not an error.
  if (!user) return NextResponse.json(null);
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    language: user.language,
    created_at: user.created_at,
    avatar_url: user.avatar_url,
    auth_provider: user.auth_provider,
  });
}
