// Google OAuth 2.0 (Authorization Code flow)
// No SDK dependency, plain fetch against Google's documented endpoints,
// consistent with the other external adapters in this codebase.

import crypto from "crypto";
import { secureAttribute } from "@/lib/auth/cookies";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_STATE_COOKIE = "afya_google_state";

export function hasGoogleCreds(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function generateState(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function googleAuthUrl(state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange HTTP ${tokenRes.status}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Google token exchange missing access_token");

  const profileRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!profileRes.ok) {
    throw new Error(`Google userinfo HTTP ${profileRes.status}`);
  }
  const profile = (await profileRes.json()) as GoogleProfile;
  if (!profile.sub || !profile.email) throw new Error("Google userinfo missing sub/email");
  return profile;
}

export function stateCookie(state: string): string {
  return `${GOOGLE_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureAttribute()}`;
}

export function clearStateCookie(): string {
  return `${GOOGLE_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute()}`;
}

// Linking a Google sign-in to accounts

export type GoogleLinkDecision =
  | "sign_in"             // this Google account is already linked
  | "create"              // nobody uses the address yet
  | "link"                // the owner proved the address with our own link: attach Google
  | "claim"               // nobody ever proved the address: Google's proof wins, the password goes
  | "refuse_unverified"   // Google has not verified the address itself
  | "refuse_conflict";    // the address belongs to a different Google account

export interface GoogleLinkInput {
  googleEmailVerified: boolean;
  /** An account already carries this Google id */
  linked: boolean;
  /** The account that already uses the Google address, if any */
  existing: { googleId: string | null; emailProven: boolean } | null;
}

/**
 * How a Google sign-in maps onto existing accounts. An account found by email
 * is linked as it stands only when its owner followed one of our verification
 * links. Otherwise whoever created it never showed they own the address:
 * linking it with its password intact would let someone register a victim's
 * address with a password of their own, wait for the victim to sign in with
 * Google, and then sign in with that password. So the account is claimed
 * instead: its password, sessions and alert subscriptions are dropped and the
 * address counts as verified by Google. Refusing would also be safe, but
 * would lock the real owner out of their own address for good.
 */
export function decideGoogleLink(input: GoogleLinkInput): GoogleLinkDecision {
  if (input.linked) return "sign_in";
  if (!input.googleEmailVerified) return "refuse_unverified";
  if (!input.existing) return "create";
  if (input.existing.googleId) return "refuse_conflict";
  return input.existing.emailProven ? "link" : "claim";
}
