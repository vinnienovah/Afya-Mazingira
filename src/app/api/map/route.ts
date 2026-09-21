import { NextResponse } from "next/server";
import { getRegionalOutlook } from "@/lib/afya/map-data";
import { getSatelliteAcquisitionsLive } from "@/lib/afya/sources-external";
import { runPipeline } from "@/lib/afya/pipeline";

// Regional outlook + satellite acquisition metadata. Satellite layers must not
// refresh at 15-minute frequency, a 30-minute cache matches their
// physical acquisition cadence.
export const revalidate = 1800;
// Safety net for the real per-county weather/NDVI fetches, Vercel's default
// function timeout is short.
export const maxDuration = 30;

export async function GET() {
  // Real current pipeline output drives the JKUAT/Kiambu county specifically
  // (Conduit live -> CSV archive -> demo, same source-of-truth as /api/situation).
  const situation = await runPipeline();
  const counties = await getRegionalOutlook({
    countyName: "Kiambu",
    wbgt: situation.current.wbgt_c,
    rainObserved: situation.current.rain_observed,
    isRealData: situation.data_source !== "DEMO",
  });
  const satellites = await getSatelliteAcquisitionsLive();
  return NextResponse.json(
    { counties, satellites },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1500" } },
  );
}
