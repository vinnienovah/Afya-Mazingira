import { NextResponse } from "next/server";
import { getRegionalOutlook, stationOverrideFrom } from "@/lib/afya/map-data";
import { getSatelliteAcquisitionsLive } from "@/lib/afya/sources-external";
import { getObservationSeries } from "@/lib/afya/sources";
import { runPipeline } from "@/lib/afya/pipeline";

// Rendered per request: the context is about now, not about when the app was built.
export const dynamic = "force-dynamic";
// Safety net for the (usually much faster) real ERA5/Sentinel fetches in
// runPipeline, Vercel's default function timeout is short.
export const maxDuration = 30;

export async function GET() {
  try {
    const situation = await runPipeline();
    const bundle = await getObservationSeries(new Date().toISOString(), 30);
    const [counties, satellites] = await Promise.all([
      getRegionalOutlook(stationOverrideFrom(situation, bundle.source === "demo" ? null : bundle.series)),
      getSatelliteAcquisitionsLive(),
    ]);
    return NextResponse.json({
      era5: situation.era5,
      chirps: situation.chirps,
      sentinel: situation.sentinel,
      satellites,
      counties,
    });
  } catch (err) {
    console.error("Context API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
