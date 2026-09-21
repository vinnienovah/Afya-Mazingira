import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationRules, activityPlans, users } from "@/db/schema";
import { runPipeline } from "@/lib/afya/pipeline";
import { evaluateRule, checkPlanImpact, coolingDown, pickSubject, pickLines } from "@/lib/afya/alert-engine";
import { sendAlertEmail, hasResendConfigured } from "@/lib/afya/alert-email";
import type { Lang } from "@/lib/afya/types";

// Vercel Cron entry point (see vercel.json — runs once daily; the Hobby plan
// doesn't allow a shorter interval, so this is a daily threshold/plan check,
// not real-time push). Protected by CRON_SECRET: Vercel automatically sends
// `Authorization: Bearer $CRON_SECRET` on scheduled invocations once that
// env var is set — without it, this endpoint would let anyone trigger an
// email blast to every user, so treat CRON_SECRET as required in production.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const situation = await runPipeline();
  const canEmail = hasResendConfigured();
  let sent = 0;
  let evaluated = 0;
  const errors: string[] = [];

  // ── Rule-based threshold alerts ─────────────────────────────────────────
  const rules = await db.select().from(notificationRules).where(eq(notificationRules.enabled, true));
  for (const rule of rules) {
    evaluated++;
    if (coolingDown(rule)) continue;
    const content = evaluateRule(rule, situation);
    if (!content) continue;

    const [user] = await db.select().from(users).where(eq(users.id, rule.user_id)).limit(1);
    if (!user) continue;
    const lang = (user.language as Lang) ?? "en";

    if (canEmail) {
      try {
        await sendAlertEmail(
          user.email, user.name, pickSubject(content, lang), pickLines(content, lang),
          "/notifications", lang === "sw" ? "Angalia Arifa" : "View Notifications", lang,
        );
        sent++;
      } catch (err) {
        errors.push(`rule ${rule.id}: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
    await db.update(notificationRules).set({ last_triggered_at: new Date() }).where(eq(notificationRules.id, rule.id));
  }

  // ── Saved-plan impact alerts ─────────────────────────────────────────────
  const plans = await db.select().from(activityPlans);
  for (const plan of plans) {
    const content = checkPlanImpact(plan, situation);
    if (!content) continue;

    const [user] = await db.select().from(users).where(eq(users.id, plan.user_id)).limit(1);
    if (!user) continue;
    const lang = (user.language as Lang) ?? "en";

    if (canEmail) {
      try {
        await sendAlertEmail(
          user.email, user.name, pickSubject(content, lang), pickLines(content, lang),
          "/plan", lang === "sw" ? "Fungua Mpango" : "Open Plan", lang,
        );
        sent++;
      } catch (err) {
        errors.push(`plan ${plan.id}: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    email_configured: canEmail,
    rules_evaluated: evaluated,
    plans_checked: plans.length,
    sent,
    errors: errors.length ? errors : undefined,
  });
}
