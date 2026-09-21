"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/lib/contexts/language";
import { fmtAgo } from "@/lib/afya/format";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

type Status = "good" | "suspect" | "bad";

interface Thermometers { pair: string; mean_abs_c: number; mean_signed_c: number; max_abs_c: number; slots: number }
interface Audits {
  A01_wet_bulb_vs_stull: { mae_c: number | null; max_c: number | null; slots: number; verdict: string };
  A03_firmware_wbgt_vs_wet_bulb: {
    below_pct: number | null; far_below_pct: number | null;
    far_below_night_pct: number | null; far_below_day_pct: number | null; slots: number; verdict: string;
  };
  A05_thermometers: Thermometers[];
}
interface HealthResponse {
  archive: {
    first: string;
    last: string;
    slots: number;
    summary: { days: number; mean_score: number; days_below_80: number; rain_gauge_disagreement_days: number; empty_sensor_days: number };
    rule_slots: Record<string, number>;
    gust_direction_copy: { days: number; of: number; share_of_rows_pct: number };
    audits: Audits;
    gaps: { over_one_hour: number; longest: { from: string; to: string; hours: number } | null };
    days: { date: string; score: number; bad: string[]; suspect: string[]; missing_minutes: number }[];
  };
  live: {
    source: "live" | "csv" | "demo";
    feed: "jhub" | "chords" | null;
    latest: string | null;
    age_minutes: number | null;
    slots: number;
    groups: { group: string; status: Status; rules: string[]; empty_channels: string[]; measured_share: number }[];
    audits: Audits;
    firmware_below_wet_bulb_now: boolean | null;
  };
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const GROUP_NAMES: Record<string, [string, string]> = {
  temperature: ["Temperature, 3 sensors", "Joto, vipima 3"],
  humidity: ["Humidity", "Unyevu"],
  pressure: ["Pressure", "Shinikizo"],
  wind: ["Wind", "Upepo"],
  light: ["Light sensor", "Kipima mwanga"],
  rain: ["Rain gauges", "Vipimo vya mvua"],
};

const STATUS_STYLE: Record<Status, string> = {
  good: "bg-afya-green/10 text-afya-green",
  suspect: "bg-afya-gold/15 text-[#7a5c00]",
  bad: "bg-afya-red/10 text-afya-red",
};

const STATUS_NAME: Record<Status, [string, string]> = {
  good: ["good", "nzuri"],
  suspect: ["suspect", "ya shaka"],
  bad: ["bad", "mbaya"],
};

// What each rule checks, on 15-minute data. The thresholds live in sentinel.ts.
const RULES: [string, string, string][] = [
  ["R01", "Any thermometer below -5 or above 45 °C", "Kipima joto chochote chini ya -5 au juu ya 45 °C"],
  ["R02", "Humidity at or below 0 %", "Unyevu wa 0 % au chini"],
  ["R03", "Pressure outside 800 to 900 hPa (station at 1,523 m)", "Shinikizo nje ya 800 hadi 900 hPa (kituo kiko mita 1,523)"],
  ["R04", "Wind above 60 m/s or gust above 75 m/s", "Upepo juu ya 60 m/s au upepo mkali juu ya 75 m/s"],
  ["R06", "Light reading below the sensor's dark floor of 240 counts", "Mwanga chini ya kiwango cha giza cha kipima, 240"],
  ["R07", "Temperature jumps more than 5 °C in 15 minutes", "Joto linaruka zaidi ya 5 °C kwa dakika 15"],
  ["R08", "The same value for 2 hours (temperature, humidity) or 3 hours (pressure, non-zero wind)", "Thamani ileile kwa saa 2 (joto, unyevu) au saa 3 (shinikizo, upepo usio sifuri)"],
  ["R09", "The three thermometers differ by more than 2 °C", "Vipima joto vitatu vinatofautiana zaidi ya 2 °C"],
  ["R11", "One rain gauge records 0.4 mm or more in a day while the other records nothing", "Kipima mvua kimoja kinarekodi 0.4 mm au zaidi kwa siku na kingine hakirekodi chochote"],
  ["R12", "A sensor reports nothing for a whole day", "Kipima hakitoi chochote kwa siku nzima"],
  ["R13", "The gust-direction column is a copy of the gust speed", "Safu ya mwelekeo wa upepo mkali ni nakala ya kasi yake"],
  ["R16", "The firmware WBGT is more than 1.5 °C below the wet bulb", "WBGT ya programu dhibiti iko chini ya joto la balbu nyevu kwa zaidi ya 1.5 °C"],
];

const pct = (v: number | null) => (v === null ? "-" : `${v.toFixed(1)} %`);
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} °C`;

export default function StationHealthPage() {
  const { t, lang } = useLanguage();
  const sw = lang === "sw";
  const { data, isLoading } = useSWR<HealthResponse>("/api/station-health", fetcher, { refreshInterval: 5 * 60_000 });

  useEffect(() => {
    document.title = `${t("nav_health")} | AFYA MAZINGIRA`;
  }, [t]);

  if (isLoading || !data) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
      </div>
    );
  }

  const { archive, live } = data;
  const a03 = archive.audits.A03_firmware_wbgt_vs_wet_bulb;
  const a01 = archive.audits.A01_wet_bulb_vs_stull;
  const shtBmx = archive.audits.A05_thermometers.find((p) => p.pair === "temp_sht - temp_bmx");
  const liveLabel = live.source === "live"
    ? `${live.feed === "chords" ? "CHORDS" : "Conduit API"} · ${live.age_minutes === null ? "-" : fmtAgo(live.age_minutes, lang)}`
    : live.source === "csv" ? (sw ? "Kumbukumbu ya kituo" : "Station archive") : "DEMO";

  const dayUnit = sw ? "siku" : "days";
  const ruleCount = (id: string) => {
    if (id === "R11") return `${archive.summary.rain_gauge_disagreement_days} ${dayUnit}`;
    if (id === "R12") return `${archive.summary.empty_sensor_days} ${dayUnit}`;
    if (id === "R13") return `${archive.gust_direction_copy.days} ${dayUnit}`;
    return String(archive.rule_slots[id] ?? 0);
  };

  const findings: [string, string][] = [
    [
      `The firmware WBGT is more than 1.5 °C below the wet bulb in ${pct(a03.far_below_pct)} of the record (${pct(a03.far_below_night_pct)} at night, ${pct(a03.far_below_day_pct)} by day). A WBGT below the wet bulb is not physically possible in shade, so the formula in the firmware should be checked.`,
      `WBGT ya programu dhibiti iko chini ya balbu nyevu kwa zaidi ya 1.5 °C katika ${pct(a03.far_below_pct)} ya kumbukumbu (${pct(a03.far_below_night_pct)} usiku, ${pct(a03.far_below_day_pct)} mchana). Hilo haliwezekani kivulini, hivyo fomula ya programu dhibiti ikaguliwe.`,
    ],
    [
      `Rain gauge 2 recorded nothing on ${archive.summary.rain_gauge_disagreement_days} days when gauge 1 measured 0.4 mm or more. It may be blocked or disconnected; check it during the next rain.`,
      `Kipima mvua 2 hakikurekodi chochote siku ${archive.summary.rain_gauge_disagreement_days} ambazo kipima 1 kilipima 0.4 mm au zaidi. Huenda kimeziba au hakijaunganishwa; kikaguliwe mvua ijayo.`,
    ],
    [
      `The gust-direction column repeats the gust speed on ${archive.gust_direction_copy.days} of ${archive.gust_direction_copy.of} days (${archive.gust_direction_copy.share_of_rows_pct} % of rows), so gust direction cannot be used. The export should be fixed.`,
      `Safu ya mwelekeo wa upepo mkali inarudia kasi yake siku ${archive.gust_direction_copy.days} kati ya ${archive.gust_direction_copy.of} (${archive.gust_direction_copy.share_of_rows_pct} % ya safu), hivyo haiwezi kutumika. Uhamishaji wa data urekebishwe.`,
    ],
    [
      `The firmware wet bulb matches Stull (2011) to ${a01.mae_c?.toFixed(3) ?? "-"} °C on average, so it is sound and the app uses it.`,
      `Balbu nyevu ya programu dhibiti inalingana na Stull (2011) kwa wastani wa ${a01.mae_c?.toFixed(3) ?? "-"} °C, hivyo ni sahihi na programu inaitumia.`,
    ],
    ...(shtBmx
      ? ([[
          `The SHT thermometer reads ${signed(shtBmx.mean_signed_c)} against the BMX on average: a steady offset worth noting when comparing the two.`,
          `Kipima joto cha SHT kinasoma ${signed(shtBmx.mean_signed_c)} ikilinganishwa na BMX kwa wastani: tofauti thabiti ya kuzingatia.`,
        ]] as [string, string][])
      : []),
  ];

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
          <li>
            {sw
              ? "Kwa kuwa kipima mvua 2 hakiaminiki, mvua ikipimwa na kipima chochote huhesabiwa, na jumla za mvua hutoka ERA5-Land."
              : "Because rain gauge 2 cannot be trusted, rain from either gauge counts as rain, and rainfall totals come from ERA5-Land."}
          </li>
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <CardTitle className="mb-0">{sw ? "Saa 24 zilizopita" : "The last 24 hours"}</CardTitle>
          <span className="text-xs text-afya-muted">{liveLabel}</span>
        </div>
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
        {live.feed === "chords" && (
          <p className="mt-3 text-xs text-afya-muted">
            {sw
              ? "Mtiririko wa moja kwa moja wa CHORDS haubebi vipimo vya mvua, kwa hiyo vipima mvua vinaonekana kimya hapa. Kumbukumbu hapa chini inaonyesha jinsi vinavyofanya kazi."
              : "The CHORDS live feed carries no rain readings, so the rain gauges look silent here. The record below shows how they actually behave."}
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

      <Card>
        <CardTitle>{sw ? "Kila siku tangu Juni 2025" : "Every day since June 2025"}</CardTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 mb-4">
          {[
            [sw ? "Siku" : "Days", String(archive.summary.days)],
            [sw ? "Alama ya wastani" : "Mean score", String(archive.summary.mean_score)],
            [sw ? "Siku chini ya 80" : "Days below 80", String(archive.summary.days_below_80)],
            [sw ? "Mapengo zaidi ya saa 1" : "Gaps over an hour", String(archive.gaps.over_one_hour)],
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
              <YAxis domain={[80, 100]} tick={{ fontSize: 10 }} allowDataOverflow />
              <Tooltip formatter={(v) => [v, sw ? "Alama" : "Score"]} />
              <Bar dataKey="score" fill="#006B3C" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-xs text-afya-muted">
          {sw
            ? "Alama = 100, toa 10 kwa kila kundi la vipima lililo baya, 2 kwa kila lenye shaka, na 1 kwa kila dakika 14.4 bila data. WBGT ya programu dhibiti hukaguliwa kando (A03), si kwenye alama."
            : "Score = 100, less 10 for each sensor group that is bad, 2 for each that is suspect, and 1 for every 14.4 minutes without data. The firmware WBGT is judged separately (A03), not in the score."}
        </p>
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
                <th scope="row" className="py-2 pr-4 text-left font-semibold text-afya-charcoal">A03</th>
                <td className="py-2 pr-4 text-afya-muted">{sw ? "WBGT ya programu dhibiti dhidi ya balbu nyevu" : "Firmware WBGT against the wet bulb"}</td>
                <td className="py-2 pr-4">
                  {sw ? "chini" : "below"} {pct(a03.below_pct)}; {sw ? "zaidi ya 1.5 °C chini" : "more than 1.5 °C below"} {pct(a03.far_below_pct)}
                </td>
                <td className="py-2"><Verdict ok={a03.verdict !== "non-standard"} text={a03.verdict} /></td>
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
      </Card>
    </div>
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
