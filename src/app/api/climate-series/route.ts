import { NextResponse } from "next/server";
import { getObservationSeries } from "@/lib/afya/sources";
import { getEra5Series, getDailyRainfallSeries } from "@/lib/afya/sources-external";

// Real time-series for the climate variables dashboard pane: Conduit
// observations (live -> CSV archive -> demo, same source-of-truth as
// /api/situation), ERA5-Land hourly context, and real daily rainfall
// (derived from the same ERA5 precipitation — see sources-external.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const now = new Date().toISOString();
    const bundle = getObservationSeries(now, 30); // last 30h at 15-min resolution

    const [era5, dailyRainfall] = await Promise.all([
      getEra5Series(),
      getDailyRainfallSeries(),
    ]);

    const conduit = bundle.series.map((o) => ({
      ts: o.ts,
      temp_c: Math.round(o.temp_sht * 10) / 10,
      humidity_pct: Math.round(o.humidity_sht * 10) / 10,
      wind_ms: Math.round(o.wind_spd * 10) / 10,
      pressure_hpa: Math.round(o.press_bmx * 10) / 10,
      wbgt_c: Math.round(o.wet_bulb_globe_temp * 10) / 10,
      rain_mm: Math.round((o.rg1 + o.rg2) * 10) / 10,
    }));

    return NextResponse.json({
      conduit_source: bundle.source,
      conduit,
      era5: era5.slice(-24 * 7), // last ~7 days of hourly rows
      daily_rainfall: dailyRainfall.slice(-21), // last 3 weeks
    });
  } catch (err) {
    console.error("Climate series API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
