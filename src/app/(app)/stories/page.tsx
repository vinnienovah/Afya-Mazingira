"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/language";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  Sprout, Trophy, HardHat, Building2, ArrowRight,
  Database, Cpu, Target, TrendingUp, Quote,
} from "lucide-react";

interface Story {
  key: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  colour: string;
  who_en: string; who_sw: string;
  role_en: string; role_sw: string;
  problem_en: string; problem_sw: string;
  /** DATA → INSIGHT → DECISION → IMPACT */
  data_en: string; data_sw: string;
  insight_en: string; insight_sw: string;
  decision_en: string; decision_sw: string;
  impact_en: string; impact_sw: string;
  quote_en: string; quote_sw: string;
  cta_href: string;
  cta_en: string; cta_sw: string;
}

const STORIES: Story[] = [
  {
    key: "farmer",
    icon: Sprout,
    colour: "#006B3C",
    who_en: "Wanjiku", who_sw: "Wanjiku",
    role_en: "Smallholder farmer · Juja", role_sw: "Mkulima mdogo · Juja",
    problem_en: "She irrigates her kale on a fixed schedule. In a dry week her crop still stresses; in a wet week she wastes water and fuel pumping from the river.",
    problem_sw: "Anamwagilia sukuma wiki kwa ratiba isiyobadilika. Wiki ya ukame mimea bado inateseka; wiki ya mvua anapoteza maji na mafuta ya pampu.",
    data_en: "Conduit rainfall and temperature at 15-minute intervals, ERA5-Land soil moisture, CHIRPS 7-day and 30-day rainfall totals.",
    data_sw: "Mvua na joto la Conduit kila dakika 15, unyevu wa udongo wa ERA5-Land, jumla ya mvua ya CHIRPS ya siku 7 na 30.",
    insight_en: "AFYA MAZINGIRA computes reference evapotranspiration (Hargreaves) and crop water demand (FAO-56 Kc), then balances it against measured recent rainfall and soil moisture.",
    insight_sw: "AFYA MAZINGIRA huhesabu uvukizi wa marejeleo (Hargreaves) na mahitaji ya maji ya zao (FAO-56 Kc), kisha kulinganisha na mvua iliyopimwa na unyevu wa udongo.",
    decision_en: "\"Hold — rain expected\" instead of irrigating, or an exact application depth in mm when the root zone is genuinely depleted.",
    decision_sw: "\"Subiri — mvua inatarajiwa\" badala ya kumwagilia, au kina hasa cha mm wakati eneo la mizizi limekauka kweli.",
    impact_en: "Water and pumping fuel are only spent when the crop actually needs them, and irrigation happens before stress rather than after visible wilting.",
    impact_sw: "Maji na mafuta ya pampu hutumika tu wakati zao linahitaji, na umwagiliaji hufanyika kabla ya msongo badala ya baada ya kunyauka.",
    quote_en: "I stopped watering the day before it rained.",
    quote_sw: "Niliacha kumwagilia siku moja kabla ya mvua kunyesha.",
    cta_href: "/farm",
    cta_en: "Open Farm Advisory", cta_sw: "Fungua Ushauri wa Shamba",
  },
  {
    key: "coach",
    icon: Trophy,
    colour: "#F2B705",
    who_en: "Coach Otieno", who_sw: "Kocha Otieno",
    role_en: "Sports coach · JKUAT", role_sw: "Kocha wa michezo · JKUAT",
    problem_en: "Training is scheduled at 14:00 because that is when the pitch is free — often the hottest, highest-radiation part of the day.",
    problem_sw: "Mazoezi yamepangwa saa 14:00 kwa sababu ndipo uwanja upo wazi — mara nyingi wakati wa joto na mionzi mikali zaidi.",
    data_en: "Conduit temperature, humidity, wind and a WBGT-like thermal exposure signal, updated every 15 minutes.",
    data_sw: "Joto, unyevu, upepo na ishara ya WBGT ya Conduit, inayosasishwa kila dakika 15.",
    insight_en: "Horizon-specialised models forecast exposure at +1h, +3h, +6h and +9h with calibrated uncertainty, and the Climate Reflex engine identifies the coming state transition.",
    insight_sw: "Mifumo maalum hutabiri kupatwa kwa +saa 1, +3, +6 na +9 pamoja na utata uliorekebishwa, na Climate Reflex hutambua mabadiliko ya hali yanayokuja.",
    decision_en: "The deterministic Best-Time engine ranks every 15-minute window and returns a specific lower-exposure slot, plus an alternative.",
    decision_sw: "Injini ya Wakati-Bora hupanga kila dirisha la dakika 15 na kurudisha muda mahususi wenye kupatwa kidogo, pamoja na mbadala.",
    impact_en: "High-intensity sessions move out of the exposure peak without cancelling training, and the decision is defensible to the athletics department.",
    impact_sw: "Vipindi vizito huhama kutoka kilele cha kupatwa bila kufuta mazoezi, na uamuzi unaweza kutetewa mbele ya idara ya riadha.",
    quote_en: "We moved the session, not cancelled it.",
    quote_sw: "Tulihamisha kipindi, hatukukifuta.",
    cta_href: "/plan",
    cta_en: "Plan an activity", cta_sw: "Panga shughuli",
  },
  {
    key: "construction",
    icon: HardHat,
    colour: "#E27832",
    who_en: "Site supervisor", who_sw: "Msimamizi wa tovuti",
    role_en: "Construction · Thika Road", role_sw: "Ujenzi · Barabara ya Thika",
    problem_en: "Concrete pours and heavy manual work are planned the night before, with no view of how tomorrow's conditions will actually develop.",
    problem_sw: "Kumwaga zege na kazi nzito hupangwa usiku uliopita, bila kujua hali ya kesho itakuaje.",
    data_en: "Conduit ground observations plus ERA5-Land regional context, with an explicit local-versus-regional anomaly.",
    data_sw: "Uchunguzi wa ardhini wa Conduit pamoja na muktadha wa kikanda wa ERA5-Land, na tofauti ya kimaeneo dhidi ya kikanda.",
    insight_en: "Risk is interpreted per activity intensity — the same WBGT value produces a higher tier for heavy construction than for light walking.",
    insight_sw: "Hatari hufasiriwa kulingana na uzito wa shughuli — thamani ile ile ya WBGT hutoa kiwango cha juu kwa ujenzi mzito kuliko kutembea.",
    decision_en: "Operations dashboard flags which scheduled activities fall inside the exposure peak and proposes concrete alternative windows.",
    decision_sw: "Dashibodi ya uendeshaji huonyesha shughuli zipi zimepangwa ndani ya kilele na kupendekeza madirisha mbadala.",
    impact_en: "Crew scheduling shifts before conditions peak, supported by a printable briefing for the site file and the safety officer.",
    impact_sw: "Ratiba ya wafanyakazi hubadilika kabla ya kilele, ikiungwa mkono na taarifa inayochapishwa kwa faili ya tovuti.",
    quote_en: "The briefing goes in the site file every morning.",
    quote_sw: "Taarifa huingia kwenye faili ya tovuti kila asubuhi.",
    cta_href: "/operations",
    cta_en: "Open Operations", cta_sw: "Fungua Uendeshaji",
  },
  {
    key: "campus",
    icon: Building2,
    colour: "#3786B5",
    who_en: "Operations lead", who_sw: "Kiongozi wa uendeshaji",
    role_en: "Campus operations · JKUAT", role_sw: "Uendeshaji wa chuo · JKUAT",
    problem_en: "Outdoor events, grounds work and field trips are coordinated across departments with no shared environmental picture.",
    problem_sw: "Matukio ya nje, kazi za uwanja na safari za shambani huratibiwa bila picha moja ya mazingira.",
    data_en: "The full validated pipeline — observations, quality state, Climate Reflex history, forecasts, and regional county outlook.",
    data_sw: "Mnyororo kamili uliothibitishwa — uchunguzi, ubora, historia ya Climate Reflex, utabiri, na muonekano wa kaunti.",
    insight_en: "Data quality is a first-class signal: when the station degrades, uncertainty widens and strong recommendations are automatically suppressed.",
    insight_sw: "Ubora wa data ni ishara muhimu: kituo kikidhoofika, utata huongezeka na mapendekezo madhubuti husitishwa kiotomatiki.",
    decision_en: "One operational view shows active alerts, affected activity periods and the best operational windows for the day.",
    decision_sw: "Mwonekano mmoja huonyesha tahadhari, vipindi vilivyoathiriwa na madirisha bora ya uendeshaji ya siku.",
    impact_en: "Departments coordinate from one environmental source of truth, and Historical Replay lets the team audit whether past advice was sound.",
    impact_sw: "Idara huratibu kutoka chanzo kimoja, na Marudio ya Kihistoria huruhusu timu kukagua kama ushauri wa zamani ulikuwa sahihi.",
    quote_en: "Everyone plans from the same picture now.",
    quote_sw: "Sasa kila mtu anapanga kutoka picha moja.",
    cta_href: "/replay",
    cta_en: "Try Historical Replay", cta_sw: "Jaribu Marudio",
  },
];

const CHAIN = [
  { key: "data", icon: Database, en: "Data", sw: "Data" },
  { key: "insight", icon: Cpu, en: "Insight", sw: "Ufahamu" },
  { key: "decision", icon: Target, en: "Decision", sw: "Uamuzi" },
  { key: "impact", icon: TrendingUp, en: "Impact", sw: "Athari" },
];

export default function StoriesPage() {
  const { t, lang } = useLanguage();
  const [active, setActive] = useState(0);
  const story = STORIES[active];
  const Icon = story.icon;

  useEffect(() => {
    document.title = `${t("stories_title")} | AFYA MAZINGIRA`;
  }, [t]);

  const chainContent: Record<string, string> = {
    data: lang === "sw" ? story.data_sw : story.data_en,
    insight: lang === "sw" ? story.insight_sw : story.insight_en,
    decision: lang === "sw" ? story.decision_sw : story.decision_en,
    impact: lang === "sw" ? story.impact_sw : story.impact_en,
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("stories_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("stories_sub")}</p>
      </div>

      {/* Persona selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STORIES.map((s, i) => {
          const SIcon = s.icon;
          const isActive = i === active;
          return (
            <button
              key={s.key}
              onClick={() => setActive(i)}
              aria-pressed={isActive}
              className={cn(
                "rounded-xl border p-3 text-left transition-all",
                isActive ? "border-transparent shadow-sm" : "border-afya-border hover:border-afya-green/40",
              )}
              style={isActive ? { background: `${s.colour}12`, borderColor: `${s.colour}55` } : undefined}
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg mb-2"
                style={{ background: `${s.colour}18`, color: s.colour }}
                aria-hidden="true"
              >
                <SIcon className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div className="text-sm font-bold text-afya-charcoal leading-tight">
                {lang === "sw" ? s.who_sw : s.who_en}
              </div>
              <div className="text-[11px] text-afya-muted mt-0.5 leading-snug">
                {lang === "sw" ? s.role_sw : s.role_en}
              </div>
            </button>
          );
        })}
      </div>

      {/* Story hero */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, #103D2C 0%, #0B2E20 100%)" }}
      >
        <div className="p-6 sm:p-8 text-white">
          <div className="flex items-center gap-3 mb-4">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: `${story.colour}25`, color: story.colour }}
              aria-hidden="true"
            >
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div>
              <div className="text-lg font-bold">{lang === "sw" ? story.who_sw : story.who_en}</div>
              <div className="text-xs text-white/60">{lang === "sw" ? story.role_sw : story.role_en}</div>
            </div>
          </div>

          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45 mb-2">
            {t("stories_problem")}
          </p>
          <p className="text-base sm:text-lg leading-relaxed text-white/85 max-w-2xl">
            {lang === "sw" ? story.problem_sw : story.problem_en}
          </p>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-white/15 bg-white/5 px-4 py-3 max-w-xl">
            <Quote className="h-4 w-4 shrink-0 mt-0.5" style={{ color: story.colour }} aria-hidden="true" />
            <p className="text-sm italic text-white/80">
              {lang === "sw" ? story.quote_sw : story.quote_en}
            </p>
          </div>
        </div>
        <div className="h-1" style={{ background: story.colour }} aria-hidden="true" />
      </div>

      {/* DATA → INSIGHT → DECISION → IMPACT */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CHAIN.map((step, i) => {
          const SIcon = step.icon;
          return (
            <Card key={step.key} className="relative">
              <div className="flex items-center gap-2.5 mb-2.5">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: `${story.colour}15`, color: story.colour }}
                  aria-hidden="true"
                >
                  <SIcon className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-afya-muted">
                  {lang === "sw" ? step.sw : step.en}
                </span>
                {i < CHAIN.length - 1 && (
                  <ArrowRight className="ml-auto h-4 w-4 text-afya-muted/40" strokeWidth={2} aria-hidden="true" />
                )}
              </div>
              <p className="text-sm leading-relaxed text-afya-charcoal">{chainContent[step.key]}</p>
            </Card>
          );
        })}
      </div>

      {/* CTA */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-afya-charcoal">{t("stories_try_it")}</p>
            <p className="text-sm text-afya-muted mt-0.5">
              {lang === "sw"
                ? "Fungua kipengele halisi kinachotumika katika hadithi hii."
                : "Open the actual feature used in this story."}
            </p>
          </div>
          <Link
            href={story.cta_href}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: story.colour }}
          >
            {lang === "sw" ? story.cta_sw : story.cta_en}
            <ArrowRight className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </div>
      </Card>

      {/* Scale note */}
      <Card>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-afya-muted mb-2">{t("stories_scale")}</p>
        <p className="text-sm leading-relaxed text-afya-muted">{t("stories_scale_body")}</p>
      </Card>
    </div>
  );
}
