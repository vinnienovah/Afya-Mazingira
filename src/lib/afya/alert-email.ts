// Threshold/plan alert email delivery (Resend)
// Shares the same graceful-degradation and visual style as
// lib/auth/verification.ts, this is the second (and only other) place in
// the app that sends email.

import type { Lang } from "@/lib/afya/types";
import { appUrl } from "@/lib/app-url";

export function hasResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Text made safe to place inside the email's HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function sendAlertEmail(
  to: string,
  name: string,
  subject: string,
  // Paragraphs of HTML; any user-written text in them must already be escaped.
  bodyLines: string[],
  ctaHref: string,
  ctaLabel: string,
  lang: Lang,
): Promise<void> {
  const html = renderAlertEmailHtml(name, bodyLines, `${appUrl()}${ctaHref}`, ctaLabel, lang);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY!}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "AFYA MAZINGIRA <onboarding@resend.dev>",
      to: [to],
      subject: subject.replace(/[\r\n]+/g, " "),
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

// The name is whatever its owner typed at sign-up and this mail goes out from
// our address, so it is escaped: otherwise a user could put their own markup,
// and their own links, into an email AFYA MAZINGIRA signed.
export function renderAlertEmailHtml(
  name: string,
  // Paragraphs of HTML; any user-written text in them must already be escaped.
  bodyLines: string[],
  link: string,
  ctaLabel: string,
  lang: Lang,
): string {
  const greeting = lang === "sw" ? `Habari ${escapeHtml(name)},` : `Hi ${escapeHtml(name)},`;
  const bodyHtml = bodyLines.map((l) => `<p style="font-size:14px;color:#4a4a4a;line-height:1.6;margin:0 0 12px;">${l}</p>`).join("");

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
          ${bodyHtml}
          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#1F8A57;margin-top:8px;">
            <a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${ctaLabel}</a>
          </td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
