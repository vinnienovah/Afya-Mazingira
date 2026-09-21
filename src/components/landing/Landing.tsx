"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  Globe, ArrowRight, CalendarCheck, LayoutDashboard, TrendingUp,
  Map as MapIcon, History, Building2, Radio, Wind, CloudRain,
  Satellite, X, Sparkles,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/language";
import { STATES } from "@/lib/afya/constants";
import { fmtAgo } from "@/lib/afya/format";
import type { SituationResult, Lang } from "@/lib/afya/types";

// Landing page text in English and Kiswahili
const L: Record<Lang, Record<string, string>> = {
  en: {
    nav_open_app: "Open the App",
    hero_badge: "Hyperlocal environmental intelligence · JKUAT / Juja, Kenya",
    hero_title_a: "From environmental data",
    hero_title_b: "to early action.",
    hero_sub:
      "AFYA MAZINGIRA turns live Conduit observations into environmental states, short-horizon forecasts, activity-aware risk and a recommended best time to act, before conditions peak.",
    hero_cta_primary: "Open the Dashboard",
    hero_cta_secondary: "Plan an Activity",
    live_label: "Current station situation",
    live_connecting: "Connecting to the JKUAT station…",
    stats_observations: "observations analysed",
    stats_states: "environmental states",
    stats_horizons: "forecast horizons",
    stats_languages: "languages",
    problem_kicker: "The interpretation gap",
    problem_title: "Sensors tell you what. They don't tell you what to do.",
    problem_sub: "A person does not need temperature, humidity and wind. They need to know whether conditions are becoming more demanding, and what to change.",
    problem_card_a_title: "A conventional dashboard",
    problem_card_a_note: "The user still has to work out what these numbers mean.",
    problem_card_b_title: "AFYA MAZINGIRA",
    problem_card_b_note: "Situation → meaning → action → explanation.",
    problem_card_b_tag: "Example output",
    pipeline_kicker: "Deterministic pipeline",
    pipeline_title: "Every recommendation is computed, not guessed",
    pipeline_note: "The AI communication layer sits strictly downstream of this quality-checked chain. It explains results, it never produces them.",
    states_kicker: "Climate Reflex",
    states_title: "The environment has four states",
    states_sub: "Discovered from real station behaviour, not imposed by hand.",
    features_kicker: "Product",
    features_title: "Built for decisions",
    provenance_kicker: "Data provenance",
    provenance_title: "Every number has a source",
    provenance_sub: "Measured, predicted, satellite-derived and regional-model data are always visually distinct, never blurred together.",
    nongoals_kicker: "Scientific honesty",
    nongoals_title: "What AFYA MAZINGIRA does not claim",
    nongoals_sub: "A smaller number of defensible capabilities beats a longer list of impressive-sounding claims.",
    cta_title: "See it working, right now",
    cta_sub: "Live station data, deterministic forecasts and a recommended window, in English or Kiswahili.",
    cta_button: "Open AFYA MAZINGIRA",
    footer_motto: "From environmental data to early action.",
    footer_disclaimer: "AFYA MAZINGIRA provides environmental decision support. It does not provide medical diagnosis, emergency-response instructions, or clinical advice.",
    footer_poc: "Proof of concept · JKUAT / Juja · Built on the JHUB Africa Conduit station",
    lang_label: "Language",
  },
  sw: {
    nav_open_app: "Fungua Programu",
    hero_badge: "Ujasusi wa mazingira wa kimaeneo · JKUAT / Juja, Kenya",
    hero_title_a: "Kutoka data ya mazingira",
    hero_title_b: "hadi hatua za mapema.",
    hero_sub:
      "AFYA MAZINGIRA hubadilisha vipimo vya moja kwa moja vya Conduit kuwa hali za mazingira, utabiri wa muda mfupi, hatari inayolingana na shughuli, na wakati bora wa kutenda, kabla ya hali kufikia kilele.",
    hero_cta_primary: "Fungua Dashibodi",
    hero_cta_secondary: "Panga Shughuli",
    live_label: "Hali ya sasa ya kituo",
    live_connecting: "Inaunganisha na kituo cha JKUAT…",
    stats_observations: "uchunguzi uliochambuliwa",
    stats_states: "hali za mazingira",
    stats_horizons: "vipindi vya utabiri",
    stats_languages: "lugha",
    problem_kicker: "Mgogoro wa tafsiri",
    problem_title: "Vipimo vinaambia nini kimefanyika. Havinaambi nini ufanye.",
    problem_sub: "Mtu hahitaji joto, unyevu na upepo pekee. Anahitaji kujua kama hali inazidi kuwa ngumu, na nini abadilishe.",
    problem_card_a_title: "Dashibodi ya kawaida",
    problem_card_a_note: "Mtumiaji bado lazima afikiri nini maana ya namba hizi.",
    problem_card_b_title: "AFYA MAZINGIRA",
    problem_card_b_note: "Hali → maana → hatua → maelezo.",
    problem_card_b_tag: "Mfano wa matokeo",
    pipeline_kicker: "Mnyororo wa kisayansi",
    pipeline_title: "Kila pendekezo linahesabiwa, halikuchaguliwa kwa bahati",
    pipeline_note: "Safu ya AI ya mawasiliano iko chini kabisa ya mnyororo huu uliothibitishwa. Hueleza matokeo, haitoi matokeo.",
    states_kicker: "Climate Reflex",
    states_title: "Mazingira yana hali nne",
    states_sub: "Ziligunduliwa kutoka kitendo halisi cha kituo, hazikuwekwa kwa mkono.",
    features_kicker: "Bidhaa",
    features_title: "Imejengwa kwa maamuzi",
    provenance_kicker: "Chanzo cha data",
    provenance_title: "Kila namba ina chanzo",
    provenance_sub: "Data iliyopimwa, iliyotabiriwa, ya sayeti na ya kikanda huonyeshwa tofauti kila wakati, hazichanganywi.",
    nongoals_kicker: "Uaminifu wa kisayansi",
    nongoals_title: "AFYA MAZINGIRA haijidai yapi?",
    nongoals_sub: "Idadi ndogo ya uwezo unaoweza kuthibitishwa ni bora kuliko orodha ndefu ya madai yenye mwonekano tu.",
    cta_title: "Ona inavyofanya kazi, sasa hivi",
    cta_sub: "Data ya moja kwa moja ya kituo, utabiri wa kisayansi na dirisha lililopendekezwa, kwa Kiingereza au Kiswahili.",
    cta_button: "Fungua AFYA MAZINGIRA",
    footer_motto: "Kutoka data ya mazingira hadi hatua za mapema.",
    footer_disclaimer: "AFYA MAZINGIRA hutoa msaada wa maamuzi ya mazingira. Haitoi utambuzi wa matibabu, maelekezo ya dharura, au ushauri wa kliniki.",
    footer_poc: "Uthibitisho wa dhana · JKUAT / Juja · Imejengwa kwenye kituo cha Conduit cha JHUB Africa",
    lang_label: "Lugha",
  },
};

const PIPELINE: { en: string; sw: string }[] = [
  { en: "Conduit data", sw: "Data ya Conduit" },
  { en: "Quality control", sw: "Udhibiti wa ubora" },
  { en: "Feature engineering", sw: "Uhandisi wa vipengele" },
  { en: "Climate Reflex state", sw: "Hali ya Climate Reflex" },
  { en: "Forecast +1/+3/+6/+9h", sw: "Utabiri +1/+3/+6/+9s" },
  { en: "Risk interpretation", sw: "Tafsiri ya hatari" },
  { en: "Best-Time engine", sw: "Injini ya Wakati-Bora" },
  { en: "Grounded explanation", sw: "Maelezo ya kuthibitishwa" },
];

const STATE_DESCRIPTIONS: Record<number, { en: string; sw: string; time_en: string; time_sw: string }> = {
  0: { en: "Lower temperature, high humidity, weak wind and low radiation.", sw: "Joto la chini, unyevu mkubwa, upepo mdogo na mionzi ya chini.", time_en: "Typical overnight", time_sw: "Ya kawaida usiku" },
  1: { en: "Temperature rising quickly while humidity falls and radiation climbs.", sw: "Joto linaongezeka haraka, unyevu unapungua, mionzi inapanda.", time_en: "Morning transition", time_sw: "Mabadiliko ya asubuhi" },
  2: { en: "Peak temperature and radiation with stronger wind and elevated exposure.", sw: "Joto na mionzi ya kilele yenye upepo mkubwa na kupatwa juu.", time_en: "Daytime maximum", time_sw: "Kilele cha mchana" },
  3: { en: "Temperature falling, humidity recovering and radiation declining.", sw: "Joto linapungua, unyevu unarejea, mionzi inapungua.", time_en: "Evening recovery", time_sw: "Kupona jioni" },
};

const FEATURES = [
  { icon: LayoutDashboard, href: "/situation", en: "Situation", sw: "Hali ya Sasa", d_en: "The current state, exposure level and recommended action, in seconds.", d_sw: "Hali ya sasa, kiwango cha kupatwa na hatua inayopendekezwa, kwa sekunde chache." },
  { icon: TrendingUp, href: "/forecast", en: "Forecast", sw: "Utabiri", d_en: "Measured history, dashed forecast and calibrated uncertainty bands.", d_sw: "Historia iliyopimwa, utabiri na utata uliorekebishwa." },
  { icon: CalendarCheck, href: "/plan", en: "Plan My Activity", sw: "Panga Shughuli", d_en: "Deterministic best-time windows for your activity and duration.", d_sw: "Madirisha bora ya kisayansi kwa shughuli na muda wako." },
  { icon: MapIcon, href: "/map", en: "Risk Map", sw: "Ramani ya Hatari", d_en: "Regional environmental outlook with full provenance for every layer.", d_sw: "Muonekano wa mazingira wa kikanda wenye vyanzo kamili." },
  { icon: History, href: "/replay", en: "Historical Replay", sw: "Marudio", d_en: "Replay any day with the future hidden, then reveal what actually happened.", d_sw: "Rudia siku yoyote na wakati ujao umejifichwa, kisha funua yaliyotokea." },
  { icon: Building2, href: "/operations", en: "Operations", sw: "Uendeshaji", d_en: "A lightweight environmental command center for institutional teams.", d_sw: "Kitovu cha amri cha mazingira kwa timu za taasisi." },
];

const PROVENANCE = [
  { icon: Radio, label: "GROUND MEASUREMENT", source: "Conduit", meta: "~15 min · JKUAT/Juja station", d_en: "Local temperature, humidity, pressure, wind, light and rain. WBGT is computed from its wet bulb and air temperature.", d_sw: "Joto, unyevu, shinikizo, upepo, mwanga na mvua. WBGT hukokotolewa kutoka balbu nyevu na joto la hewa.", color: "#006B3C" },
  { icon: Wind, label: "REGIONAL MODEL", source: "ERA5-Land", meta: "~9 km · hourly", d_en: "The wider atmospheric background behind local-versus-regional anomalies.", d_sw: "Mandhari ya anga ya kikanda kwa tofauti za kimaeneo na kikanda.", color: "#3786B5" },
  { icon: Satellite, label: "SATELLITE-DERIVED", source: "Sentinel-2", meta: "10 m vegetation", d_en: "Vegetation (NDVI) by county, always shown with real acquisition dates.", d_sw: "Uoto (NDVI) kwa kaunti, pamoja na tarehe halisi za uchukuzi.", color: "#247B78" },
  { icon: CloudRain, label: "HISTORICAL CLIMATE", source: "ERA5-Land", meta: "daily · ~9 km", d_en: "Rainfall memory: 7-day and 30-day totals against climatology.", d_sw: "Kumbukumbu ya mvua: jumla ya siku 7 na 30 dhidi ya tabia ya hali ya hewa.", color: "#68756F" },
];

const NON_GOALS = [
  { en: "A medical diagnosis system", sw: "Mfumo wa utambuzi wa matibabu" },
  { en: "A malaria, cholera or asthma predictor", sw: "Kitabiri cha malaria, kipindupindu au pumu" },
  { en: "A street-level flood predictor", sw: "Kitabiri cha mafuriko ya kiwango cha barabara" },
  { en: "One station speaking for all of Juja", sw: "Kituo kimoja kinazungumza kwa Juja nzima" },
  { en: "A generative-AI forecasting engine", sw: "Injini ya utabiri inayotumia AI ya kizalishaji" },
  { en: "Universal “safe” or “dangerous” thresholds", sw: "Viwango vya “salama” au “hatari” vya kila mahali" },
];

// Section background photography (Unsplash, resized via their own CDN
// params, no attribution required under the Unsplash license)
const SECTION_IMAGES = {
  problem: "https://images.unsplash.com/photo-1611418612389-3e442c6c8a26",
  pipeline: "https://images.unsplash.com/photo-1789414615226-5b479d9b52ea",
  features: "https://images.unsplash.com/photo-1620901433789-1d2f85a93653",
  provenance: "https://images.unsplash.com/photo-1770370419338-f9a813302baa",
  nongoals: "https://images.unsplash.com/photo-1502088513349-3ff6482aa816",
} as const;

function bgUrl(url: string) {
  return `${url}?w=1600&q=65&auto=format&fit=crop`;
}

/** A full-bleed photo band with a tinted gradient overlay, kicker/title/sub
 * sitting on top in light text. Used to give each section a distinct visual
 * identity instead of one plain white section after another; any dense
 * foreground content (cards, lists) stays below on its own clean surface. */
function SectionBanner({
  image,
  overlay,
  kicker,
  title,
  sub,
  titleId,
}: {
  image: string;
  overlay: string;
  kicker: string;
  title: string;
  sub?: string;
  titleId: string;
}) {
  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgUrl(image)})` }}
        aria-hidden="true"
      />
      <div className="absolute inset-0" style={{ background: overlay }} aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-afya-gold">{kicker}</p>
        <h2 id={titleId} className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {title}
        </h2>
        {sub && <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/80">{sub}</p>}
      </div>
    </div>
  );
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Live station chip (real data, graceful degradation)
function LiveStatus({ copy }: { copy: Record<string, string> }) {
  const { lang } = useLanguage();
  const { data } = useSWR<SituationResult>("/api/situation", fetcher, { refreshInterval: 60_000 });

  if (!data) {
    return (
      <div className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/50" role="status">
        <span className="w-2 h-2 rounded-full bg-white/30 live-pulse" aria-hidden="true" />
        {copy.live_connecting}
      </div>
    );
  }

  const stateMeta = STATES[data.state.state_id];
  const qualityColor =
    data.quality.status === "GOOD" ? "#006B3C" : data.quality.status === "DEGRADED" ? "#F2B705" : "#C62828";

  const sourceBadge =
    data.data_source === "CONDUIT_LIVE"
      ? { dot: "bg-afya-green", text: "text-afya-green", label: lang === "sw" ? "MOJA KWA MOJA · CONDUIT" : "LIVE · CONDUIT" }
      : data.data_source === "CONDUIT_ARCHIVE"
        ? { dot: "bg-[#247B78]", text: "text-[#247B78]", label: lang === "sw" ? "KUMBUKUMBU YA KITUO" : "STATION ARCHIVE" }
        : { dot: "bg-afya-gold", text: "text-afya-gold", label: "DEMO MODE" };

  return (
    <div className="inline-flex flex-wrap items-center gap-x-4 gap-y-2 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 backdrop-blur-sm" role="status" aria-label={copy.live_label}>
      <span className="inline-flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full live-pulse ${sourceBadge.dot}`} aria-hidden="true" />
        <span className={`text-[11px] font-bold tracking-wider ${sourceBadge.text}`}>{sourceBadge.label}</span>
      </span>
      <span className="text-sm font-semibold text-white">
        {lang === "sw" ? stateMeta.name_sw : stateMeta.name}
      </span>
      <span className="text-sm text-white/70 tabular-nums">
        WBGT {data.current.wbgt_c.toFixed(1)}°C
      </span>
      <span className="inline-flex items-center gap-1.5 text-xs text-white/60">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: qualityColor }} aria-hidden="true" />
        {data.quality.status} · {fmtAgo(data.quality.freshness_minutes, lang)}
      </span>
    </div>
  );
}

// Landing page
export default function Landing() {
  const { lang, setLang } = useLanguage();
  const c = L[lang];

  return (
    <div className="min-h-screen bg-afya-canvas">

      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-afya-border/60 bg-afya-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="AFYA MAZINGIRA home">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-afya-deep" aria-hidden="true">
              <Globe className="h-4 w-4 text-white" strokeWidth={1.6} />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-afya-deep">AFYA MAZINGIRA</span>
          </Link>
          <nav className="ml-auto flex items-center gap-2 sm:gap-3" aria-label="Landing navigation">
            <div className="flex items-center overflow-hidden rounded-lg border border-afya-border bg-white text-xs font-semibold" role="group" aria-label={c.lang_label}>
              {(["en", "sw"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`px-2.5 py-1.5 transition-colors ${lang === l ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal"}`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <Link
              href="/situation"
              className="inline-flex items-center gap-1.5 rounded-lg bg-afya-green px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-afya-green/90 sm:text-sm"
            >
              {c.nav_open_app}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #103D2C 0%, #0B2E20 55%, #071E15 100%)" }}
        aria-label={c.hero_badge}
      >
        {/* subtle radial glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(600px 300px at 70% 20%, rgba(0,107,60,0.25), transparent 70%)" }}
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-afya-gold/30 bg-afya-gold/10 px-3.5 py-1.5 text-[11px] font-semibold tracking-wide text-afya-gold">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {c.hero_badge}
          </p>
          <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
            {c.hero_title_a}{" "}
            <span className="text-afya-gold">{c.hero_title_b}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
            {c.hero_sub}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/situation"
              className="inline-flex items-center gap-2 rounded-xl bg-afya-gold px-6 py-3.5 text-sm font-bold text-afya-deep transition-colors hover:bg-afya-gold/90"
            >
              {c.hero_cta_primary}
              <ArrowRight className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            </Link>
            <Link
              href="/plan"
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-6 py-3.5 text-sm font-bold text-white/85 transition-colors hover:bg-white/10"
            >
              <CalendarCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {c.hero_cta_secondary}
            </Link>
          </div>

          {/* Live station status, real data */}
          <div className="mt-10">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">{c.live_label}</p>
            <LiveStatus copy={c} />
          </div>

          {/* Stats */}
          <dl className="mt-12 grid grid-cols-2 gap-6 border-t border-white/10 pt-8 sm:grid-cols-4">
            {[
              { v: "45,043", l: c.stats_observations },
              { v: "4", l: c.stats_states },
              { v: "+1/+3/+6/+9h", l: c.stats_horizons },
              { v: "EN · SW", l: c.stats_languages },
            ].map((s) => (
              <div key={s.l}>
                <dt className="sr-only">{s.l}</dt>
                <dd className="text-2xl font-bold tabular-nums text-white sm:text-3xl">{s.v}</dd>
                <dd className="mt-1 text-xs text-white/50">{s.l}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="h-1" style={{ background: "linear-gradient(90deg, #006B3C, #F2B705)" }} aria-hidden="true" />
      </section>

      {/* The interpretation gap */}
      <section aria-labelledby="problem-title">
        <SectionBanner
          image={SECTION_IMAGES.problem}
          overlay="linear-gradient(160deg, rgba(53,38,10,0.90) 0%, rgba(24,18,8,0.88) 100%)"
          kicker={c.problem_kicker}
          title={c.problem_title}
          sub={c.problem_sub}
          titleId="problem-title"
        />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24">
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Conventional dashboard */}
          <div className="rounded-2xl border border-afya-border bg-white/60 p-6 sm:p-7">
            <h3 className="text-sm font-semibold text-afya-muted">{c.problem_card_a_title}</h3>
            <div className="mt-5 space-y-3 opacity-70">
              {[
                ["Temperature", "29°C"], ["Humidity", "48%"], ["Wind", "1.5 m/s"],
                ["Pressure", "850 hPa"], ["Rain", "0 mm"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b border-afya-border/60 pb-2.5 text-sm">
                  <span className="text-afya-muted">{k}</span>
                  <span className="font-semibold tabular-nums text-afya-charcoal">{v}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm italic text-afya-muted">{c.problem_card_a_note}</p>
          </div>

          {/* AFYA MAZINGIRA */}
          <div className="relative rounded-2xl border-2 border-afya-green/40 bg-white p-6 shadow-sm sm:p-7">
            <span className="absolute -top-2.5 right-5 rounded-full bg-afya-green px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              {c.problem_card_b_tag}
            </span>
            <h3 className="text-sm font-semibold text-afya-green">{c.problem_card_b_title}</h3>
            <div className="mt-5 space-y-4">
              <div>
                <div className="text-2xl font-bold text-afya-charcoal sm:text-3xl">Rapid Warming</div>
                <p className="mt-1 text-sm text-afya-muted">
                  {lang === "sw"
                    ? "Inaendelea kuelekea hali ya joto na mionzi mikali."
                    : "Transitioning toward hot, high-radiation exposure."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-afya-canvas px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-afya-muted">
                    {lang === "sw" ? "Kilele kinachotarajiwa" : "Expected peak"}
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-afya-charcoal">12:00–14:00</div>
                </div>
                <div className="rounded-xl bg-afya-green/8 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-afya-green">
                    {lang === "sw" ? "Dirisha bora" : "Best window"}
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-afya-green">16:30–17:30</div>
                </div>
              </div>
              <ul className="space-y-1.5 text-sm text-afya-muted">
                {(lang === "sw"
                  ? ["Joto la hewa linaongezeka", "Mionzi ya jua bado ni mikali", "Uingizaji hewa ni mdogo"]
                  : ["Air temperature rising", "Solar radiation remains high", "Ventilation relatively weak"]
                ).map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-afya-gold" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-5 text-sm italic text-afya-muted">{c.problem_card_b_note}</p>
          </div>
        </div>
        </div>
      </section>

      {/* Pipeline */}
      <section className="border-y border-afya-border/60" aria-labelledby="pipeline-title">
        <SectionBanner
          image={SECTION_IMAGES.pipeline}
          overlay="linear-gradient(160deg, rgba(16,61,44,0.90) 0%, rgba(11,46,32,0.88) 100%)"
          kicker={c.pipeline_kicker}
          title={c.pipeline_title}
          titleId="pipeline-title"
        />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24">
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={c.pipeline_kicker}>
            {PIPELINE.map((step, i) => (
              <li
                key={step.en}
                className="relative rounded-xl border border-afya-border bg-afya-canvas px-4 py-4"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: i === 7 ? "#F2B705" : "#006B3C" }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <p className="mt-3 text-sm font-semibold leading-snug text-afya-charcoal">
                  {lang === "sw" ? step.sw : step.en}
                </p>
                {i < PIPELINE.length - 1 && (
                  <ArrowRight
                    className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-afya-muted/50 sm:block"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                )}
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-afya-muted">
            <span className="font-semibold text-afya-charcoal"></span> {c.pipeline_note}
          </p>
        </div>
      </section>

      {/* Climate Reflex states */}
      <section
        className="relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #103D2C 0%, #0B2E20 100%)" }}
        aria-labelledby="states-title"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-afya-gold">{c.states_kicker}</p>
          <h2 id="states-title" className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {c.states_title}
          </h2>
          <p className="mt-4 max-w-2xl text-base text-white/60">{c.states_sub}</p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([0, 1, 2, 3] as const).map((id) => {
              const meta = STATES[id];
              const desc = STATE_DESCRIPTIONS[id];
              return (
                <div key={id} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden="true" />
                    <span className="text-xs font-semibold" style={{ color: meta.color }}>
                      {lang === "sw" ? desc.time_sw : desc.time_en}
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-bold leading-snug text-white">
                    {lang === "sw" ? meta.name_sw : meta.name}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">
                    {lang === "sw" ? desc.sw : desc.en}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-title">
        <SectionBanner
          image={SECTION_IMAGES.features}
          overlay="linear-gradient(160deg, rgba(20,45,20,0.90) 0%, rgba(12,28,14,0.88) 100%)"
          kicker={c.features_kicker}
          title={c.features_title}
          titleId="features-title"
        />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.en}
              href={f.href}
              className="group rounded-2xl border border-afya-border bg-white p-6 transition-all hover:border-afya-green/50 hover:shadow-md"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-afya-green/10 text-afya-green" aria-hidden="true">
                <f.icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <h3 className="mt-4 text-base font-bold text-afya-charcoal">{lang === "sw" ? f.sw : f.en}</h3>
              <p className="mt-2 text-sm leading-relaxed text-afya-muted">{lang === "sw" ? f.d_sw : f.d_en}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-afya-green">
                {lang === "sw" ? "Fungua" : "Open"}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2.2} aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
        </div>
      </section>

      {/* Provenance */}
      <section className="border-y border-afya-border/60" aria-labelledby="provenance-title">
        <SectionBanner
          image={SECTION_IMAGES.provenance}
          overlay="linear-gradient(160deg, rgba(8,20,40,0.90) 0%, rgba(5,12,26,0.88) 100%)"
          kicker={c.provenance_kicker}
          title={c.provenance_title}
          sub={c.provenance_sub}
          titleId="provenance-title"
        />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24">
          <div className="grid gap-4 sm:grid-cols-2">
            {PROVENANCE.map((p) => (
              <div key={p.source} className="flex gap-4 rounded-2xl border border-afya-border bg-afya-canvas p-5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${p.color}18`, color: p.color }}
                  aria-hidden="true"
                >
                  <p.icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: p.color }}>
                    {p.label}
                  </p>
                  <h3 className="mt-1 text-base font-bold text-afya-charcoal">{p.source}</h3>
                  <p className="mt-0.5 text-xs font-medium text-afya-muted">{p.meta}</p>
                  <p className="mt-2 text-sm leading-relaxed text-afya-muted">
                    {lang === "sw" ? p.d_sw : p.d_en}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Non-goals */}
      <section aria-labelledby="nongoals-title">
        <SectionBanner
          image={SECTION_IMAGES.nongoals}
          overlay="linear-gradient(160deg, rgba(35,45,20,0.90) 0%, rgba(20,26,12,0.88) 100%)"
          kicker={c.nongoals_kicker}
          title={c.nongoals_title}
          sub={c.nongoals_sub}
          titleId="nongoals-title"
        />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24">
        <ul className="grid gap-3 sm:grid-cols-2">
          {NON_GOALS.map((g) => (
            <li key={g.en} className="flex items-start gap-3 rounded-xl border border-afya-gold/25 bg-afya-gold/5 px-4 py-3.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-afya-gold/20 text-afya-gold" aria-hidden="true">
                <X className="h-3 w-3" strokeWidth={2.5} />
              </span>
              <span className="text-sm font-medium text-afya-charcoal">{lang === "sw" ? g.sw : g.en}</span>
            </li>
          ))}
        </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section
        className="relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #103D2C 0%, #0B2E20 100%)" }}
        aria-labelledby="cta-title"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(500px 260px at 50% 100%, rgba(0,107,60,0.3), transparent 70%)" }}
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <h2 id="cta-title" className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {c.cta_title}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-white/65">{c.cta_sub}</p>
          <Link
            href="/situation"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-afya-gold px-8 py-4 text-base font-bold text-afya-deep transition-colors hover:bg-afya-gold/90"
          >
            {c.cta_button}
            <ArrowRight className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#071E15]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-afya-green" aria-hidden="true">
              <Globe className="h-4 w-4 text-white" strokeWidth={1.6} />
            </span>
            <span className="text-[15px] font-bold text-white">AFYA MAZINGIRA</span>
            <span className="text-sm text-white/40">·</span>
            <span className="text-sm italic text-afya-gold/90">{c.footer_motto}</span>
          </div>
          <p className="mt-5 max-w-2xl text-xs leading-relaxed text-white/40">{c.footer_disclaimer}</p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6">
            <p className="text-xs text-white/35">{c.footer_poc}</p>
            <div className="flex items-center gap-4 text-xs">
              <Link href="/about" className="text-white/50 transition-colors hover:text-white">
                {lang === "sw" ? "Kuhusu" : "About"}
              </Link>
              <Link href="/intelligence" className="text-white/50 transition-colors hover:text-white">
                {lang === "sw" ? "Kwa Nini?" : "Why?"}
              </Link>
              <Link href="/sign-in" className="text-white/50 transition-colors hover:text-white">
                {lang === "sw" ? "Ingia" : "Sign in"}
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
