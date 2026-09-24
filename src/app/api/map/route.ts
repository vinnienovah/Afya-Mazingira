import { hasCopernicusCreds } from "@/lib/afya/copernicus";
import { NextResponse } from "next/server";
import { FLOOD_THRESHOLDS, getRegionalOutlook, regionalWeatherAsOf } from "@/lib/afya/map-data";
import { getSatelliteAcquisitionsLive } from "@/lib/afya/sources-external";

// Regional outlook + satellite acquisition metadata. Rendered per request,
// county polygons use regional spatial samples; station points use /api/situation.
// The CDN keeps a copy for five minutes, and the satellite and NDVI
// lookups keep their own six-hour caches.
export const dynamic = "force-dynamic";
// Safety net for the real per-county weather/NDVI fetches, Vercel's default
// function timeout is short.
export const maxDuration = 60;

export async function GET() {
  const nowMs = Date.now();
  const [counties, satellites] = await Promise.all([
    getRegionalOutlook(),
    getSatelliteAcquisitionsLive(),
  ]);
  return NextResponse.json(
    {
      counties,
      satellites,
      // weather_as_of is set only when the county weather is an earlier read the
      // latest refresh could not replace.
      weather_as_of: regionalWeatherAsOf(nowMs),
      // Without CDSE credentials there is no NDVI and no acquisition list; the
      // pages say so rather than leaving empty surfaces unexplained.
      satellite_configured: hasCopernicusCreds(),
      flood_thresholds: FLOOD_THRESHOLDS,
    },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1500" } },
  );
}
