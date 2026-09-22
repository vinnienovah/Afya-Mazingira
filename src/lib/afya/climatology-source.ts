import { getCsvCoverage, getCsvRange } from "./csv-source";
import { getStationHistory } from "./station-history";
import { STATION_HISTORY_WAIT_MS, within } from "./wait";
import { CLIMATOLOGY_DAYS, computeClimatology, isComplete, type Climatology, type ClimatologySource } from "./climatology";

// Where the forecast's usual WBGT by time of day comes from. A forecast made
// inside the recorded archive uses the archive's 30 days before it, so replay
// never touches the network. A live forecast uses the station's last 30 days;
// when those are not available it falls back to the archive's same calendar
// window in every year the archive covers, then to the archive's latest 30
// days. Whatever the source, only observations made before the forecast count.

const DAY_MS = 86_400_000;
const CALENDAR_HALF_WIDTH_DAYS = 15;
const CACHE_LIMIT = 48;
// A live forecast that fell back because the station's history was not ready
// in time tries again after this long.
const PROVISIONAL_TTL_MS = 5 * 60_000;

interface Entry {
  at: number;
  provisional: boolean;
  value: Promise<Climatology | null>;
}

const cache = new Map<number, Entry>();

/**
 * The usual WBGT by time of day for a forecast made at `originIso`, or null
 * when no source has enough measured days. Computed once for each hour of
 * origin and reused within it.
 */
export function getClimatology(originIso: string): Promise<Climatology | null> {
  const originMs = Date.parse(originIso);
  const hour = Math.floor(originMs / 3600_000);
  const held = cache.get(hour);
  if (held && !(held.provisional && Date.now() - held.at > PROVISIONAL_TTL_MS)) return held.value;

  const entry: Entry = { at: Date.now(), provisional: false, value: Promise.resolve(null) };
  entry.value = load(originMs, () => {
    entry.provisional = true;
  }).catch((err) => {
    console.warn("[afya] climatology unavailable:", (err as Error).message);
    return null;
  });
  cache.delete(hour);
  cache.set(hour, entry);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return entry.value;
}

function fromArchive(ranges: [number, number][], source: ClimatologySource): Climatology | null {
  const kept = ranges.filter(([from, to]) => to > from);
  if (!kept.length) return null;
  const series = kept.flatMap(([from, to]) => getCsvRange(new Date(from).toISOString(), new Date(to).toISOString()));
  const c = computeClimatology(series, kept, source);
  return isComplete(c) ? c : null;
}

/** The same stretch of the calendar, CALENDAR_HALF_WIDTH_DAYS either side, in each year from `firstYear`. */
function calendarRanges(originMs: number, firstYear: number, lastYear: number): [number, number][] {
  const origin = new Date(originMs);
  const ranges: [number, number][] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const centre = Date.UTC(year, origin.getUTCMonth(), origin.getUTCDate(), origin.getUTCHours(), origin.getUTCMinutes());
    ranges.push([centre - CALENDAR_HALF_WIDTH_DAYS * DAY_MS, centre + CALENDAR_HALF_WIDTH_DAYS * DAY_MS]);
  }
  return ranges;
}

async function load(originMs: number, markProvisional: () => void): Promise<Climatology | null> {
  const coverage = getCsvCoverage();
  const minMs = coverage ? Date.parse(coverage.minIso) : NaN;
  const maxMs = coverage ? Date.parse(coverage.maxIso) : NaN;
  const trailing: [number, number] = [originMs - CLIMATOLOGY_DAYS * DAY_MS, originMs];
  const beforeOrigin = (ranges: [number, number][]) =>
    ranges.map(([from, to]): [number, number] => [from, Math.min(to, originMs)]);

  if (coverage && originMs >= minMs && originMs <= maxMs) {
    const archive = fromArchive([trailing], "archive");
    if (archive) return archive;
  } else if (!coverage || originMs > maxMs) {
    const history = await within(getStationHistory(CLIMATOLOGY_DAYS).catch(() => null), STATION_HISTORY_WAIT_MS);
    if (history === undefined) markProvisional();
    if (history) {
      const c = computeClimatology(history.series, [trailing], "station");
      if (isComplete(c)) return c;
    }
  }
  if (!coverage) return null;

  const years = [new Date(minMs).getUTCFullYear(), new Date(maxMs).getUTCFullYear()] as const;
  return (
    fromArchive(beforeOrigin(calendarRanges(originMs, years[0], years[1])), "archive_calendar") ??
    fromArchive(beforeOrigin([[maxMs - CLIMATOLOGY_DAYS * DAY_MS, maxMs + 1]]), "archive_latest")
  );
}
