import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationRules, activityPlans, users, type ActivityPlan, type User } from "@/db/schema";
import { runPipeline } from "@/lib/afya/pipeline";
import {
  evaluateRule, firedOnDay, pickSubject, pickLines, pickPush, yesterdayPeakFrom,
} from "@/lib/afya/alert-engine";
import { sendAlertEmail, hasResendConfigured } from "@/lib/afya/alert-email";
import { t } from "@/lib/afya/i18n";
import { sendPushToUser } from "@/lib/push";
import type { Lang } from "@/lib/afya/types";

// Vercel Cron entry point, run once a day at 08:00 EAT (vercel.json; the
// Hobby plan allows no shorter interval). Vercel sends `Authorization: Bearer
// $CRON_SECRET` on scheduled runs. Without the secret the endpoint refuses
// every request: anyone who can call it can email every user.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const situation = await runPipeline();
  // The same forecast run from the station's record at this hour yesterday,
  // so heat rules can tell a rise from another day like the last.
  const dayBefore = now - 24 * 3600 * 1000;
  const yesterdayRun = await runPipeline({ anchorIso: new Date(dayBefore).toISOString() }).catch(() => null);
  const yesterdayPeak = yesterdayRun ? yesterdayPeakFrom(yesterdayRun, dayBefore) : null;

  const rules = await db.select().from(notificationRules).where(eq(notificationRules.enabled, true));
  const planOwners = [...new Set(rules.filter((r) => r.rule_type === "best_time").map((r) => r.user_id))];
  const plans = planOwners.length
    ? await db.select().from(activityPlans).where(inArray(activityPlans.user_id, planOwners))
    : [];
  const plansByUser = new Map<number, ActivityPlan[]>();
  for (const plan of plans) plansByUser.set(plan.user_id, [...(plansByUser.get(plan.user_id) ?? []), plan]);

  const canEmail = hasResendConfigured();
  const owners = new Map<number, User | undefined>();
  let triggered = 0;
  let emailsSent = 0;
  let pushesSent = 0;
  const errors: string[] = [];

  for (const rule of rules) {
    if (firedOnDay(rule, now)) continue;
    const content = evaluateRule(rule, situation, { now, yesterdayPeak, plans: plansByUser.get(rule.user_id) ?? [] });
    if (!content) continue;

    if (!owners.has(rule.user_id)) {
      const [owner] = await db.select().from(users).where(eq(users.id, rule.user_id)).limit(1);
      owners.set(rule.user_id, owner);
    }
    const user = owners.get(rule.user_id);
    if (!user) continue;
    triggered++;
    const lang: Lang = user.language === "sw" ? "sw" : "en";
    const subject = pickSubject(content, lang);

    if (canEmail) {
      try {
        const cta = t(lang, content.url === "/plan" ? "alert_cta_plan" : "alert_cta_notifications");
        await sendAlertEmail(user.email, user.name, subject, pickLines(content, lang), content.url, cta, lang);
        emailsSent++;
      } catch (err) {
        errors.push(`rule ${rule.id} email: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
    try {
      pushesSent += await sendPushToUser(user.id, { title: subject, body: pickPush(content, lang), url: content.url });
    } catch (err) {
      errors.push(`rule ${rule.id} push: ${err instanceof Error ? err.message : "unknown"}`);
    }
    await db.update(notificationRules).set({ last_triggered_at: new Date(now) }).where(eq(notificationRules.id, rule.id));
  }

  return NextResponse.json({
    ok: true,
    email_configured: canEmail,
    rules_evaluated: rules.length,
    plans_checked: plans.length,
    yesterday_recomputed: yesterdayPeak !== null,
    triggered,
    emails_sent: emailsSent,
    pushes_sent: pushesSent,
    errors: errors.length ? errors : undefined,
  });
}
