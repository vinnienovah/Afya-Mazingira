import { NextResponse } from "next/server";
import { getRegionalOutlook, getSatelliteAcquisitions } from "@/lib/afya/map-data";
import { runPipeline } from "@/lib/afya/pipeline";

export const revalidate = 1800;

export async function GET() {
  try {
    const situation = runPipeline();
    return NextResponse.json({
      era5: situation.era5,
      chirps: situation.chirps,
      sentinel: situation.sentinel,
      satellites: getSatelliteAcquisitions(),
      counties: getRegionalOutlook(),
    });
  } catch (err) {
    console.error("Context API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
