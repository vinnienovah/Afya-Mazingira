// The daily alert check, with everything it touches passed in: the route
// supplies the pipeline, the database, Resend and web push, a test supplies
// fakes. Keeping the decisions here is what makes the run testable at all.

import {
  evaluateRule, firedOnDay, pickSubject, pickLines, pickPush,
} from "@/lib/afya/alert-engine";
import { t } from "@/lib/afya/i18n";
import type { ActivityPlan, NotificationRule, User } from "@/db/schema";
import type { DayPeak } from "@/lib/afya/alert-engine";
import type { Lang, SituationResult } from "@/lib/afya/types";

/** Whether a request carries the configured cron secret. */
export function authorized(secret: string | undefined, header: string | null): boolean {
  // No secret configured means no caller can prove itself: anyone who reaches
  // the endpoint could email every user, so every request is refused.
  if (!secret) return false;
  return header === `Bearer ${secret}`;
}

export interface AlertRunRecord {
  ran_at: Date;
  rules_evaluated: number;
  triggered: number;
  emails_sent: number;
  pushes_sent: number;
  errors: number;
}

export interface AlertRunDeps {
  now: number;
  /** The situation the rules are judged against. */
  situation: SituationResult;
  /** The same hour yesterday, for rules that compare against it. */
  yesterdayPeak: DayPeak | null;
  rules: NotificationRule[];
  /** The saved plans of every owner of a best_time rule. */
  plans: ActivityPlan[];
  owner: (userId: number) => Promise<User | undefined>;
  canEmail: boolean;
  sendEmail: (user: User, subject: string, lines: string[], url: string, cta: string, lang: Lang) => Promise<void>;
  /** How many of the user's browsers the push service accepted. */
  sendPush: (user: User, payload: { title: string; body: string; url: string }) => Promise<number>;
  markTriggered: (ruleId: number, at: Date) => Promise<void>;
  recordRun: (record: AlertRunRecord) => Promise<void>;
}

export interface AlertRunResult extends AlertRunRecord {
  email_configured: boolean;
  plans_checked: number;
  yesterday_recomputed: boolean;
  error_messages: string[];
}

export async function runAlertCheck(deps: AlertRunDeps): Promise<AlertRunResult> {
  const { now, situation, rules } = deps;

  const plansByUser = new Map<number, ActivityPlan[]>();
  for (const plan of deps.plans) {
    plansByUser.set(plan.user_id, [...(plansByUser.get(plan.user_id) ?? []), plan]);
  }

  const owners = new Map<number, User | undefined>();
  let triggered = 0;
  let emailsSent = 0;
  let pushesSent = 0;
  const errors: string[] = [];

  for (const rule of rules) {
    if (firedOnDay(rule, now)) continue;
    const content = evaluateRule(rule, situation, {
      now,
      yesterdayPeak: deps.yesterdayPeak,
      plans: plansByUser.get(rule.user_id) ?? [],
    });
    if (!content) continue;

    if (!owners.has(rule.user_id)) owners.set(rule.user_id, await deps.owner(rule.user_id));
    const user = owners.get(rule.user_id);
    if (!user) continue;
    triggered++;
    const lang: Lang = user.language === "sw" ? "sw" : "en";
    const subject = pickSubject(content, lang);

    if (deps.canEmail) {
      try {
        const cta = t(lang, content.url === "/plan" ? "alert_cta_plan" : "alert_cta_notifications");
        await deps.sendEmail(user, subject, pickLines(content, lang), content.url, cta, lang);
        emailsSent++;
      } catch (err) {
        errors.push(`rule ${rule.id} email: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
    try {
      pushesSent += await deps.sendPush(user, { title: subject, body: pickPush(content, lang), url: content.url });
    } catch (err) {
      errors.push(`rule ${rule.id} push: ${err instanceof Error ? err.message : "unknown"}`);
    }
    await deps.markTriggered(rule.id, new Date(now));
  }

  const record: AlertRunRecord = {
    ran_at: new Date(now),
    rules_evaluated: rules.length,
    triggered,
    emails_sent: emailsSent,
    pushes_sent: pushesSent,
    errors: errors.length,
  };
  try {
    await deps.recordRun(record);
  } catch (err) {
    // The alerts themselves have already gone out; losing the bookkeeping row
    // must not turn a successful run into a failed one.
    errors.push(`run record: ${err instanceof Error ? err.message : "unknown"}`);
  }

  return {
    ...record,
    email_configured: deps.canEmail,
    plans_checked: deps.plans.length,
    yesterday_recomputed: deps.yesterdayPeak !== null,
    error_messages: errors,
  };
}
