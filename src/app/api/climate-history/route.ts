import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCsvRange, getCsvCoverage } from "@/lib/afya/csv-source";
import { getConduitRange } from "@/lib/afya/sources";
import { CLIMATE_LOCATIONS } from "@/lib/afya/constants";
import type { DemoObservation } from "@/lib/afya/demo-observations";

// Climate History dashboard: an arbitrary date-range, chooseable-granularity
// view — separate from the always-"now" Climate Variables panel on the
// Intelligence page (/api/climate-series). Two datasets:
//   - conduit: real station data, JKUAT only — the CSV archive for anything
//     older than its last row, topped up with a real live-API fetch for the
//     gap between the archive and `to` when the range reaches that far.
//   - era5: real ERA5-Land reanalysis, any of the supported locations (it's
//     a global gridded product, so this works everywhere, unlike Conduit).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_RANGE_DAYS = 366;

const QuerySchema = z.object({
  dataset: z.enum(["conduit", "era5"]).default("conduit"),
  location: z.string().default("jkuat"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  granularity: z.enum(["hourly", "daily"]).default("daily"),
});

export async function GET(req: NextRequest) {
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
    const { dataset, location, from, to, granularity } = parsed.data;

    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T23:59:59Z`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
      return NextResponse.json({ error: "invalid_range" }, { status: 400 });
    }
    if ((toMs - fromMs) / 86400_000 > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: "range_too_large", max_days: MAX_RANGE_DAYS }, { status: 400 });
    }

    if (dataset === "conduit") {
      const csvRows = getCsvRange(new Date(fromMs).toISOString(), new Date(toMs).toISOString());
      const coverage = getCsvCoverage();

      // Top up with a real live fetch for the gap between the archive's last
      // row and the requested end date, when the range reaches that far —
      // clamped to the requested `from` too, so a range that starts after
      // the archive's coverage doesn't pull in earlier archive-gap rows.
      let liveRows: DemoObservation[] = [];
      const csvMaxMs = coverage ? Date.parse(coverage.maxIso) : -Infinity;
      if (toMs > csvMaxMs) {
        const gapFromMs = Math.max(fromMs, csvMaxMs);
        liveRows = await getConduitRange(new Date(gapFromMs).toISOString(), new Date(toMs).toISOString());
      }

      const points = aggregateConduit([...csvRows, ...liveRows], granularity);
      return NextResponse.json({ dataset: "conduit", granularity, coverage, points });
    }

    const loc = CLIMATE_LOCATIONS.find((l) => l.key === location) ?? CLIMATE_LOCATIONS[0];
    const points = await fetchEra5History(loc.lat, loc.lng, from, to, granularity);
    return NextResponse.json({ dataset: "era5", granularity, location: loc.key, points });
  } catch (err) {
    console.error("Climate history API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

interface HistoryPoint {
  time: string;
  temp_c: number | null;
  humidity_pct: number | null;
  wind_ms: number | null;
  rain_mm: number | null;
  pressure_hpa?: number | null;
  wbgt_c?: number | null;
}

function aggregateConduit(rows: DemoObservation[], granularity: "hourly" | "daily"): HistoryPoint[] {
  const keyFor = (ts: string) => (granularity === "daily" ? ts.slice(0, 10) : ts.slice(0, 13));
  const buckets = new Map<
    string,
    { temp: number[]; hum: number[]; wind: number[]; press: number[]; wbgt: number[]; rain: number }
  >();
  for (const r of rows) {
    const key = keyFor(r.ts);
    if (!buckets.has(key)) buckets.set(key, { temp: [], hum: [], wind: [], press: [], wbgt: [], rain: 0 });
    const b = buckets.get(key)!;
    b.temp.push(r.temp_sht);
    b.hum.push(r.humidity_sht);
    b.wind.push(r.wind_spd);
    b.press.push(r.press_bmx);
    b.wbgt.push(r.wet_bulb_globe_temp);
    b.rain += r.rg1 + r.rg2;
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const r1 = (n: number) => Math.round(n * 10) / 10;

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, b]) => ({
      time: granularity === "daily" ? key : `${key}:00:00Z`,
      temp_c: r1(mean(b.temp)),
      humidity_pct: r1(mean(b.hum)),
      wind_ms: r1(mean(b.wind)),
      pressure_hpa: r1(mean(b.press)),
      wbgt_c: r1(mean(b.wbgt)),
      rain_mm: r1(b.rain),
    }));
}

async function fetchEra5History(
  lat: number,
  lng: number,
  from: string,
  to: string,
  granularity: "hourly" | "daily",
): Promise<HistoryPoint[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: from,
    end_date: to,
    timezone: "UTC",
  });
  if (granularity === "daily") {
    params.set("daily", "temperature_2m_mean,relative_humidity_2m_mean,precipitation_sum,wind_speed_10m_mean");
  } else {
    params.set("hourly", "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m");
  }

  const res = await fetch(`https://archive-api.open-meteo.com/v1/era5?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ERA5 archive HTTP ${res.status}`);
  const json = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_mean?: (number | null)[];
      relative_humidity_2m_mean?: (number | null)[];
      precipitation_sum?: (number | null)[];
      wind_speed_10m_mean?: (number | null)[];
    };
    hourly?: {
      time?: string[];
      temperature_2m?: (number | null)[];
      relative_humidity_2m?: (number | null)[];
      precipitation?: (number | null)[];
      wind_speed_10m?: (number | null)[];
    };
  };

  const kmhToMs = (v: number | null | undefined) => (v == null ? null : Math.round((v / 3.6) * 10) / 10);

  if (granularity === "daily") {
    const d = json.daily;
    if (!d?.time?.length) return [];
    return d.time.map((t, i) => ({
      time: t,
      temp_c: d.temperature_2m_mean?.[i] ?? null,
      humidity_pct: d.relative_humidity_2m_mean?.[i] ?? null,
      rain_mm: d.precipitation_sum?.[i] ?? null,
      wind_ms: kmhToMs(d.wind_speed_10m_mean?.[i]),
    }));
  }
  const h = json.hourly;
  if (!h?.time?.length) return [];
  return h.time.map((t, i) => ({
    time: t.endsWith("Z") ? t : `${t}Z`,
    temp_c: h.temperature_2m?.[i] ?? null,
    humidity_pct: h.relative_humidity_2m?.[i] ?? null,
    rain_mm: h.precipitation?.[i] ?? null,
    wind_ms: kmhToMs(h.wind_speed_10m?.[i]),
  }));
}
