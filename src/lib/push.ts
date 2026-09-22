// Web push to a user's subscribed browsers (VAPID, via web-push).
// Without VAPID keys nothing is sent and callers get 0, so the daily alerts
// still go out by email alone.

import { eq, inArray } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { pushSubscriptions, type PushSubscription } from "@/db/schema";

export interface PushPayload {
  title: string;
  body: string;
  /** Page to open when the notification is clicked; a path on this site */
  url?: string;
}

export interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** The VAPID keys, or null when push is not configured. */
export function vapidDetails(): VapidDetails | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  // Push services require a mailto: or https: contact.
  const contact = process.env.VAPID_EMAIL?.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const subject = contact
    ? /^(?:mailto:|https:)/.test(contact) ? contact : `mailto:${contact}`
    : appUrl?.startsWith("https:") ? appUrl : "https://afya-mazingira.vercel.app";
  return { subject, publicKey, privateKey };
}

export function hasPushConfigured(): boolean {
  return vapidDetails() !== null;
}

/** Sends one notification; resolves when the push service accepts it. */
export type PushSender = (subscription: PushSubscription, body: string, vapid: VapidDetails) => Promise<unknown>;

const sendWithWebPush: PushSender = async (subscription, body, vapid) => {
  const webpush = await import("web-push");
  return webpush.sendNotification(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    body,
    // Alerts older than six hours are no longer worth showing.
    { vapidDetails: vapid, TTL: 6 * 3600, timeout: 10_000 },
  );
};

function statusCode(error: unknown): number | null {
  const code = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === "number" ? code : null;
}

/**
 * Sends the payload to each subscription. Returns how many the push services
 * accepted, and which subscriptions they reported as gone (404 or 410): the
 * browser unsubscribed or the subscription expired.
 */
export async function deliverPush(
  subscriptions: PushSubscription[],
  payload: PushPayload,
  vapid: VapidDetails,
  send: PushSender = sendWithWebPush,
): Promise<{ sent: number; gone: number[] }> {
  const url = payload.url?.startsWith("/") && !payload.url.startsWith("//") ? payload.url : "/notifications";
  const body = JSON.stringify({ title: payload.title, body: payload.body, url });
  const results = await Promise.allSettled(subscriptions.map((sub) => send(sub, body, vapid)));

  let sent = 0;
  const gone: number[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      sent++;
      return;
    }
    const status = statusCode(result.reason);
    if (status === 404 || status === 410) gone.push(subscriptions[i].id);
    else console.warn("[afya-push] delivery failed:", status ?? (result.reason instanceof Error ? result.reason.message : "unknown"));
  });
  return { sent, gone };
}

/**
 * Pushes a notification to every browser the user has subscribed. Returns the
 * number of pushes sent: 0, without error, when VAPID keys or the database
 * are not configured. Subscriptions the push service reports as gone are
 * deleted.
 */
export async function sendPushToUser(userId: number, payload: PushPayload): Promise<number> {
  const vapid = vapidDetails();
  if (!vapid || !hasDatabase()) return 0;

  const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.user_id, userId));
  if (!subscriptions.length) return 0;

  const { sent, gone } = await deliverPush(subscriptions, payload, vapid);
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  return sent;
}
