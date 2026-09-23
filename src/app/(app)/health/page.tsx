"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/lib/contexts/language";
import { fmtAgo, fmtAsOf, MONTH_NAMES } from "@/lib/afya/format";
import { STRINGS } from "@/lib/afya/i18n";
import { QUALITY_LIMITS } from "@/lib/afya/data-quality";
import type { LiveWindow } from "@/lib/afya/display";
import type { ChordsStation } from "@/lib/afya/sources";
import type { GroupStatus } from "@/lib/afya/sentinel";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

type Status = GroupStatus;

interface Thermometers { pair: string; mean_abs_c: number; mean_signed_c: number; max_abs_c: number; slots: number }
interface Audits {
  A01_wet_bulb_vs_stull: { mae_c: number | null; max_c: number | null; slots: number; verdict: string };
  A02_heat_index_vs_nws: {
    mae_c: number | null; max_c: number | null; slots: number;
    mae_hot_c: number | null; hot_slots: number; hot_from_c: number;
  };
  A03_firmware_wbgt_vs_wet_bulb: {
    below_pct: number | null; far_below_pct: number | null;
    far_below_night_pct: number | null; far_below_day_pct: number | null; slots: number; verdict: string;
  };
  A04_firmware_wbgt_vs_liljegren: {
    hours: number;
    meanSignedC: number;
    meanAbsC: number;
    byHourOfDay: { hourEat: number; meanSignedC: number }[];
    uncertainty: { note: string };
  };
  A05_thermometers: Thermometers[];
}
interface DeviceCodes { reported: boolean; codes: { code: number; slots: number }[]; note: string }
interface Archive {
  first: string;
  last: string;
  slots: number;
  summary: {
    days: number; mean_score: number; days_below_80: number; rain_gauge_disagreement_days: number;
    gauge2_silent_days: number; gauge1_silent_days: number; empty_sensor_days: number;
    missing_minutes: number; days_with_missing_time: number;
  };
  rain: { gauge1_mm: number };
  rule_slots: Record<string, number>;
  gust_direction_copy: { days: number; of: number; share_pct: number | null };
  battery: {
    status: Status; mean_score_if_counted: number; best_score_if_counted: number; days_below_80_if_counted: number;
  };
  audits: Audits;
  device_codes: DeviceCodes;
  gaps: { over_one_hour: number; longest: { from: string; to: string; hours: number } | null };
  days: { date: string; score: number; bad: string[]; suspect: string[]; missing_minutes: number }[];
}
interface HealthResponse {
  // Null for any station but Conduit@Empathy1, the only one with an archive.
  archive: Archive | null;
  // First and last day the archive holds, whichever station is shown.
  archive_span: { first: string; last: string };
  live: {
    source: "live" | "csv" | "demo";
    feed: "jhub" | "chords" | null;
    latest: string | null;
    age_minutes: number | null;
    slots: number;
    // What the checked readings really cover, against the day they stand for.
    window: LiveWindow | null;
    missing_minutes: number;
    groups: { group: string; status: Status; rules: string[]; empty_channels: string[]; measured_share: number }[];
    audits: Audits;
    device_codes: DeviceCodes;
    firmware_below_wet_bulb_now: boolean | null;
  };
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`station health HTTP ${r.status}`);
    return r.json();
  });

// The route's allowlist. sources.ts runs on the server only, so it is
// repeated here; the type keeps every id and name in step with it.
const STATIONS: readonly ChordsStation[] = [
  { id: 61, name: "Conduit@Empathy1" },
  { id: 10, name: "KALRO Thika" },
  { id: 39, name: "Machakos Stoni Athi" },
  { id: 11, name: "Embu" },
];
const CONDUIT_ID = STATIONS[0].id;

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), text);
// An interface string from i18n.ts in both languages, with any {placeholders} filled.
const both = (key: string, values: Record<string, string | number> = {}): [string, string] =>
  [fill(STRINGS.en[key], values), fill(STRINGS.sw[key], values)];

const GROUP_NAMES: Record<string, [string, string]> = {
  temperature: ["Temperature, 3 sensors", "Joto, vipima 3"],
  humidity: ["Humidity", "Unyevu"],
  pressure: ["Pressure", "Shinikizo"],
  wind: ["Wind", "Upepo"],
  light: ["Light sensor", "Kipima mwanga"],
  rain_gauge_1: both("health_group_rain_gauge_1"),
  rain_gauge_2: both("health_group_rain_gauge_2"),
  gust_direction: both("health_group_gust_direction"),
  battery: both("health_group_battery"),
  device_code: both("health_group_device_code"),
};

// A group the feed cannot judge, or that sends nothing, is grey: neither is a fault.
const STATUS_STYLE: Record<Status, string> = {
  good: "bg-afya-green/10 text-afya-green",
  suspect: "bg-afya-gold/15 text-[#7a5c00]",
  bad: "bg-afya-red/10 text-afya-red",
  not_judged: "bg-afya-canvas text-afya-muted",
  not_reported: "bg-afya-canvas text-afya-muted",
};

const STATUS_NAME: Record<Status, [string, string]> = {
  good: ["good", "nzuri"],
  suspect: ["suspect", "ya shaka"],
  bad: ["bad", "mbaya"],
  not_judged: both("health_status_not_judged"),
  not_reported: both("health_status_not_reported"),
};

// What each rule checks, on 15-minute data. The thresholds live in sentinel.ts.
const RULES: [string, string, string][] = [
  ["R01", "Any thermometer below -5 or above 45 °C", "Kipima joto chochote chini ya -5 au juu ya 45 °C"],
  ["R02", ...both("health_rule_r02")],
  ["R03", "Pressure outside 800 to 900 hPa (station at 1,523 m)", "Shinikizo nje ya 800 hadi 900 hPa (kituo kiko mita 1,523)"],
  ["R04", "Wind above 60 m/s or gust above 75 m/s", "Upepo juu ya 60 m/s au upepo mkali juu ya 75 m/s"],
  ["R05", ...both("health_rule_r05")],
  ["R06", "Light reading below the sensor's dark floor of 240 counts", "Mwanga chini ya kiwango cha giza cha kipima, 240"],
  ["R07", ...both("health_rule_r07")],
  ["R08", ...both("health_rule_r08")],
  ["R09", "The three thermometers differ by more than 2 °C", "Vipima joto vitatu vinatofautiana zaidi ya 2 °C"],
  ["R10", ...both("health_rule_r10")],
  ["R11", ...both("health_rule_r11")],
  ["R12", ...both("health_rule_r12")],
  ["R13", ...both("health_rule_r13")],
  ["R14", ...both("health_rule_r14")],
  ["R15", ...both("health_rule_r15")],
  ["R16", "The firmware WBGT is more than 1.5 °C below the wet bulb", "WBGT ya programu dhibiti iko chini ya joto la balbu nyevu kwa zaidi ya 1.5 °C"],
];

const pct = (v: number | null) => (v === null ? "-" : `${v.toFixed(1)} %`);
// An archive day as its own timestamps record it, UTC: "8 Sep 2026".
const archiveDay = (iso: string, sw: boolean) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)} ${MONTH_NAMES[sw ? "sw" : "en"][Number(m) - 1]} ${y}`;
};
// A gap's own times, to the minute, as the readings recorded them.
const utc = (iso: string | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") : "-");
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} °C`;

export default function StationHealthPage() {
  const { t, lang } = useLanguage();
  const sw = lang === "sw";
  const [instrument, setInstrument] = useState<number>(CONDUIT_ID);
  const conduit = instrument === CONDUIT_ID;
  const { data, error } = useSWR<HealthResponse>(
    conduit ? "/api/station-health" : `/api/station-health?instrument=${instrument}`,
    fetcher,
    { refreshInterval: 5 * 60_000 },
  );

  useEffect(() => {
    document.title = `${t("nav_health")} | AFYA MAZINGIRA`;
  }, [t]);

  // Only the first load blanks the page; a station change reloads the live card alone.
  if (conduit && !data) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
      </div>
    );
  }

  const live = data?.live;
  const liveLabel = !live
    ? ""
    : live.source === "live"
      ? `${live.feed === "chords" ? "CHORDS" : "Conduit API"} · ${live.age_minutes === null ? "-" : fmtAgo(live.age_minutes, lang)}`
      : live.source === "csv" ? (sw ? "Kumbukumbu ya kituo" : "Station archive") : "DEMO";
  // For another station the route leaves out groups it has no sensor for.
  const unlisted = live && !conduit
    ? Object.keys(GROUP_NAMES).filter((g) => !live.groups.some((x) => x.group === g))
    : [];
  // Past the age at which the app stops advising, the station is not reporting
  // and no group status below describes it now.
  const silent = !!live && live.age_minutes !== null && live.age_minutes > QUALITY_LIMITS.degraded_max_age_minutes;
  const silentHours = Math.round((live?.age_minutes ?? 0) / 60);
  const span = live?.window ?? null;
  const archiveSpan = data?.archive_span ?? null;
  const rainNotJudged = !!live?.groups.some((g) => g.group.startsWith("rain_gauge") && g.status === "not_judged");
  const batteryMissing = !!live?.groups.some((g) => g.group === "battery" && g.status === "not_reported");
  const codesMissing = !!live?.groups.some((g) => g.group === "device_code" && g.status === "not_reported");
  const codesSeen = live?.device_codes.codes ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("nav_health")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">
          {sw
            ? "Kila usomaji wa kituo cha Conduit hukaguliwa kabla ya kutumika. Ukurasa huu unaonyesha ukaguzi unapata nini, sasa na katika kumbukumbu yote."
            : "Every Conduit reading is checked before the app uses it. This page shows what the checks find, now and across the whole record."}
        </p>
      </div>

      <Card>
        <CardTitle>{sw ? "Ukaguzi unabadilisha nini" : "What the checks change"}</CardTitle>
        <ul className="mt-2 space-y-2 text-sm text-afya-charcoal list-disc pl-5">
          <li>
            {sw
              ? "WBGT ya programu dhibiti inashindwa ukaguzi A03, kwa hiyo programu hukokotoa WBGT kutoka balbu nyevu na joto la hewa badala yake."
              : "The firmware WBGT fails audit A03, so the app computes WBGT from the wet bulb and air temperature instead."}
          </li>
          <li>
            {sw
              ? "Usomaji uliojazwa kwenye mapengo huwekwa alama. Ubora wa data hushuka vipimo muhimu vinapokosekana, na ushauri husimama baada ya saa 3 bila data."
              : "Readings filled in across gaps are marked. Data quality drops when a critical sensor is missing, and advice stops after three hours without data."}
          </li>
          <li>{t("health_change_rain")}</li>
        </ul>
      </Card>

      <div>
        <label htmlFor="health-station" className="text-xs font-semibold text-afya-charcoal block mb-1.5">
          {sw ? "Kituo" : "Station"}
        </label>
        <select
          id="health-station"
          value={instrument}
          onChange={(e) => setInstrument(Number(e.target.value))}
          className="w-full sm:w-72 rounded-xl border border-afya-border bg-white px-3 py-2.5 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green"
        >
          {STATIONS.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-afya-muted">
          {sw
            ? "Ukaguzi uleule huendeshwa bila mabadiliko kwenye kituo chochote cha 3D-PAWS kilicho kwenye tovuti ya CHORDS."
            : "The same checks run unchanged on any 3D-PAWS station on the CHORDS portal."}
        </p>
      </div>

      {live ? (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <CardTitle className="mb-0">
              {span
                ? fill(t("health_live_window"), { hours: span.hours, to: fmtAsOf(span.to, lang) })
                : sw ? "Saa 24 zilizopita" : "The last 24 hours"}
            </CardTitle>
            <span className={cn("text-xs", silent ? "font-bold text-afya-red" : "text-afya-muted")}>{liveLabel}</span>
          </div>
          {silent && span && (
            <>
              <p
                role="alert"
                className="mb-3 flex items-start gap-1.5 rounded-xl bg-afya-red/10 px-3 py-2 text-xs font-semibold text-afya-red"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {fill(t("health_live_silent"), { hours: silentHours, to: fmtAsOf(span.to, lang) })}
              </p>
              <p className="mb-2 text-xs font-semibold text-afya-charcoal">{t("health_live_last_readings")}</p>
            </>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {live.groups.map((g) => (
              <div key={g.group} className="rounded-xl border border-afya-border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-afya-charcoal">{GROUP_NAMES[g.group]?.[sw ? 1 : 0] ?? g.group}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", STATUS_STYLE[g.status])}>
                    {STATUS_NAME[g.status][sw ? 1 : 0]}
                  </span>
                </div>
                <div className="text-xs text-afya-muted mt-1">
                  {sw ? "Imepimwa" : "Measured"}: {Math.round(g.measured_share * 100)} %
                  {g.rules.length ? ` · ${g.rules.join(", ")}` : ""}
                </div>
              </div>
            ))}
          </div>
          {span && span.read_slots < span.of_slots && (
            <p className="mt-3 text-xs text-afya-muted">
              {fill(t("health_live_coverage"), { hours: span.of_hours, read: span.read_slots, of: span.of_slots })}
            </p>
          )}
          {live.missing_minutes > 0 && (
            <p className="mt-3 text-xs text-afya-muted flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-afya-gold" strokeWidth={2} aria-hidden="true" />
              {fill(t("health_live_missing"), { minutes: live.missing_minutes })}
            </p>
          )}
          {rainNotJudged && <p className="mt-3 text-xs text-afya-muted">{t("health_chords_rain_note")}</p>}
          {batteryMissing && <p className="mt-3 text-xs text-afya-muted">{t("health_battery_note")}</p>}
          {codesMissing && <p className="mt-3 text-xs text-afya-muted">{t("health_device_code_note")}</p>}
          {codesSeen.length > 0 && (
            <p className="mt-3 text-xs text-afya-muted">
              {sw ? "Misimbo ya afya ya kifaa" : "Device health codes"}:{" "}
              {codesSeen.map((c) => `${c.code} (${c.slots})`).join(", ")}
              {" - "}
              {sw ? "maana haijaandikwa" : live.device_codes.note}
            </p>
          )}
          {unlisted.length > 0 && (
            <p className="mt-3 text-xs text-afya-muted">
              {sw
                ? `Tovuti haionyeshi kipima cha aina hiyo kwa kituo hiki, hivyo hakikaguliwi: ${unlisted.map((g) => GROUP_NAMES[g][1]).join(", ")}.`
                : `The portal lists no such sensor for this station, so it is not checked: ${unlisted.map((g) => GROUP_NAMES[g][0]).join(", ")}.`}
            </p>
          )}
          {live.firmware_below_wet_bulb_now && (
            <p className="mt-3 text-xs text-afya-muted flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-afya-gold" strokeWidth={2} aria-hidden="true" />
              {sw
                ? "Hivi sasa WBGT ya programu dhibiti iko chini ya balbu nyevu."
                : "Right now the firmware WBGT is below the wet bulb."}
            </p>
          )}
        </Card>
      ) : error ? (
        <Card>
          <p className="text-sm text-afya-muted">
            {sw
              ? "Tovuti ya CHORDS haikurudisha data ya kituo hiki sasa hivi. Jaribu tena baadaye."
              : "The CHORDS portal did not return this station's data just now. Try again later."}
          </p>
        </Card>
      ) : (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}

      {conduit ? (
        data?.archive && <ArchiveRecord archive={data.archive} sw={sw} />
      ) : (
        <Card>
          <p className="text-sm text-afya-muted">
            {archiveSpan &&
              fill(t("health_archive_conduit_only"), {
                from: archiveDay(archiveSpan.first, sw),
                to: archiveDay(archiveSpan.last, sw),
              })}
          </p>
        </Card>
      )}
    </div>
  );
}

function ArchiveRecord({ archive, sw }: { archive: Archive; sw: boolean }) {
  const text = STRINGS[sw ? "sw" : "en"];
  const a03 = archive.audits.A03_firmware_wbgt_vs_wet_bulb;
  const a01 = archive.audits.A01_wet_bulb_vs_stull;
  const a02 = archive.audits.A02_heat_index_vs_nws;
  const a04 = archive.audits.A04_firmware_wbgt_vs_liljegren;
  const a04Morning = a04.byHourOfDay.find((h) => h.hourEat === 9);
  const a04Night = a04.byHourOfDay.find((h) => h.hourEat === 0);
  const shtBmx = archive.audits.A05_thermometers.find((p) => p.pair === "temp_sht - temp_bmx");

  const dayUnit = sw ? "siku" : "days";
  const ruleCount = (id: string) => {
    if (id === "R11") return `${archive.summary.rain_gauge_disagreement_days} ${dayUnit}`;
    if (id === "R12") return `${archive.summary.empty_sensor_days} ${dayUnit}`;
    if (id === "R13") return `${archive.gust_direction_copy.days} ${dayUnit}`;
    return String(archive.rule_slots[id] ?? 0);
  };

  const gustShare = archive.gust_direction_copy.share_pct ?? 0;
  const codeList = archive.device_codes.codes.map((c) => `${c.code} (${c.slots})`).join(", ");
  const longest = archive.gaps.longest;
  // The archive export has no battery column, so the score cannot judge it.
  const notScored = archive.battery.status === "not_reported";
  const battery = {
    mean: archive.battery.mean_score_if_counted,
    best: archive.battery.best_score_if_counted,
    below: archive.battery.days_below_80_if_counted,
    days: archive.summary.days,
  };
  // Where the battery is out of the score, the second tile is what the same
  // days come to with it counted, so the mean never stands on its own.
  const scoreTiles: [string, string][] = notScored
    ? [
        [text.health_tile_mean_score, String(archive.summary.mean_score)],
        [text.health_tile_mean_with_battery, String(battery.mean)],
      ]
    : [
        [sw ? "Alama ya wastani" : "Mean score", String(archive.summary.mean_score)],
        [sw ? "Siku chini ya 80" : "Days below 80", String(archive.summary.days_below_80)],
      ];
  const findings: [string, string][] = [
    [
      `The firmware WBGT is more than 1.5 °C below the wet bulb in ${pct(a03.far_below_pct)} of the record (${pct(a03.far_below_night_pct)} at night, ${pct(a03.far_below_day_pct)} by day). A WBGT below the wet bulb is not physically possible in shade, so the formula in the firmware should be checked.`,
      `WBGT ya programu dhibiti iko chini ya balbu nyevu kwa zaidi ya 1.5 °C katika ${pct(a03.far_below_pct)} ya kumbukumbu (${pct(a03.far_below_night_pct)} usiku, ${pct(a03.far_below_day_pct)} mchana). Hilo haliwezekani kivulini, hivyo fomula ya programu dhibiti ikaguliwe.`,
    ],
    both("health_finding_gauges", { g2: archive.summary.gauge2_silent_days, g1: archive.summary.gauge1_silent_days }),
    both("health_finding_uv_column"),
    archive.device_codes.reported
      ? [
          `The station raised these device health codes, each with the 15-minute slots it appeared in: ${codeList}. What they mean is undocumented, so they cannot be acted on; JHUB should document them.`,
          `Kituo kilitoa misimbo hii ya afya ya kifaa, kila mmoja na vipindi vya dakika 15 ulivyotokea: ${codeList}. Maana yake haijaandikwa, kwa hiyo haiwezi kufanyiwa kazi; JHUB waiandike.`,
        ] as [string, string]
      : both("health_finding_device_codes"),
    [
      `The gust-direction column repeats the gust speed on ${archive.gust_direction_copy.days} of ${archive.gust_direction_copy.of} days (${gustShare} % of readings), so gust direction cannot be used. The export should be fixed.`,
      `Safu ya mwelekeo wa upepo mkali inarudia kasi yake siku ${archive.gust_direction_copy.days} kati ya ${archive.gust_direction_copy.of} (${gustShare} % ya usomaji), hivyo haiwezi kutumika. Uhamishaji wa data urekebishwe.`,
    ],
    ...(notScored ? [both("health_finding_battery", battery)] : []),
    both("health_finding_gaps", {
      days: archive.summary.days_with_missing_time,
      minutes: archive.summary.missing_minutes,
      hours: (longest?.hours ?? 0).toFixed(1),
      from: utc(longest?.from),
      to: utc(longest?.to),
    }),
    [
      `The firmware wet bulb matches Stull (2011) to ${a01.mae_c?.toFixed(3) ?? "-"} °C on average, so it is sound and the app uses it.`,
      `Balbu nyevu ya programu dhibiti inalingana na Stull (2011) kwa wastani wa ${a01.mae_c?.toFixed(3) ?? "-"} °C, hivyo ni sahihi na programu inaitumia.`,
    ],
    [
      `The firmware heat index follows the NWS (Rothfusz) formula to ${a02.mae_hot_c?.toFixed(3) ?? "-"} °C on average from ${a02.hot_from_c} °C up, the heat that formula is built for, and to ${a02.mae_c?.toFixed(3) ?? "-"} °C over the whole record. Reported for information; nothing here needs changing.`,
      `Kipimo cha joto cha programu dhibiti kinafuata fomula ya NWS (Rothfusz) kwa wastani wa ${a02.mae_hot_c?.toFixed(3) ?? "-"} °C kuanzia ${a02.hot_from_c} °C kwenda juu, joto ambalo fomula hiyo imeundwa kwa ajili yake, na kwa ${a02.mae_c?.toFixed(3) ?? "-"} °C katika kumbukumbu yote. Ni taarifa tu; hakuna la kurekebisha hapa.`,
    ],
    ...(shtBmx
      ? ([[
          `The SHT thermometer reads ${signed(shtBmx.mean_signed_c)} against the BMX on average: a steady offset worth noting when comparing the two.`,
          `Kipima joto cha SHT kinasoma ${signed(shtBmx.mean_signed_c)} ikilinganishwa na BMX kwa wastani: tofauti thabiti ya kuzingatia.`,
        ]] as [string, string][])
      : []),
  ];

  return (
    <>
      <Card>
        <CardTitle>
          {fill(text.health_archive_span, {
            from: archiveDay(archive.first, sw),
            to: archiveDay(archive.last, sw),
          })}
        </CardTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-2 mb-4">
          {[
            [sw ? "Siku" : "Days", String(archive.summary.days)],
            ...scoreTiles,
            [sw ? "Mapengo zaidi ya saa 1" : "Gaps over an hour", String(archive.gaps.over_one_hour)],
            [text.health_tile_rain, `${Math.round(archive.rain.gauge1_mm).toLocaleString("en")} mm`],
            [text.health_tile_gauge2_silent, String(archive.summary.gauge2_silent_days)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-afya-canvas px-3 py-2">
              <div className="text-[11px] text-afya-muted">{label}</div>
              <div className="text-lg font-bold text-afya-charcoal">{value}</div>
            </div>
          ))}
        </div>
        <div className="h-44" role="img" aria-label={sw ? "Alama ya afya kwa kila siku" : "Health score for each day"}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={archive.days} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={60} tickFormatter={(d: string) => d.slice(0, 7)} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [v, sw ? "Alama" : "Score"]} />
              <Bar dataKey="score" fill="#006B3C" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {notScored && (
          <p className="mt-3 text-xs text-afya-muted">{fill(text.health_battery_not_scored, battery)}</p>
        )}
        <p className="mt-3 text-xs text-afya-muted">{text.health_score_rule}</p>
        <p className="mt-2 text-xs text-afya-muted">{text.health_suspect_tier}</p>
      </Card>

      <Card>
        <CardTitle>{sw ? "Ukaguzi wa thamani za programu dhibiti na vipima" : "Firmware and sensor audits"}</CardTitle>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-afya-border/50">
              <tr>
                <th scope="row" className="py-2 pr-4 text-left font-semibold text-afya-charcoal">A01</th>
                <td className="py-2 pr-4 text-afya-muted">{sw ? "Balbu nyevu dhidi ya Stull (2011)" : "Wet bulb against Stull (2011)"}</td>
                <td className="py-2 pr-4">{sw ? "tofauti ya wastani" : "mean difference"} {a01.mae_c?.toFixed(3)} °C</td>
                <td className="py-2"><Verdict ok={a01.verdict === "matches Stull"} text={a01.verdict} /></td>
              </tr>
              <tr>
                <th scope="row" className="py-2 pr-4 text-left font-semibold text-afya-charcoal">A02</th>
                <td className="py-2 pr-4 text-afya-muted">
                  {sw ? "Kipimo cha joto dhidi ya NWS (Rothfusz)" : "Heat index against the NWS (Rothfusz)"}
                </td>
                <td className="py-2 pr-4">
                  {sw ? "tofauti ya wastani" : "mean difference"} {a02.mae_c?.toFixed(3) ?? "-"} °C
                  {"; "}
                  {sw
                    ? `kuanzia ${a02.hot_from_c} °C kwenda juu, ${a02.mae_hot_c?.toFixed(3) ?? "-"} °C`
                    : `from ${a02.hot_from_c} °C up, ${a02.mae_hot_c?.toFixed(3) ?? "-"} °C`}
                </td>
                <td className="py-2 text-xs text-afya-muted">{sw ? "taarifa tu" : "report only"}</td>
              </tr>
              <tr>
                <th scope="row" className="py-2 pr-4 text-left font-semibold text-afya-charcoal">A03</th>
                <td className="py-2 pr-4 text-afya-muted">{sw ? "WBGT ya programu dhibiti dhidi ya balbu nyevu" : "Firmware WBGT against the wet bulb"}</td>
                <td className="py-2 pr-4">
                  {sw ? "chini" : "below"} {pct(a03.below_pct)}; {sw ? "zaidi ya 1.5 °C chini" : "more than 1.5 °C below"} {pct(a03.far_below_pct)}
                </td>
                <td className="py-2"><Verdict ok={a03.verdict !== "non-standard"} text={a03.verdict} /></td>
              </tr>
              <tr>
                <th scope="row" className="py-2 pr-4 text-left font-semibold text-afya-charcoal">A04</th>
                <td className="py-2 pr-4 text-afya-muted">
                  {sw ? "WBGT ya programu dhibiti dhidi ya Liljegren (2008)" : "Firmware WBGT against Liljegren (2008)"}
                </td>
                <td className="py-2 pr-4">
                  {sw ? "wastani" : "mean"} {signed(a04.meanSignedC)};{" "}
                  {sw
                    ? `${signed(a04Morning?.meanSignedC ?? 0)} saa 09:00, ${signed(a04Night?.meanSignedC ?? 0)} usiku wa manane`
                    : `${signed(a04Morning?.meanSignedC ?? 0)} at 09:00, ${signed(a04Night?.meanSignedC ?? 0)} at midnight`}
                </td>
                <td className="py-2 text-xs text-afya-muted">{sw ? "taarifa tu" : "report only"}</td>
              </tr>
              {archive.audits.A05_thermometers.map((p) => (
                <tr key={p.pair}>
                  <th scope="row" className="py-2 pr-4 text-left font-semibold text-afya-charcoal">A05</th>
                  <td className="py-2 pr-4 text-afya-muted">{p.pair.replace(/temp_/g, "").replace(" - ", " − ").toUpperCase()}</td>
                  <td className="py-2 pr-4">
                    {sw ? "wastani" : "mean"} {signed(p.mean_signed_c)}, {sw ? "kubwa zaidi" : "largest"} {p.max_abs_c.toFixed(1)} °C
                  </td>
                  <td className="py-2 text-xs text-afya-muted">{sw ? "taarifa tu" : "report only"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-afya-muted leading-relaxed">
          {sw
            ? "A04 hulinganisha WBGT ya programu dhibiti na makadirio, si kipimo: kituo hakina kipima mionzi ya jua. "
            : "A04 compares the firmware against an estimate, not a measurement: the station has no pyranometer. "}
          {a04.uncertainty.note}
        </p>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-5 h-5 text-afya-deep" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{sw ? "Matokeo ya kuripoti kwa JHUB" : "Findings to report to JHUB"}</CardTitle>
        </div>
        <ol className="space-y-2 text-sm text-afya-charcoal list-decimal pl-5">
          {findings.map(([en, swText], i) => <li key={i}>{sw ? swText : en}</li>)}
        </ol>
      </Card>

      <Card>
        <CardTitle>{sw ? "Kanuni" : "The rules"}</CardTitle>
        <p className="text-xs text-afya-muted mt-1 mb-3">
          {sw
            ? "Kutoka maelezo ya Conduit Sentinel ya data ya kila dakika, yamepimwa upya kwa data ya dakika 15. Thamani zilizojazwa hazihukumiwi."
            : "From the Conduit Sentinel specification for one-minute data, scaled to the 15-minute data served here. Filled-in values are never judged."}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-afya-border/50">
              {RULES.map(([id, en, swText]) => (
                <tr key={id}>
                  <th scope="row" className="py-1.5 pr-4 text-left font-semibold text-afya-charcoal">{id}</th>
                  <td className="py-1.5 pr-4 text-afya-muted">{sw ? swText : en}</td>
                  <td className="py-1.5 text-right text-xs text-afya-muted">{ruleCount(id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-afya-muted mt-2">
          {sw
            ? "Namba ya mwisho: vipindi vya dakika 15 vilivyoguswa katika kumbukumbu, au siku kwa R11 hadi R13."
            : "Last column: 15-minute slots each rule touched across the record, or days for R11 to R13."}
        </p>
        <p className="text-xs text-afya-muted mt-2">{text.health_rain_day_note}</p>
      </Card>
    </>
  );
}

function Verdict({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", ok ? STATUS_STYLE.good : STATUS_STYLE.bad)}>
      {ok ? <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> : <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
      {text}
    </span>
  );
}
