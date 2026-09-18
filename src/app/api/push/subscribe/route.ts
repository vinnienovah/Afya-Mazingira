import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { getSessionFromCookies } from "@/lib/auth/logic";

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

export async function POST(req: NextRequest) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = SubscribeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { endpoint, keys } = parsed.data;

  await db.insert(pushSubscriptions)
    .values({ user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoNothing();

  // Check if we have real VAPID keys
  const hasVapid = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

  return NextResponse.json({
    ok: true,
    demo_mode: !hasVapid,
    message: hasVapid
      ? "Push subscription saved."
      : "Demo mode: push subscription recorded locally. Configure VAPID keys for real push.",
  });
}
