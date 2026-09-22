import { NextResponse } from "next/server";
import { vapidDetails } from "@/lib/push";

export async function GET() {
  // The public key is only offered when the server can also send.
  const vapid = vapidDetails();
  return NextResponse.json({
    public_key: vapid?.publicKey ?? null,
    configured: !!vapid,
  });
}
