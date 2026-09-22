import { NextResponse, type NextRequest } from "next/server";
import { runPipeline } from "@/lib/afya/pipeline";
import { parseActivityKey } from "@/lib/preferred-activity";

// Dynamic: the situation reflects the freshest cached observations (live
// Conduit when credentials exist, seeded demo otherwise). The pipeline itself
// is cheap; freshness matters more than caching here.
export const dynamic = "force-dynamic";
// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline, Vercel's default function timeout is short.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    // ?activity= picks the activity the recommended window is planned for.
    const activity = parseActivityKey(req.nextUrl.searchParams.get("activity"));
    const situation = await runPipeline(activity ? { activityKey: activity } : {});
    // The station reports every 15 minutes; a short stale window keeps the CDN
    // from serving a reading older than the one the briefing renders.
    return NextResponse.json(situation, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" },
    });
  } catch (err) {
    console.error("Situation pipeline error:", err);
    return NextResponse.json({ error: "pipeline_error" }, { status: 500 });
  }
}
