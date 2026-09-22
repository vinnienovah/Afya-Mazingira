import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCsvCoverage } from "@/lib/afya/csv-source";
import { getStationHistory } from "@/lib/afya/station-history";
import { aggregateStation, fetchEra5History } from "@/lib/afya/climate-history";
import { addDays, nairobiDate, nairobiDayStart } from "@/lib/afya/nairobi-day";
import { CLIMATE_LOCATIONS } from "@/lib/afya/constants";
import { rateLimit } from "@/lib/rate-limit";

// Climate History dashboard: an arbitrary date range at daily or hourly
// granularity, separate from the always-"now" Climate Variables panel
// (/api/climate-series). Dates are Nairobi dates and a range runs to now at
// most. Two datasets:
//   - conduit: the station itself, JKUAT only: the archive, then the live
//     feeds (station-history.ts).
//   - era5: ERA5 reanalysis on its ~28 km grid, any of the supported
//     locations. It is published about five days late, so it stops there.
// An empty answer says why in `reason`.
export const dynamic = "force-dynamic";
// A range past the archive is filled from the live feeds, which can take
// several requests on a cold cache.
export const maxDuration = 55;

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86400_000;

const QuerySchema = z.object({
  dataset: z.enum(["conduit", "era5"]).default("conduit"),
  location: z.string().default("jkuat"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  granularity: z.enum(["hourly", "daily"]).default("daily"),
});

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "climateHistory");
  if (limited) return limited;
  try {
    const sp = req.nextUrl.searchParams;
    const parsed = QuerySchema.safeParse({
      dataset: sp.get("dataset") ?? undefined,
      location: sp.get("location") ?? undefined,
      from: sp.get("from"),
      to: sp.get("to"),
      granularity: sp.get("granularity") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { dataset, location, from, granularity } = parsed.data;

    const now = Date.now();
    const today = nairobiDate(now);
    const to = parsed.data.to > today ? today : parsed.data.to;
    const fromMs = nairobiDayStart(from);
    const toMs = Math.min(nairobiDayStart(to) + DAY_MS, now);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || from > parsed.data.to) {
      return NextResponse.json({ error: "invalid_range" }, { status: 400 });
    }
    if ((toMs - fromMs) / DAY_MS > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: "range_too_large", max_days: MAX_RANGE_DAYS }, { status: 400 });
    }
    if (from > today) {
      return NextResponse.json({ dataset, granularity, points: [], reason: "future_range" });
    }

    if (dataset === "conduit") {
      const coverage = getCsvCoverage();
      const history = await getStationHistory((toMs - fromMs) / DAY_MS, new Date(toMs).toISOString());
      const points = history ? aggregateStation(history.series, granularity, toMs) : [];
      return NextResponse.json({
        dataset: "conduit",
        granularity,
        coverage,
        source: history?.source ?? null,
        feed: history?.feed ?? null,
        points,
        ...(points.length ? {} : { reason: "no_station_data" }),
      });
    }

    const loc = CLIMATE_LOCATIONS.find((l) => l.key === location) ?? CLIMATE_LOCATIONS[0];
    const points = await fetchEra5History(loc.lat, loc.lng, from, to, granularity, now);
    // Where ERA5 ends, from a range reaching past it; it runs about five days behind.
    const last = points.at(-1)?.time;
    const lagging = !last || (granularity === "daily" ? last < to : Date.parse(last) < toMs - 3600_000);
    return NextResponse.json({
      dataset: "era5",
      granularity,
      location: loc.key,
      points,
      era5_until: lagging ? (last ? last.slice(0, 10) : null) : undefined,
      ...(points.length ? {} : { reason: from >= addDays(today, -7) ? "era5_not_yet_published" : "no_era5_data" }),
    });
  } catch (err) {
    console.error("Climate history API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
