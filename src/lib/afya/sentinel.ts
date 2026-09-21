import type { DemoObservation } from "./demo-observations";
import { stullWetBulb } from "./constants";

// Station health: quality rules applied to every measured reading, a daily
// health score, and audits of the values the station's firmware derives.
// The rules follow the Conduit Sentinel specification written for this
// station's one-minute exports, scaled here to the 15-minute data the Conduit
// API and the CHORDS feed serve. Only measured values are judged: a value the
// cleaning step filled in is counted as missing, never as good.

export const SENTINEL_LIMITS = {
  temperature_c: [-5, 45], // R01
  pressure_hpa: [800, 900], // R03, station pressure at 1,523 m
  wind_speed_ms: [0, 60], // R04
  wind_gust_ms: [0, 75], // R04
  light_dark_floor_counts: 240, // R06: the sensor never reads lower in the dark
  max_step_c: 5, // R07: change between two 15-minute slots
  flat_slots: { temp_sht: 8, humidity_sht: 8, press_bmx: 12, wind_spd: 12 }, // R08: two and three hours unchanged
  max_thermometer_spread_c: 2, // R09
  rain_disagreement_mm: 0.4, // R11: one gauge this much in a day, the other nothing
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

export type Group = keyof typeof CHANNEL_GROUPS;
export type GroupStatus = "good" | "suspect" | "bad";
type Channel = (typeof CHANNEL_GROUPS)[Group][number];

const GROUPS = Object.keys(CHANNEL_GROUPS) as Group[];
const SLOT_MINUTES = 15;

const measured = (o: DemoObservation, f: string) => !o.imputed?.includes(f);
const value = (o: DemoObservation, f: Channel) => o[f as keyof DemoObservation] as number;

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
    for (const f of CHANNEL_GROUPS.temperature) {
      if (measured(o, f) && (value(o, f) < L.temperature_c[0] || value(o, f) > L.temperature_c[1])) hit("R01", f, i, "bad");
    }
    if (measured(o, "humidity_sht") && o.humidity_sht <= 0) hit("R02", "humidity_sht", i, "bad");
    if (measured(o, "press_bmx") && (o.press_bmx < L.pressure_hpa[0] || o.press_bmx > L.pressure_hpa[1])) hit("R03", "press_bmx", i, "bad");
    if (measured(o, "wind_spd") && (o.wind_spd < L.wind_speed_ms[0] || o.wind_spd > L.wind_speed_ms[1])) hit("R04", "wind_spd", i, "bad");
    if (measured(o, "wind_gust") && (o.wind_gust < L.wind_gust_ms[0] || o.wind_gust > L.wind_gust_ms[1])) hit("R04", "wind_gust", i, "bad");
    for (const f of CHANNEL_GROUPS.light) {
      if (measured(o, f) && value(o, f) < L.light_dark_floor_counts) hit("R06", f, i, "suspect");
    }
    const prev = series[i - 1];
    if (prev && measured(o, "temp_sht") && measured(prev, "temp_sht") && Math.abs(o.temp_sht - prev.temp_sht) > L.max_step_c) {
      hit("R07", "temp_sht", i, "suspect");
    }
    const temps = CHANNEL_GROUPS.temperature.filter((f) => measured(o, f)).map((f) => value(o, f));
    if (temps.length >= 2 && Math.max(...temps) - Math.min(...temps) > L.max_thermometer_spread_c) {
      for (const f of CHANNEL_GROUPS.temperature) hit("R09", f, i, "suspect");
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
  // real, so only a non-zero wind reading can be stuck.
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
        if (i - start >= run) for (let k = start; k < i; k++) hit("R08", f, k, "suspect");
        start = i;
      }
    }
  }
  return hits;
}

export interface DayHealth {
  date: string;
  score: number;
  bad: Group[];
  suspect: Group[];
  missing_minutes: number;
  rules: string[];
}

function groupOf(channel: string): Group | null {
  return GROUPS.find((g) => (CHANNEL_GROUPS[g] as readonly string[]).includes(channel)) ?? null;
}

/**
 * Health score for each UTC day: 100, less 10 for each channel group that is
 * bad (a channel empty all day, or more than 5 % of slots flagged bad), less 2
 * for each suspect group (more than 5 % flagged suspect, or the rain gauges
 * disagreeing), less 1 for every 14.4 minutes without observations.
 */
export function dailyHealth(series: DemoObservation[], hits = checkReadings(series)): DayHealth[] {
  const L = SENTINEL_LIMITS;
  const byDay = new Map<string, number[]>();
  series.forEach((o, i) => {
    const d = o.ts.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(i);
  });
  const hitsBySlot = new Map<number, RuleHit[]>();
  for (const h of hits) {
    if (!hitsBySlot.has(h.index)) hitsBySlot.set(h.index, []);
    hitsBySlot.get(h.index)!.push(h);
  }

  return [...byDay.entries()].map(([date, idx]) => {
    const bad = new Set<Group>();
    const suspect = new Set<Group>();
    const rules = new Set<string>();
    const dayHits = idx.flatMap((i) => hitsBySlot.get(i) ?? []);
    dayHits.forEach((h) => rules.add(h.rule));

    for (const g of GROUPS) {
      const channels = CHANNEL_GROUPS[g] as readonly string[];
      if (channels.some((f) => idx.every((i) => !measured(series[i], f)))) {
        bad.add(g);
        rules.add("R12");
        continue;
      }
      const flagged = (flag: string) =>
        new Set(dayHits.filter((h) => h.flag === flag && groupOf(h.channel) === g).map((h) => h.index)).size / idx.length;
      if (flagged("bad") > L.flagged_share) bad.add(g);
      else if (flagged("suspect") > L.flagged_share) suspect.add(g);
    }

    // R11: one gauge measures rain on a day the other records none.
    const total = (f: "rg1" | "rg2") => idx.filter((i) => measured(series[i], f)).reduce((s, i) => s + series[i][f], 0);
    const [r1, r2] = [total("rg1"), total("rg2")];
    if ((r1 >= L.rain_disagreement_mm && r2 === 0) || (r2 >= L.rain_disagreement_mm && r1 === 0)) {
      rules.add("R11");
      if (!bad.has("rain")) suspect.add("rain");
    }

    const missingSlots = idx.filter((i) =>
      ["temp_sht", "humidity_sht", "press_bmx"].every((f) => !measured(series[i], f)),
    ).length;
    const missing_minutes = missingSlots * SLOT_MINUTES;
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

/** Status of each channel group over a window, and the rules behind it. */
export function groupStatus(series: DemoObservation[], hits = checkReadings(series)) {
  const L = SENTINEL_LIMITS;
  return GROUPS.map((g) => {
    const channels = CHANNEL_GROUPS[g] as readonly string[];
    const groupHits = hits.filter((h) => groupOf(h.channel) === g);
    const share = (flag: string) =>
      new Set(groupHits.filter((h) => h.flag === flag).map((h) => h.index)).size / Math.max(series.length, 1);
    const empty = channels.filter((f) => series.every((o) => !measured(o, f)));
    const status: GroupStatus = empty.length || share("bad") > L.flagged_share
      ? "bad"
      : share("suspect") > L.flagged_share ? "suspect" : "good";
    const measuredShare = series.length
      ? series.filter((o) => channels.every((f) => measured(o, f))).length / series.length
      : 0;
    return {
      group: g,
      status,
      rules: [...new Set([...groupHits.map((h) => h.rule), ...(empty.length ? ["R12"] : [])])].sort(),
      empty_channels: empty,
      measured_share: Math.round(measuredShare * 1000) / 1000,
    };
  });
}

const localHour = (ts: string) => (new Date(ts).getUTCHours() + 3) % 24;
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

/** Gaps in the record longer than an hour. */
export function gaps(series: DemoObservation[]) {
  const runs: { from: string; to: string; hours: number }[] = [];
  let start: number | null = null;
  series.forEach((o, i) => {
    const missing = ["temp_sht", "humidity_sht", "press_bmx"].every((f) => !measured(o, f));
    if (missing && start === null) start = i;
    if ((!missing || i === series.length - 1) && start !== null) {
      const end = missing ? i : i - 1;
      const hours = ((end - start + 1) * SLOT_MINUTES) / 60;
      if (hours > 1) runs.push({ from: series[start].ts, to: series[end].ts, hours });
      start = null;
    }
  });
  return runs;
}
