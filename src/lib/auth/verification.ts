// Email verification tokens + delivery (Resend)
// Follows the same graceful-degradation convention as the other external
// adapters in this codebase: when RESEND_API_KEY is absent, accounts are
// auto-verified (dev / demo mode) instead of leaving sign-up unusable.

import crypto from "crypto";
import { db } from "@/db";
import { emailVerificationTokens, users } from "@/db/schema";
import { eq, and, isNull, isNotNull, desc, gte, count } from "drizzle-orm";
import type { Lang } from "@/lib/afya/types";

const TOKEN_TTL_MS = 24 * 3600 * 1000; // 24 hours
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between resends

// Sign-up and resend both send mail to an address someone typed in. Counted
// from the tokens table, so the caps hold across server instances.
export const MAX_EMAILS_PER_ADDRESS_PER_HOUR = 3;
export const MAX_EMAILS_PER_HOUR = 30;

export function hasResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function createVerificationToken(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.insert(emailVerificationTokens).values({ token, user_id: userId, expires_at: expiresAt });
  return token;
}

/** Returns the most recent unconsumed token's age in ms, or null if none / already consumed. */
export async function lastTokenAgeMs(userId: number): Promise<number | null> {
  const [row] = await db
    .select({ created_at: emailVerificationTokens.created_at })
    .from(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.user_id, userId), isNull(emailVerificationTokens.consumed_at)))
    .orderBy(desc(emailVerificationTokens.created_at))
    .limit(1);
  if (!row) return null;
  return Date.now() - new Date(row.created_at).getTime();
}

export function withinResendCooldown(ageMs: number | null): boolean {
  return ageMs !== null && ageMs < RESEND_COOLDOWN_MS;
}

export type EmailCap = "ok" | "address" | "global";

/** Which cap, if any, stops one more verification email. */
export function emailCap(counts: { addressLastHour: number; allLastHour: number }): EmailCap {
  if (counts.allLastHour >= MAX_EMAILS_PER_HOUR) return "global";
  if (counts.addressLastHour >= MAX_EMAILS_PER_ADDRESS_PER_HOUR) return "address";
  return "ok";
}

/** The cap for a new email to this user (null for an account not created yet). */
export async function verificationEmailCap(userId: number | null): Promise<EmailCap> {
  const since = new Date(Date.now() - 3600 * 1000);
  const [all] = await db
    .select({ n: count() })
    .from(emailVerificationTokens)
    .where(gte(emailVerificationTokens.created_at, since));
  let addressLastHour = 0;
  if (userId !== null) {
    const [mine] = await db
      .select({ n: count() })
      .from(emailVerificationTokens)
      .where(and(eq(emailVerificationTokens.user_id, userId), gte(emailVerificationTokens.created_at, since)));
    addressLastHour = Number(mine?.n ?? 0);
  }
  return emailCap({ addressLastHour, allLastHour: Number(all?.n ?? 0) });
}

/** Whether the user once followed one of our verification links. */
export async function hasProvenEmail(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: emailVerificationTokens.id })
    .from(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.user_id, userId), isNotNull(emailVerificationTokens.consumed_at)))
    .limit(1);
  return !!row;
}

export async function consumeVerificationToken(token: string): Promise<{ userId: number } | null> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token))
    .limit(1);
  if (!row || row.consumed_at || row.expires_at < now) return null;

  await db
    .update(emailVerificationTokens)
    .set({ consumed_at: now })
    .where(eq(emailVerificationTokens.id, row.id));
  await db
    .update(users)
    .set({ email_verified: true, email_verified_at: now })
    .where(eq(users.id, row.user_id));

  return { userId: row.user_id };
}

// Resend delivery

export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string,
  lang: Lang,
): Promise<void> {
  const link = `${appUrl()}/verify-email?token=${token}`;
  const subject = lang === "sw" ? "Thibitisha barua pepe yako, AFYA MAZINGIRA" : "Verify your email, AFYA MAZINGIRA";
  const html = renderVerificationEmailHtml(name, link, lang);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY!}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "AFYA MAZINGIRA <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text made safe to place in HTML, both between tags and inside attribute quotes. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// The name is whatever was typed at sign-up, and the email goes to whatever
// address was typed with it, so it is escaped: otherwise anyone could send
// their own HTML from our address to anyone.
export function renderVerificationEmailHtml(name: string, link: string, lang: Lang): string {
  const safeName = escapeHtml(name.replace(/\s+/g, " ").trim());
  const greeting = lang === "sw" ? `Habari ${safeName},` : `Hi ${safeName},`;
  const body = lang === "sw"
    ? "Bofya kitufe hapa chini kuthibitisha barua pepe yako na kuwezesha akaunti yako ya AFYA MAZINGIRA. Kiungo hiki kitaisha baada ya saa 24."
    : "Click the button below to verify your email and activate your AFYA MAZINGIRA account. This link expires in 24 hours.";
  const cta = lang === "sw" ? "Thibitisha Barua Pepe" : "Verify Email";
  const ignore = lang === "sw"
    ? "Kama hukuunda akaunti hii, unaweza kupuuza barua pepe hii."
    : "If you didn't create this account, you can safely ignore this email.";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#103D2C;padding:24px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;">AFYA MAZINGIRA</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="font-size:15px;color:#1a1a1a;margin:0 0 12px;">${greeting}</p>
          <p style="font-size:14px;color:#4a4a4a;line-height:1.6;margin:0 0 24px;">${body}</p>
          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#1F8A57;">
            <a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${cta}</a>
          </td></tr></table>
          <p style="font-size:12px;color:#9a9a9a;line-height:1.5;margin:24px 0 0;">${ignore}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
