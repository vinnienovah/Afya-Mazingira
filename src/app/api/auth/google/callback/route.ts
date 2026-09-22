import { NextRequest, NextResponse } from "next/server";
import { db, hasDatabase } from "@/db";
import { users, userPreferences, pushSubscriptions, notificationRules } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { createSession, deleteUserSessions, sessionCookie } from "@/lib/auth/logic";
import { hasProvenEmail } from "@/lib/auth/verification";
import {
  GOOGLE_STATE_COOKIE,
  exchangeCodeForProfile,
  clearStateCookie,
  decideGoogleLink,
} from "@/lib/auth/google";

export async function GET(req: NextRequest) {
  const signInUrl = new URL("/sign-in", req.url);
  const fail = (error: string) => {
    signInUrl.searchParams.set("error", error);
    const res = NextResponse.redirect(signInUrl);
    res.headers.set("Set-Cookie", clearStateCookie());
    return res;
  };

  try {
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const cookieState = req.cookies.get(GOOGLE_STATE_COOKIE)?.value;

    if (!code || !state || !cookieState || state !== cookieState) return fail("google_auth_failed");
    if (!hasDatabase()) return fail("service_unavailable");

    const profile = await exchangeCodeForProfile(code);
    const email = profile.email.trim().toLowerCase();

    const [linked] = await db.select().from(users).where(eq(users.google_id, profile.sub)).limit(1);
    const [byEmail] = linked
      ? []
      : await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).orderBy(users.id).limit(1);

    const decision = decideGoogleLink({
      googleEmailVerified: profile.email_verified === true,
      linked: !!linked,
      existing: byEmail
        ? { googleId: byEmail.google_id, emailProven: byEmail.email_verified && (await hasProvenEmail(byEmail.id)) }
        : null,
    });

    let user = linked;
    switch (decision) {
      case "refuse_unverified":
        return fail("google_email_unverified");
      case "refuse_conflict":
        return fail("google_account_conflict");
      case "link":
        [user] = await db
          .update(users)
          .set({ google_id: profile.sub, avatar_url: profile.picture ?? byEmail.avatar_url })
          .where(eq(users.id, byEmail.id))
          .returning();
        break;
      case "claim":
        // Whoever set this account up never proved the address, so nothing
        // they left that grants access or sends messages survives.
        await deleteUserSessions(byEmail.id);
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, byEmail.id));
        await db.delete(notificationRules).where(eq(notificationRules.user_id, byEmail.id));
        [user] = await db
          .update(users)
          .set({
            name: profile.name ?? byEmail.name,
            google_id: profile.sub,
            avatar_url: profile.picture ?? null,
            password_hash: null,
            password_salt: null,
            auth_provider: "google",
            email_verified: true,
            email_verified_at: new Date(),
          })
          .where(eq(users.id, byEmail.id))
          .returning();
        break;
      case "create":
        [user] = await db
          .insert(users)
          .values({
            name: profile.name ?? email.split("@")[0],
            email,
            google_id: profile.sub,
            avatar_url: profile.picture ?? null,
            auth_provider: "google",
            email_verified: true,
            email_verified_at: new Date(),
          })
          .returning();
        await db.insert(userPreferences).values({ user_id: user.id });
        break;
    }

    const token = await createSession(user.id);
    const res = NextResponse.redirect(new URL("/situation", req.url));
    res.headers.append("Set-Cookie", sessionCookie(token));
    res.headers.append("Set-Cookie", clearStateCookie());
    return res;
  } catch (err) {
    console.error("Google sign-in error:", err);
    return fail("google_auth_failed");
  }
}
