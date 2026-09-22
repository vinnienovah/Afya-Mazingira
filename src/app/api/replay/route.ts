import { NextRequest, NextResponse } from "next/server";
import { runHistoricalReplay } from "@/lib/afya/pipeline";
import { getObservationSeries } from "@/lib/afya/sources";
import { buildReplayFrames, replayDateProblem, summariseHorizons } from "@/lib/afya/replay";
import { rateLimit } from "@/lib/rate-limit";

// Safety net, a replay runs the pipeline for 13 simulated hours.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "replay");
  if (limited) return limited;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "The request body is not valid JSON." }, { status: 400 });
  }
  const date = (body as { date?: unknown } | null)?.date;
  const problem = replayDateProblem(date, Date.now());
  if (problem) return NextResponse.json({ error: "invalid_date", message: problem }, { status: 400 });
  const day = date as string;

  try {
    const steps = await runHistoricalReplay(day);
    // What the station recorded from 03:00 that day to 03:00 the next, which
    // covers every step's forecasts up to nine hours ahead.
    const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86400_000).toISOString();
    const bundle = await getObservationSeries(nextDay, 24);
    const frames = buildReplayFrames(steps, bundle.source === "demo" ? [] : bundle.series);

    if (!frames.some((f) => f.available)) {
      return NextResponse.json(
        { error: "no_station_data", message: `The station has no recorded observations for ${day}.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ date: day, steps: frames, summary: summariseHorizons(frames) });
  } catch (err) {
    console.error("Replay API error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
