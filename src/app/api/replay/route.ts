import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runHistoricalReplay } from "@/lib/afya/pipeline";

const ReplaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ReplaySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_date" }, { status: 400 });

    const steps = runHistoricalReplay(parsed.data.date);
    return NextResponse.json({ date: parsed.data.date, steps });
  } catch (err) {
    console.error("Replay API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
