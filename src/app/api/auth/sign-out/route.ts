import { NextRequest, NextResponse } from "next/server";
import { deleteSession, clearSessionCookie } from "@/lib/auth/logic";

export async function POST(req: NextRequest) {
  const token = req.cookies.get("afya_session")?.value;
  if (token) {
    try { await deleteSession(token); } catch { /* best-effort */ }
  }
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}
