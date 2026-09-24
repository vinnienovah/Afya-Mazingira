import { NextResponse } from "next/server";
import { FLOOD_THRESHOLDS, getRegionalOutlook, regionalWeatherAsOf, stationOverrideFrom } from "@/lib/afya/map-data";
import { getSatelliteAcquisitionsLive } from "@/lib/afya/sources-external";
import { getObservationSeries } from "@/lib/afya/sources";
import { hasCopernicusCreds } from "@/lib/afya/copernicus";
import { dailyRainFrom } from "@/lib/afya/station-history";
import { nairobiDate } from "@/lib/afya/nairobi-time";
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
  const nowMs = Date.now();
  const situation = await runPipeline();
  const bundle = await getObservationSeries(new Date(nowMs).toISOString(), 30);
  const series = bundle.source === "demo" ? null : bundle.series;
  // The same gauge-1 daily total the Farm page works from, read off the series
  // already fetched above; null when the gauge missed too much of the day.
  const gaugeRain = series ? dailyRainFrom(series, nairobiDate(nowMs), nowMs).at(-1)?.mm ?? null : null;
  const [counties, satellites] = await Promise.all([
    getRegionalOutlook(stationOverrideFrom(situation, series, gaugeRain), nowMs),
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
