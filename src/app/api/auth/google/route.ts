import { NextRequest, NextResponse } from "next/server";
import { hasGoogleCreds, generateState, googleAuthUrl, stateCookie } from "@/lib/auth/google";

export async function GET(req: NextRequest) {
  if (!hasGoogleCreds()) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("error", "google_not_configured");
    return NextResponse.redirect(url);
  }
  const state = generateState();
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.headers.set("Set-Cookie", stateCookie(state));
  return res;
}
