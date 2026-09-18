import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/afya/pipeline";

// Dynamic: forecasts follow the freshest cached observations.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const situation = runPipeline();
    return NextResponse.json(
      {
        generated_at: situation.generated_at,
        data_source: situation.data_source,
        demo_mode: situation.demo_mode,
        forecast: situation.forecast,
        forecast_series: situation.forecast_series,
        expected_peak: situation.expected_peak,
        quality: situation.quality,
        state: situation.state,
        risk: situation.risk,
        contributors: situation.contributors,
      },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=840" } },
    );
  } catch (err) {
    console.error("Forecast API error:", err);
    return NextResponse.json({ error: "pipeline_error" }, { status: 500 });
  }
}
