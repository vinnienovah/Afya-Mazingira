import { NextResponse } from "next/server";
import { getObservationSeries } from "@/lib/afya/sources";
import { audits, checkReadings, groupStatus } from "@/lib/afya/sentinel";
import archive from "@/lib/afya/model/station-health.json";

// Station health: the report over the whole archive (npm run station-report)
// and the same checks run now on the last 24 hours of the live feed.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const bundle = await getObservationSeries(new Date().toISOString(), 30);
  const recent = bundle.series.slice(-96);
  const hits = checkReadings(recent);
  const latest = recent.at(-1) ?? null;

  return NextResponse.json(
    {
      archive,
      live: {
        source: bundle.source,
        feed: bundle.feed,
        latest: latest?.ts ?? null,
        age_minutes: latest ? Math.round((Date.now() - Date.parse(latest.ts)) / 60000) : null,
        slots: recent.length,
        groups: groupStatus(recent, hits),
        audits: audits(recent),
        firmware_below_wet_bulb_now:
          latest && typeof latest.firmware_wbgt === "number" ? latest.firmware_wbgt < latest.wet_bulb_temp : null,
      },
    },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } },
  );
}
