import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { getSessionFromCookies } from "@/lib/auth/logic";
import { hasPushConfigured } from "@/lib/push";
import { databaseUnavailable, readJsonBody } from "@/lib/http";

// Browsers report the keys in base64url; older clients sent plain base64.
const base64url = (value: string) => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const SubscribeSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

const UnsubscribeSchema = z.object({ endpoint: z.string().min(1) });

export async function POST(req: NextRequest) {
  if (!hasDatabase()) return databaseUnavailable();
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await readJsonBody(req, SubscribeSchema);
  if ("response" in body) return body.response;
  const { endpoint, keys } = body.data;
  const values = { user_id: user.id, endpoint, p256dh: base64url(keys.p256dh), auth: base64url(keys.auth) };

  // One browser, one subscription: it follows whoever last signed in there.
  await db.insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { user_id: values.user_id, p256dh: values.p256dh, auth: values.auth },
    });

  return NextResponse.json({ ok: true, push_configured: hasPushConfigured() });
}

export async function DELETE(req: NextRequest) {
  if (!hasDatabase()) return databaseUnavailable();
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await readJsonBody(req, UnsubscribeSchema);
  if ("response" in body) return body.response;

  await db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, body.data.endpoint), eq(pushSubscriptions.user_id, user.id)));
  return NextResponse.json({ ok: true });
}
