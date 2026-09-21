import { NextRequest, NextResponse } from "next/server";
import {
  CONDUIT_INSTRUMENT_ID,
  findChordsStation,
  getChordsSeries,
  getObservationSeries,
  type SeriesBundle,
} from "@/lib/afya/sources";
import { audits, CHANNEL_GROUPS, checkReadings, groupStatus, type Group } from "@/lib/afya/sentinel";
import type { DemoObservation } from "@/lib/afya/demo-observations";
import archive from "@/lib/afya/model/station-health.json";

// Station health: the report over the whole archive (npm run station-report)
// and the same checks run now on the last 24 hours of the live feed.
// ?instrument= runs those checks on another allowlisted station on the CHORDS
// portal; the archive exists for Conduit@Empathy1 only.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_HEADERS = { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" };

function liveChecks(
  series: DemoObservation[],
  source: SeriesBundle["source"],
  feed: SeriesBundle["feed"],
  channels: string[] = [],
) {
  const recent = series.slice(-96);
  const hits = checkReadings(recent);
  const latest = recent.at(-1) ?? null;
  // A group with no channel on the station's own list is a sensor it does not
  // have, so it is left out rather than reported as failed.
  const listed = (group: Group) =>
    !channels.length || (CHANNEL_GROUPS[group] as readonly string[]).some((f) => channels.includes(f));

  return {
    source,
    feed,
    latest: latest?.ts ?? null,
    age_minutes: latest ? Math.round((Date.now() - Date.parse(latest.ts)) / 60000) : null,
    slots: recent.length,
    groups: groupStatus(recent, hits).filter((g) => listed(g.group)),
    audits: audits(recent),
    firmware_below_wet_bulb_now:
      latest && typeof latest.firmware_wbgt === "number" ? latest.firmware_wbgt < latest.wet_bulb_temp : null,
  };
}

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("instrument");
  const station = param === null ? null : findChordsStation(param);
  if (param !== null && !station) {
    return NextResponse.json({ error: "unknown_instrument" }, { status: 400 });
  }

  if (!station || station.id === CONDUIT_INSTRUMENT_ID) {
    const bundle = await getObservationSeries(new Date().toISOString(), 30);
    return NextResponse.json(
      { archive, live: liveChecks(bundle.series, bundle.source, bundle.feed) },
      { headers: CACHE_HEADERS },
    );
  }

  try {
    const { series, channels } = await getChordsSeries(station.id);
    return NextResponse.json(
      { archive: null, station, live: liveChecks(series, "live", "chords", channels) },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.warn(`[afya] CHORDS instrument ${station.id} fetch failed:`, (err as Error).message);
    return NextResponse.json({ error: "station_unavailable" }, { status: 502 });
  }
}
