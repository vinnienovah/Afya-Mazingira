import { NextRequest, NextResponse } from "next/server";
import {
  CONDUIT_INSTRUMENT_ID,
  findChordsStation,
  getChordsSeries,
  getObservationSeries,
  type SeriesBundle,
} from "@/lib/afya/sources";
import { audits, CHANNEL_GROUPS, checkReadings, deviceCodes, EXPORT_GROUPS, groupStatus, type GroupReport } from "@/lib/afya/sentinel";
import { liveWindow, SLOT_MS } from "@/lib/afya/display";
import type { DemoObservation } from "@/lib/afya/demo-observations";
import archive from "@/lib/afya/model/station-health.json";

// Station health: the report over the whole archive (npm run station-report)
// and the same checks run now on the live feed's latest readings.
// ?instrument= runs those checks on another allowlisted station on the CHORDS
// portal; the archive exists for Conduit@Empathy1 only.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_HEADERS = { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" };
const ALL_GROUPS: Record<string, readonly string[]> = { ...CHANNEL_GROUPS, ...EXPORT_GROUPS };
const LIVE_WINDOW_HOURS = 24;
const LIVE_SLOTS = (LIVE_WINDOW_HOURS * 3600_000) / SLOT_MS;
// The days the archive really holds, sent with every station: the note that
// says the archive belongs to Conduit@Empathy1 has to date it too.
const ARCHIVE_SPAN = { first: archive.first.slice(0, 10), last: archive.last.slice(0, 10) };

function liveChecks(
  series: DemoObservation[],
  source: SeriesBundle["source"],
  feed: SeriesBundle["feed"],
  channels: string[] = [],
  nowMs = Date.now(),
) {
  // A day's worth of slots wherever they land, so a station that has stopped
  // reporting still shows what its last readings held; `window` is what they
  // really cover, and the silence since them.
  const recent = series.slice(-LIVE_SLOTS);
  const hits = checkReadings(recent);
  const latest = recent.at(-1) ?? null;
  const window = liveWindow(recent, nowMs, LIVE_WINDOW_HOURS);
  // A group with no channel on the station's own list is a sensor it does not
  // have, so it is left out rather than reported as failed.
  const listed = (group: GroupReport["group"]) =>
    !channels.length || ALL_GROUPS[group].some((f) => channels.includes(f));

  return {
    source,
    feed,
    latest: latest?.ts ?? null,
    age_minutes: latest ? Math.round((nowMs - Date.parse(latest.ts)) / 60000) : null,
    slots: recent.length,
    window,
    missing_minutes: window?.missing_minutes ?? 0,
    groups: groupStatus(recent, hits, { feed, exportGroups: true, batteryListed: channels.includes("battery_v") })
      .filter((g) => listed(g.group)),
    audits: audits(recent),
    device_codes: deviceCodes(recent),
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
      { archive, archive_span: ARCHIVE_SPAN, live: liveChecks(bundle.series, bundle.source, bundle.feed, bundle.channels) },
      { headers: CACHE_HEADERS },
    );
  }

  try {
    const { series, channels } = await getChordsSeries(station.id);
    return NextResponse.json(
      { archive: null, archive_span: ARCHIVE_SPAN, station, live: liveChecks(series, "live", "chords", channels) },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.warn(`[afya] CHORDS instrument ${station.id} fetch failed:`, (err as Error).message);
    return NextResponse.json({ error: "station_unavailable" }, { status: 502 });
  }
}
