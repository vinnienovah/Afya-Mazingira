import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { notificationRules } from "@/db/schema";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { runPipeline } from "@/lib/afya/pipeline";
import { evaluateRule, pickSubject, pickLines } from "@/lib/afya/alert-engine";
import { sendAlertEmail, hasResendConfigured } from "@/lib/afya/alert-email";
import type { Lang } from "@/lib/afya/types";
import { databaseUnavailable } from "@/lib/http";

// Manual "send now" for the signed-in user's own rules, bypasses the
// cooldown the daily cron respects, so a demo or a curious user doesn't have
// to wait for the next scheduled run to see a real email arrive. Only ever
// acts on the caller's own rules (session-authenticated), never anyone
// else's, this is a testing convenience, not a way to re-trigger the cron.
export const maxDuration = 30;

export async function POST() {
  if (!hasDatabase()) return databaseUnavailable();
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!hasResendConfigured()) {
    return NextResponse.json({ error: "email_not_configured", message: "RESEND_API_KEY is not set." }, { status: 503 });
  }

  const rules = await db
    .select()
    .from(notificationRules)
    .where(and(eq(notificationRules.user_id, user.id), eq(notificationRules.enabled, true)));

  if (!rules.length) {
    return NextResponse.json({ error: "no_rules", message: "Create a notification rule first." }, { status: 404 });
  }

  const situation = await runPipeline();
  const lang = (user.language as Lang) ?? "en";
  const triggered: string[] = [];

  for (const rule of rules) {
    const content = evaluateRule(rule, situation);
    if (!content) continue;
    await sendAlertEmail(
      user.email, user.name, pickSubject(content, lang), pickLines(content, lang),
      "/notifications", lang === "sw" ? "Angalia Arifa" : "View Notifications", lang,
    );
    triggered.push(rule.name);
  }

  if (!triggered.length) {
    // Nothing is actually true right now, send one clearly-labeled test
    // email instead of silently doing nothing, so "send test" always
    // produces a visible result.
    const testSubjectEn = "AFYA MAZINGIRA, test alert";
    const testSubjectSw = "AFYA MAZINGIRA, arifa ya majaribio";
    await sendAlertEmail(
      user.email, user.name,
      lang === "sw" ? testSubjectSw : testSubjectEn,
      lang === "sw"
        ? [
            "Hii ni barua pepe ya majaribio, hakuna sheria yako ya arifa iliyochochewa na hali za sasa.",
            `Hali ya sasa: ${situation.state.state_id}. Ubora wa data: ${situation.quality.status}.`,
          ]
        : [
            "This is a test email, none of your notification rules are actually triggered by current conditions.",
            `Current thermal risk: ${situation.risk.thermal}. Data quality: ${situation.quality.status}.`,
          ],
      "/notifications", lang === "sw" ? "Angalia Arifa" : "View Notifications", lang,
    );
    return NextResponse.json({ ok: true, triggered: [], test_email_sent: true });
  }

  return NextResponse.json({ ok: true, triggered, test_email_sent: false });
}
