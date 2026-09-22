import { NextRequest, NextResponse } from "next/server";
import { hasDatabase } from "@/db";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { hasPushConfigured, sendPushToUser } from "@/lib/push";
import { databaseUnavailable } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { t } from "@/lib/afya/i18n";

// The Notifications page's "send test" button: one push to the signed-in
// user's own browsers. The daily alerts are pushed by the cron job.
export async function POST(req: NextRequest) {
  if (!hasDatabase()) return databaseUnavailable();
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!hasPushConfigured()) {
    return NextResponse.json(
      { error: "push_not_configured", message: "Browser push is not configured on this server (VAPID keys are not set)." },
      { status: 503 },
    );
  }
  const limited = rateLimit(req, "pushTest", String(user.id));
  if (limited) return limited;

  const lang = user.language === "sw" ? "sw" : "en";
  const sent = await sendPushToUser(user.id, {
    title: "AFYA MAZINGIRA",
    body: t(lang, "push_test_body"),
    url: "/notifications",
  });
  if (!sent) {
    return NextResponse.json(
      { error: "no_subscription", message: "No browser of yours is subscribed to push, or none could be reached." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, sent });
}
