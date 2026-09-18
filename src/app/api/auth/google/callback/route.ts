import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createSession, sessionCookie } from "@/lib/auth/logic";
import {
  GOOGLE_STATE_COOKIE,
  exchangeCodeForProfile,
  clearStateCookie,
} from "@/lib/auth/google";

export async function GET(req: NextRequest) {
  const signInUrl = new URL("/sign-in", req.url);

  try {
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const cookieState = req.cookies.get(GOOGLE_STATE_COOKIE)?.value;

    if (!code || !state || !cookieState || state !== cookieState) {
      signInUrl.searchParams.set("error", "google_auth_failed");
      const res = NextResponse.redirect(signInUrl);
      res.headers.set("Set-Cookie", clearStateCookie());
      return res;
    }

    const profile = await exchangeCodeForProfile(code);

    // Match an existing account by google_id first, then by email (links a
    // Google sign-in to a pre-existing password account for the same address).
    let [user] = await db.select().from(users).where(eq(users.google_id, profile.sub)).limit(1);

    if (!user) {
      const [byEmail] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
      if (byEmail) {
        [user] = await db
          .update(users)
          .set({
            google_id: profile.sub,
            avatar_url: profile.picture ?? byEmail.avatar_url,
          })
          .where(eq(users.id, byEmail.id))
          .returning();
      } else {
        [user] = await db
          .insert(users)
          .values({
            name: profile.name ?? profile.email.split("@")[0],
            email: profile.email,
            google_id: profile.sub,
            avatar_url: profile.picture ?? null,
            auth_provider: "google",
          })
          .returning();
        await db.insert(userPreferences).values({ user_id: user.id });
      }
    }

    const token = await createSession(user.id);
    const res = NextResponse.redirect(new URL("/situation", req.url));
    res.headers.append("Set-Cookie", sessionCookie(token));
    res.headers.append("Set-Cookie", clearStateCookie());
    return res;
  } catch (err) {
    console.error("Google sign-in error:", err);
    signInUrl.searchParams.set("error", "google_auth_failed");
    const res = NextResponse.redirect(signInUrl);
    res.headers.set("Set-Cookie", clearStateCookie());
    return res;
  }
}
