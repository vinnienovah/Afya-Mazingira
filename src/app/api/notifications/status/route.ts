import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { alertRuns } from "@/db/schema";
import { hasResendConfigured } from "@/lib/auth/verification";
import { hasPushConfigured } from "@/lib/push";

// What this server can actually deliver, so the Notifications page can say so.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    database_configured: hasDatabase(),
    email_configured: hasResendConfigured(),
    push_configured: hasPushConfigured(),
    last_checked_at: await lastAlertRun(),
  });
}

/** When the daily alert check last ran here, or null if it never has. */
async function lastAlertRun(): Promise<string | null> {
  if (!hasDatabase()) return null;
  try {
    const [run] = await db
      .select({ ran_at: alertRuns.ran_at })
      .from(alertRuns)
      .orderBy(desc(alertRuns.ran_at))
      .limit(1);
    return run ? new Date(run.ran_at).toISOString() : null;
  } catch {
    // A database from before the alert_runs table simply has no run to report.
    return null;
  }
}
