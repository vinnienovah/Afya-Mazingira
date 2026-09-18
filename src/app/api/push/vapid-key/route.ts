import { NextResponse } from "next/server";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return NextResponse.json({
    public_key: publicKey,
    configured: !!publicKey,
  });
}
