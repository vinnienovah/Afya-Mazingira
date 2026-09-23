import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { alertRuns, notificationRules, activityPlans, users } from "@/db/schema";
import { runPipeline } from "@/lib/afya/pipeline";
import { yesterdayPeakFrom } from "@/lib/afya/alert-engine";
import { sendAlertEmail, hasResendConfigured } from "@/lib/afya/alert-email";
import { sendPushToUser } from "@/lib/push";
import { authorized, runAlertCheck } from "./run";

// Vercel Cron entry point, run once a day at 08:00 EAT (vercel.json; the
// Hobby plan allows no shorter interval). Vercel sends `Authorization: Bearer
// $CRON_SECRET` on scheduled runs. Without the secret the endpoint refuses
// every request: anyone who can call it can email every user.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!authorized(process.env.CRON_SECRET, req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const situation = await runPipeline();
  // The same forecast run from the station's record at this hour yesterday,
  // so heat rules can tell a rise from another day like the last.
  const dayBefore = now - 24 * 3600 * 1000;
  const yesterdayRun = await runPipeline({ anchorIso: new Date(dayBefore).toISOString() }).catch(() => null);

  const rules = await db.select().from(notificationRules).where(eq(notificationRules.enabled, true));
  const planOwners = [...new Set(rules.filter((r) => r.rule_type === "best_time").map((r) => r.user_id))];
  const plans = planOwners.length
    ? await db.select().from(activityPlans).where(inArray(activityPlans.user_id, planOwners))
    : [];

  const result = await runAlertCheck({
    now,
    situation,
    yesterdayPeak: yesterdayRun ? yesterdayPeakFrom(yesterdayRun, dayBefore) : null,
    rules,
    plans,
    owner: async (userId) => {
      const [owner] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return owner;
    },
    canEmail: hasResendConfigured(),
    sendEmail: (user, subject, lines, url, cta, lang) =>
      sendAlertEmail(user.email, user.name, subject, lines, url, cta, lang),
    sendPush: (user, payload) => sendPushToUser(user.id, payload),
    markTriggered: async (ruleId, at) => {
      await db.update(notificationRules).set({ last_triggered_at: at }).where(eq(notificationRules.id, ruleId));
    },
    recordRun: async (record) => {
      await db.insert(alertRuns).values(record);
    },
  });

  return NextResponse.json({
    ok: true,
    email_configured: result.email_configured,
    rules_evaluated: result.rules_evaluated,
    plans_checked: result.plans_checked,
    yesterday_recomputed: result.yesterday_recomputed,
    triggered: result.triggered,
    emails_sent: result.emails_sent,
    pushes_sent: result.pushes_sent,
    errors: result.error_messages.length ? result.error_messages : undefined,
  });
}
