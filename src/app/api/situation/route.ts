import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/afya/pipeline";

// Dynamic: the situation reflects the freshest cached observations (live
// Conduit when credentials exist, seeded demo otherwise). The pipeline itself
// is cheap; freshness matters more than caching here.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const situation = runPipeline();
    return NextResponse.json(situation, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=840" },
    });
  } catch (err) {
    console.error("Situation pipeline error:", err);
    return NextResponse.json({ error: "pipeline_error" }, { status: 500 });
  }
}
