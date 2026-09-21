import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pushSubscriptions, notificationRules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { runPipeline } from "@/lib/afya/pipeline";
import { STATES } from "@/lib/afya/constants";

// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline — Vercel's default function timeout is short.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Fetch user's push subscriptions
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.user_id, user.id));

  const hasVapid = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const situation = await runPipeline();

  // Build a useful environmental notification payload
  const notificationPayload = {
    title: "AFYA MAZINGIRA",
    body: `Environmental state: ${STATES[situation.state.state_id].name}. ` +
      `Expected peak WBGT ${situation.expected_peak?.wbgt_c ?? "—"}°C. ` +
      `Best window: ${situation.best_time
        ? `${new Date(situation.best_time.recommended.start).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}`
        : "—"}.`,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-72.png",
    data: { url: "/situation" },
  };

  if (!subs.length) {
    return NextResponse.json({ error: "no_subscription", message: "No push subscription found for this user." }, { status: 404 });
  }

  if (!hasVapid) {
    // Demo mode: simulate push safely
    return NextResponse.json({
      ok: true,
      demo_mode: true,
      sent: 0,
      simulated_notification: notificationPayload,
      message: "Demo mode: notification simulated locally. Configure VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY for real push delivery.",
    });
  }

  // Real push via web-push
  try {
    const webpush = await import("web-push");
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL ?? "https://afya-mazingira.vercel.app",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );

    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(notificationPayload),
        );
        sent++;
      } catch { /* individual subscription failure is non-fatal */ }
    }

    return NextResponse.json({ ok: true, sent, demo_mode: false });
  } catch (err) {
    console.error("Push send error:", err);
    return NextResponse.json({ error: "push_failed" }, { status: 500 });
  }
}
