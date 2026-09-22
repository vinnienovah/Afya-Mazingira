import type { DemoObservation } from "./demo-observations";
import { stullWetBulb } from "./constants";
import { EAT_OFFSET_MS, nairobiDate } from "./nairobi-day";

// Station health: quality rules applied to every measured reading, a daily
// health score, and audits of the values the station's firmware derives.
// The rules follow the Conduit Sentinel specification written for this
// station's one-minute exports, scaled here to the 15-minute data the Conduit
// API and the CHORDS feed serve. Only measured values are judged: a value the
// cleaning step filled in is counted as missing, never as good. Days run from
// midnight to midnight in Nairobi.

export const SENTINEL_LIMITS = {
  temperature_c: [-5, 45], // R01
  pressure_hpa: [800, 900], // R03, station pressure at 1,523 m
  wind_speed_ms: [0, 60], // R04
  wind_gust_ms: [0, 75], // R04
  light_dark_floor_counts: 240, // R06: the sensor never reads lower in the dark
  max_step_c: 5, // R07: change between two 15-minute slots
  flat_slots: { temp_sht: 8, humidity_sht: 8, press_bmx: 12, wind_spd: 12 }, // R08: two and three hours unchanged
  stuck_other_thermometer_c: 0.5, // R08: a flat thermometer counts as stuck only while another moves more than this
  max_thermometer_spread_c: 2, // R09
  rain_disagreement_mm: 0.4, // R11: one gauge this much in a day, the other nothing
  gust_direction_copy_share: 0.99, // R13: share of a day's readings where gust direction equals gust speed
  gust_direction_min_slots: 4, // R13: readings a day needs before it is judged
  wbgt_below_wet_bulb_margin_c: 1.5, // R16 and A03
  flagged_share: 0.05, // health score: share of a day's slots flagged before a group counts
  bad_group_penalty: 10,
  suspect_group_penalty: 2,
  missing_minutes_per_point: 14.4, // 1 % of a day
  stull_max_mae_c: 0.1, // A01
} as const;

export const CHANNEL_GROUPS = {
  temperature: ["temp_sht", "temp_bmx", "temp_mcp"],
  humidity: ["humidity_sht"],
  pressure: ["press_bmx"],
  wind: ["wind_spd", "wind_gust", "wind_dir"],
  light: ["si1145_vis", "si1145_ir"],
  rain: ["rg1", "rg2"],
} as const;

// Channels the engines never read, reported beside the sensor groups: the
// gust-direction column (R13) and the battery. As in the Sentinel spec, a
// battery channel the feed lists but leaves empty is bad (R12); an export
// with no battery channel at all cannot be judged and is not reported.
export const EXPORT_GROUPS = {
  gust_direction: ["wind_gust_dir"],
  battery: ["battery_v"],
} as const;

export type Group = keyof typeof CHANNEL_GROUPS;
export type ExportGroup = keyof typeof EXPORT_GROUPS;
// not_judged: the feed cannot show a fault (CHORDS leaves rain out while none
// falls). not_reported: the station sends no values for it.
export type GroupStatus = "good" | "suspect" | "bad" | "not_judged" | "not_reported";
export type Feed = "jhub" | "chords" | null;
type Channel = (typeof CHANNEL_GROUPS)[Group][number];

const GROUPS = Object.keys(CHANNEL_GROUPS) as Group[];
const THERMOMETERS = CHANNEL_GROUPS.temperature;
const HARD_LIMIT_RULES: Record<string, string> = {
  temp_sht: "R01", temp_bmx: "R01", temp_mcp: "R01",
  humidity_sht: "R02", press_bmx: "R03", wind_spd: "R04", wind_gust: "R04",
};

const measured = (o: DemoObservation, f: string) => !o.imputed?.includes(f);
const value = (o: DemoObservation, f: Channel) => o[f as keyof DemoObservation] as number;
const hasGustDirection = (o: DemoObservation) => typeof o.wind_gust_dir === "number";

/** The hard-limit rule (R01 to R04) a reading breaks, or null. */
export function hardLimitRule(channel: string, v: number): string | null {
  const L = SENTINEL_LIMITS;
  const outside = (range: readonly [number, number]) => v < range[0] || v > range[1];
  switch (channel) {
    case "temp_sht":
    case "temp_bmx":
    case "temp_mcp":
      return outside(L.temperature_c) ? "R01" : null;
    case "humidity_sht":
      return v <= 0 ? "R02" : null;
    case "press_bmx":
      return outside(L.pressure_hpa) ? "R03" : null;
    case "wind_spd":
      return outside(L.wind_speed_ms) ? "R04" : null;
    case "wind_gust":
      return outside(L.wind_gust_ms) ? "R04" : null;
    default:
      return null;
  }
}

/** Slot indexes by Nairobi date, in time order. */
export function slotsByDay(series: DemoObservation[]): Map<string, number[]> {
  const byDay = new Map<string, number[]>();
  series.forEach((o, i) => {
    const d = nairobiDate(o.ts);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(i);
  });
  return byDay;
}

export interface RuleHit {
  rule: string;
  channel: string;
  index: number;
  flag: "suspect" | "bad";
}

/** Every rule hit in a series, slot by slot. */
export function checkReadings(series: DemoObservation[]): RuleHit[] {
  const L = SENTINEL_LIMITS;
  const hits: RuleHit[] = [];
  const hit = (rule: string, channel: string, index: number, flag: "suspect" | "bad") =>
    hits.push({ rule, channel, index, flag });

  series.forEach((o, i) => {
    // Readings the cleaning step dropped for breaking a hard limit.
    for (const f of o.rejected ?? []) if (HARD_LIMIT_RULES[f]) hit(HARD_LIMIT_RULES[f], f, i, "bad");
    for (const f of Object.keys(HARD_LIMIT_RULES)) {
      const rule = measured(o, f) ? hardLimitRule(f, value(o, f as Channel)) : null;
      if (rule) hit(rule, f, i, "bad");
    }
    for (const f of CHANNEL_GROUPS.light) {
      if (measured(o, f) && value(o, f) < L.light_dark_floor_counts) hit("R06", f, i, "suspect");
    }
    const prev = series[i - 1];
    if (prev && measured(o, "temp_sht") && measured(prev, "temp_sht") && Math.abs(o.temp_sht - prev.temp_sht) > L.max_step_c) {
      hit("R07", "temp_sht", i, "suspect");
    }
    const temps = THERMOMETERS.filter((f) => measured(o, f)).map((f) => value(o, f));
    if (temps.length >= 2 && Math.max(...temps) - Math.min(...temps) > L.max_thermometer_spread_c) {
      for (const f of THERMOMETERS) hit("R09", f, i, "suspect");
    }
    if (
      typeof o.firmware_wbgt === "number" &&
      measured(o, "wet_bulb_temp") &&
      o.firmware_wbgt < o.wet_bulb_temp - L.wbgt_below_wet_bulb_margin_c
    ) {
      hit("R16", "firmware_wbgt", i, "suspect");
    }
  });

  // R08: the same measured value for too long. Calm nights make zero wind
  // real, so only a non-zero wind reading can be stuck. Calm nights also keep
  // air temperature steady to a tenth of a degree for hours, so a flat
  // thermometer counts only while another thermometer moves.
  const otherMoved = (from: number, to: number) =>
    THERMOMETERS.filter((f) => f !== "temp_sht").some((f) => {
      const values = series.slice(from, to).filter((o) => measured(o, f)).map((o) => value(o, f));
      return values.length > 1 && Math.max(...values) - Math.min(...values) > L.stuck_other_thermometer_c;
    });
  for (const [f, run] of Object.entries(L.flat_slots)) {
    let start = 0;
    for (let i = 1; i <= series.length; i++) {
      const same =
        i < series.length &&
        measured(series[i], f) &&
        measured(series[i - 1], f) &&
        value(series[i], f as Channel) === value(series[i - 1], f as Channel) &&
        !(f === "wind_spd" && series[i].wind_spd === 0);
      if (!same) {
        if (i - start >= run && (f !== "temp_sht" || otherMoved(start, i))) {
          for (let k = start; k < i; k++) hit("R08", f, k, "suspect");
        }
        start = i;
      }
    }
  }

  // R13: on a day when the gust-direction column equals the gust speed in
  // almost every reading, it is a copy, not a direction.
  for (const idx of slotsByDay(series).values()) {
    const both = idx.filter((i) => hasGustDirection(series[i]) && measured(series[i], "wind_gust"));
    if (both.length < L.gust_direction_min_slots) continue;
    const copies = both.filter((i) => Math.abs(series[i].wind_gust_dir! - series[i].wind_gust) < 0.05).length;
    if (copies / both.length >= L.gust_direction_copy_share) {
      for (const i of both) hit("R13", "wind_gust_dir", i, "bad");
    }
  }
  return hits;
}

// Rain days run from 06:00 to 06:00 UTC, the day the station's own gauge
// totals use.
const RAIN_DAY_START_MS = 6 * 3600_000;
const DAY_MS = 86400_000;
const rainDayOf = (ts: string) => Math.floor((Date.parse(ts) - RAIN_DAY_START_MS) / DAY_MS);
const PRIOR = { rg1: "rg1tp", rg2: "rg2tp" } as const;

/** Whether a gauge reported in a slot: its rain, or its previous rain-day total. */
const gaugeRead = (o: DemoObservation, f: "rg1" | "rg2") => measured(o, f) || typeof o[PRIOR[f]] === "number";
const isRead = (o: DemoObservation, f: string) => (f === "rg1" || f === "rg2" ? gaugeRead(o, f) : measured(o, f));

/**
 * Each gauge's total for every rain day the series can tell: the total the
 * station itself reports through the next rain day (its prior-day total), or
 * else the rain summed over a day with rain readings in at least 80 % of its
 * slots. The key is the Nairobi date the rain day starts on.
 */
export function rainDayTotals(series: DemoObservation[]): Map<string, [number | null, number | null]> {
  const days = new Map<number, number[]>();
  series.forEach((o, i) => {
    const d = rainDayOf(o.ts);
    if (!days.has(d)) days.set(d, []);
    days.get(d)!.push(i);
  });
  const out = new Map<string, [number | null, number | null]>();
  for (const [d, idx] of days) {
    const total = (f: "rg1" | "rg2") => {
      const priors = (days.get(d + 1) ?? [])
        .map((i) => series[i][PRIOR[f]])
        .filter((v): v is number => typeof v === "number")
        .sort((a, b) => a - b);
      if (priors.length) return priors[Math.floor(priors.length / 2)];
      const read = idx.filter((i) => measured(series[i], f));
      return read.length >= 0.8 * (DAY_MS / 900_000)
        ? Math.round(read.reduce((s, i) => s + series[i][f], 0) * 100) / 100
        : null;
    };
    out.set(nairobiDate(d * DAY_MS + RAIN_DAY_START_MS), [total("rg1"), total("rg2")]);
  }
  return out;
}

/** R11: one gauge measured rain in a rain day while the other measured none. */
function gaugesDisagree([r1, r2]: [number | null, number | null]): boolean {
  const L = SENTINEL_LIMITS;
  return (r1 !== null && r2 !== null) &&
    ((r1 >= L.rain_disagreement_mm && r2 === 0) || (r2 >= L.rain_disagreement_mm && r1 === 0));
}

/** On the CHORDS feed a silent gauge proves nothing, so rain is judged only once a gauge reports some. */
function rainJudged(feed: Feed, series: DemoObservation[], idx: number[]): boolean {
  return feed !== "chords" || idx.some((i) => {
    const o = series[i];
    return o.rg1 > 0 || o.rg2 > 0 || (o.rg1tp ?? 0) > 0 || (o.rg2tp ?? 0) > 0;
  });
}

export interface DayHealth {
  date: string;
  score: number;
  bad: string[];
  suspect: string[];
  missing_minutes: number;
  rules: string[];
}

function groupOf(channel: string): Group | ExportGroup | null {
  for (const [g, channels] of [...Object.entries(CHANNEL_GROUPS), ...Object.entries(EXPORT_GROUPS)]) {
    if ((channels as readonly string[]).includes(channel)) return g as Group | ExportGroup;
  }
  return null;
}

/**
 * Health score for each Nairobi day: 100, less 10 for each channel group that
 * is bad (a channel empty all day, more than 5 % of slots flagged bad, or the
 * gust-direction column a copy), less 2 for each suspect group (more than 5 %
 * flagged suspect, or the rain gauges disagreeing), less 1 for every 14.4
 * minutes inside gaps between readings. Battery telemetry is not scored.
 */
export function dailyHealth(
  series: DemoObservation[],
  hits = checkReadings(series),
  { feed = null, batteryListed = false }: { feed?: Feed; batteryListed?: boolean } = {},
): DayHealth[] {
  const L = SENTINEL_LIMITS;
  const hitsBySlot = new Map<number, RuleHit[]>();
  for (const h of hits) {
    if (!hitsBySlot.has(h.index)) hitsBySlot.set(h.index, []);
    hitsBySlot.get(h.index)!.push(h);
  }
  const gustDirection = series.some(hasGustDirection);
  const rainDays = rainDayTotals(series);

  return [...slotsByDay(series).entries()].map(([date, idx]) => {
    const bad = new Set<string>();
    const suspect = new Set<string>();
    const rules = new Set<string>();
    const dayHits = idx.flatMap((i) => hitsBySlot.get(i) ?? []);
    dayHits.forEach((h) => rules.add(h.rule));
    const flagged = (flag: string, g: string) =>
      new Set(dayHits.filter((h) => h.flag === flag && groupOf(h.channel) === g).map((h) => h.index)).size / idx.length;

    const rainJudgedToday = rainJudged(feed, series, idx);
    for (const g of GROUPS) {
      if (g === "rain" && !rainJudgedToday) continue;
      const channels = CHANNEL_GROUPS[g] as readonly string[];
      if (channels.some((f) => idx.every((i) => !isRead(series[i], f)))) {
        bad.add(g);
        rules.add("R12");
        continue;
      }
      if (flagged("bad", g) > L.flagged_share) bad.add(g);
      else if (flagged("suspect", g) > L.flagged_share) suspect.add(g);
    }
    if (gustDirection) {
      if (idx.every((i) => !hasGustDirection(series[i]))) {
        bad.add("gust_direction");
        rules.add("R12");
      } else if (flagged("bad", "gust_direction") > L.flagged_share) {
        bad.add("gust_direction");
      }
    }
    if (batteryListed && idx.every((i) => typeof series[i].battery_v !== "number")) {
      bad.add("battery");
      rules.add("R12");
    }

    // R11 is judged on the rain day that starts at 09:00 on this date.
    const rain = rainDays.get(date);
    if (rainJudgedToday && rain && gaugesDisagree(rain)) {
      rules.add("R11");
      if (!bad.has("rain")) suspect.add("rain");
    }

    const missing = idx.reduce((s, i) => s + (series[i].gap_minutes ?? 0), 0);
    const missing_minutes = Math.round(missing * 10) / 10;
    const score = Math.max(
      0,
      100 - L.bad_group_penalty * bad.size - L.suspect_group_penalty * suspect.size - missing_minutes / L.missing_minutes_per_point,
    );
    return {
      date,
      score: Math.round(score * 10) / 10,
      bad: [...bad],
      suspect: [...suspect],
      missing_minutes,
      rules: [...rules].sort(),
    };
  });
}

export interface GroupReport {
  group: Group | ExportGroup;
  status: GroupStatus;
  rules: string[];
  empty_channels: string[];
  measured_share: number;
}

/**
 * Status of each channel group over a window, and the rules behind it. With
 * `exportGroups`, the gust-direction column and the battery are reported too;
 * the engines never read them.
 */
export function groupStatus(
  series: DemoObservation[],
  hits = checkReadings(series),
  { feed = null, exportGroups = false, batteryListed = false }: { feed?: Feed; exportGroups?: boolean; batteryListed?: boolean } = {},
): GroupReport[] {
  const L = SENTINEL_LIMITS;
  const all = series.map((_, i) => i);
  const report = (g: Group | ExportGroup, channels: readonly string[], isMeasured: (o: DemoObservation, f: string) => boolean) => {
    const groupHits = hits.filter((h) => groupOf(h.channel) === g);
    const share = (flag: string) =>
      new Set(groupHits.filter((h) => h.flag === flag).map((h) => h.index)).size / Math.max(series.length, 1);
    const empty = channels.filter((f) => series.every((o) => !isMeasured(o, f)));
    const measuredShare = series.length
      ? series.filter((o) => channels.every((f) => isMeasured(o, f))).length / series.length
      : 0;
    return {
      share,
      empty,
      rules: [...new Set([...groupHits.map((h) => h.rule), ...(empty.length ? ["R12"] : [])])].sort(),
      measured_share: Math.round(measuredShare * 1000) / 1000,
    };
  };

  const out: GroupReport[] = GROUPS.map((g) => {
    const r = report(g, CHANNEL_GROUPS[g], isRead);
    let status: GroupStatus = r.empty.length || r.share("bad") > L.flagged_share
      ? "bad"
      : r.share("suspect") > L.flagged_share ? "suspect" : "good";
    const rules = [...r.rules];
    if (g === "rain") {
      if (!rainJudged(feed, series, all)) {
        return { group: g, status: "not_judged", rules: [], empty_channels: [], measured_share: r.measured_share };
      }
      if (status === "good" && [...rainDayTotals(series).values()].some(gaugesDisagree)) {
        status = "suspect";
        rules.push("R11");
      }
    }
    return { group: g, status, rules, empty_channels: r.empty, measured_share: r.measured_share };
  });

  if (exportGroups) {
    if (series.some(hasGustDirection)) {
      const r = report("gust_direction", EXPORT_GROUPS.gust_direction, (o) => hasGustDirection(o));
      out.push({
        group: "gust_direction",
        status: r.share("bad") > L.flagged_share ? "bad" : "good",
        rules: r.rules.filter((rule) => rule !== "R12"),
        empty_channels: [],
        measured_share: r.measured_share,
      });
    }
    const battery = series.filter((o) => typeof o.battery_v === "number").length;
    out.push({
      group: "battery",
      status: battery ? "good" : batteryListed ? "bad" : "not_reported",
      rules: battery || !batteryListed ? [] : ["R12"],
      empty_channels: battery ? [] : ["battery_v"],
      measured_share: series.length ? Math.round((battery / series.length) * 1000) / 1000 : 0,
    });
  }
  return out;
}

const localHour = (ts: string) => new Date(Date.parse(ts) + EAT_OFFSET_MS).getUTCHours();
const isNight = (ts: string) => localHour(ts) >= 19 || localHour(ts) <= 5;

/** Checks on the values the firmware derives, and on the three thermometers. */
export function audits(series: DemoObservation[]) {
  const L = SENTINEL_LIMITS;
  const wb = series.filter((o) => measured(o, "temp_sht") && measured(o, "humidity_sht") && measured(o, "wet_bulb_temp"));
  const stullDiff = wb.map((o) => Math.abs(o.wet_bulb_temp - stullWetBulb(o.temp_sht, o.humidity_sht)));
  const stullMae = stullDiff.length ? stullDiff.reduce((a, b) => a + b, 0) / stullDiff.length : null;

  const fw = wb.filter((o) => typeof o.firmware_wbgt === "number");
  const below = fw.filter((o) => (o.firmware_wbgt as number) < o.wet_bulb_temp);
  const farBelow = fw.filter((o) => (o.firmware_wbgt as number) < o.wet_bulb_temp - L.wbgt_below_wet_bulb_margin_c);
  const share = (part: DemoObservation[], whole: DemoObservation[]) =>
    whole.length ? Math.round((part.length / whole.length) * 1000) / 10 : null;
  const night = fw.filter((o) => isNight(o.ts));
  const day = fw.filter((o) => !isNight(o.ts));

  const pairs = [["temp_sht", "temp_mcp"], ["temp_sht", "temp_bmx"], ["temp_bmx", "temp_mcp"]] as const;
  const thermometers = pairs.map(([a, b]) => {
    const both = series.filter((o) => measured(o, a) && measured(o, b));
    const diffs = both.map((o) => o[a] - o[b]);
    const n = diffs.length || 1;
    return {
      pair: `${a} - ${b}`,
      mean_abs_c: Math.round((diffs.reduce((s, d) => s + Math.abs(d), 0) / n) * 100) / 100,
      mean_signed_c: Math.round((diffs.reduce((s, d) => s + d, 0) / n) * 100) / 100,
      max_abs_c: Math.round(Math.max(0, ...diffs.map(Math.abs)) * 100) / 100,
      slots: diffs.length,
    };
  });

  return {
    A01_wet_bulb_vs_stull: {
      mae_c: stullMae === null ? null : Math.round(stullMae * 1000) / 1000,
      max_c: stullDiff.length ? Math.round(Math.max(...stullDiff) * 1000) / 1000 : null,
      slots: stullDiff.length,
      verdict: stullMae !== null && stullMae <= L.stull_max_mae_c ? "matches Stull" : "does not match Stull",
    },
    A03_firmware_wbgt_vs_wet_bulb: {
      below_pct: share(below, fw),
      far_below_pct: share(farBelow, fw),
      far_below_night_pct: share(night.filter((o) => farBelow.includes(o)), night),
      far_below_day_pct: share(day.filter((o) => farBelow.includes(o)), day),
      slots: fw.length,
      verdict: farBelow.length / Math.max(fw.length, 1) > 0.01 ? "non-standard" : "within tolerance",
    },
    A05_thermometers: thermometers,
  };
}

/**
 * Times the station sent nothing for more than an hour: runs of slots inside
 * gaps between readings, from the last reading before to the first after.
 */
export function gaps(series: DemoObservation[]) {
  const runs: { from: string; to: string; hours: number }[] = [];
  let start: number | null = null;
  let minutes = 0;
  series.forEach((o, i) => {
    const inGap = (o.gap_minutes ?? 0) > 0;
    if (inGap) {
      if (start === null) start = i;
      minutes += o.gap_minutes!;
    }
    if ((!inGap || i === series.length - 1) && start !== null) {
      const end = inGap ? i : i - 1;
      // The missing time starts 15 minutes after the last reading.
      const hours = Math.round(((minutes + 15) / 60) * 10) / 10;
      if (hours > 1) {
        runs.push({ from: series[start].ts, to: new Date(Date.parse(series[end].ts) + 900_000).toISOString(), hours });
      }
      start = null;
      minutes = 0;
    }
  });
  return runs;
}
