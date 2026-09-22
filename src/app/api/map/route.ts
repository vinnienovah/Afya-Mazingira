import { NextResponse } from "next/server";
import { getRegionalOutlook, stationOverrideFrom } from "@/lib/afya/map-data";
import { getSatelliteAcquisitionsLive } from "@/lib/afya/sources-external";
import { getObservationSeries } from "@/lib/afya/sources";
import { runPipeline } from "@/lib/afya/pipeline";

// Regional outlook + satellite acquisition metadata. Rendered per request,
// since which of today's hours are already past decides where Kiambu's values
// come from; the CDN keeps a copy for five minutes, and the satellite and NDVI
// lookups keep their own six-hour caches.
export const dynamic = "force-dynamic";
// Safety net for the real per-county weather/NDVI fetches, Vercel's default
// function timeout is short.
export const maxDuration = 30;

export async function GET() {
  // Real current pipeline output drives the JKUAT/Kiambu county specifically
  // (Conduit live -> CSV archive -> demo, same source-of-truth as /api/situation).
  const situation = await runPipeline();
  const bundle = await getObservationSeries(new Date().toISOString(), 30);
  const [counties, satellites] = await Promise.all([
    getRegionalOutlook(stationOverrideFrom(situation, bundle.source === "demo" ? null : bundle.series)),
    getSatelliteAcquisitionsLive(),
  ]);
  return NextResponse.json(
    { counties, satellites },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1500" } },
  );
}
