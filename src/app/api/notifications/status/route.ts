import { NextResponse } from "next/server";
import { hasResendConfigured } from "@/lib/auth/verification";
import { hasPushConfigured } from "@/lib/push";

// What this server can actually deliver, so the Notifications page can say so.
export async function GET() {
  return NextResponse.json({
    email_configured: hasResendConfigured(),
    push_configured: hasPushConfigured(),
  });
}
