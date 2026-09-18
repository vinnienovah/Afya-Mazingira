import { NextResponse } from "next/server";
import { getRegionalOutlook } from "@/lib/afya/map-data";
import { getSatelliteAcquisitionsLive } from "@/lib/afya/sources-external";

// Regional outlook + satellite acquisition metadata. Satellite layers must not
// refresh at 15-minute frequency (spec §51) — a 30-minute cache matches their
// physical acquisition cadence.
export const revalidate = 1800;

export async function GET() {
  const counties = getRegionalOutlook();
  const satellites = getSatelliteAcquisitionsLive();
  return NextResponse.json(
    { counties, satellites },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1500" } },
  );
}
