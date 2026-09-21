// Google OAuth 2.0 (Authorization Code flow)
// No SDK dependency, plain fetch against Google's documented endpoints,
// consistent with the other external adapters in this codebase.

import crypto from "crypto";

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
  return `${GOOGLE_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
}

export function clearStateCookie(): string {
  return `${GOOGLE_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
