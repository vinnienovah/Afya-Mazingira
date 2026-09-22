"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/contexts/language";
import { Card, CardTitle } from "@/components/ui/Card";
import { Globe, CloudRain, CloudSun, Satellite, Radio, Database, Shield, AlertTriangle, BookOpen, ChevronRight } from "lucide-react";

export default function AboutPage() {
  const { t, lang } = useLanguage();

  const PROVENANCE = [
    {
      icon: <Radio className="w-5 h-5 text-afya-green" />,
      name: "Conduit",
      detail_en: "Local environmental measurements · JHUB Africa / JKUAT",
      detail_sw: "Vipimo vya mazingira ya kimaeneo · JHUB Africa / JKUAT",
      type: {
        en: "GROUND MEASUREMENT · ~15 min",
        sw: "KIPIMO CHA ARDHI · ~dk 15",
      } as Record<string, string>,
    },
    {
      icon: <Globe className="w-5 h-5 text-afya-rain" />,
      name: "ERA5",
      detail_en: "Regional atmospheric reanalysis · ECMWF / Copernicus, through the Open-Meteo archive",
      detail_sw: "Uchambuzi upya wa anga ya kikanda · ECMWF / Copernicus, kupitia kumbukumbu ya Open-Meteo",
      type: { en: "REGIONAL MODEL · ~28 km · hourly · about 5 days behind", sw: "MFUMO WA KIKANDA · ~km 28 · kila saa · huchelewa takriban siku 5" },
    },
    {
      icon: <CloudRain className="w-5 h-5 text-afya-rain" />,
      name: "ERA5 rainfall",
      detail_en: "7-day and 30-day rainfall totals from ERA5, used in place of CHIRPS",
      detail_sw: "Jumla ya mvua ya siku 7 na 30 kutoka ERA5, badala ya CHIRPS",
      type: { en: "REGIONAL MODEL · ~28 km · daily", sw: "MFUMO WA KIKANDA · ~km 28 · kila siku" },
    },
    {
      icon: <CloudSun className="w-5 h-5 text-afya-rain" />,
      name: "Open-Meteo forecast",
      detail_en: "County outlook on the Risk Map, and plans for tomorrow",
      detail_sw: "Utabiri wa kaunti kwenye Ramani ya Hatari, na mipango ya kesho",
      type: { en: "REGIONAL FORECAST · hourly", sw: "UTABIRI WA KIKANDA · kila saa" },
    },
    {
      icon: <Satellite className="w-5 h-5 text-afya-teal" />,
      name: "Sentinel-2",
      detail_en: "Vegetation / NDVI · ESA Copernicus",
      detail_sw: "Mimea / NDVI · ESA Copernicus",
      type: { en: "SATELLITE-DERIVED · 10 m · ~5-day revisit", sw: "KUTOKA SAYETI · 10 m · ~siku 5" },
    },
    {
      icon: <Satellite className="w-5 h-5 text-afya-teal" />,
      name: "Sentinel-3 SLSTR",
      detail_en: "Acquisition dates only; land surface temperature is not computed · ESA Copernicus",
      detail_sw: "Tarehe za uchukuzi pekee; joto la uso wa ardhi halikokotolewi · ESA Copernicus",
      type: { en: "SATELLITE-DERIVED · dates", sw: "KUTOKA SAYETI · tarehe" },
    },
  ];

  const LIMITS = [
    { icon: <AlertTriangle className="w-4 h-4" />, en: "Does not provide medical diagnosis or clinical advice", sw: "Haitoi utambuzi wa matibabu au ushauri wa kliniki" },
    { icon: <AlertTriangle className="w-4 h-4" />, en: "Not a street-level flood predictor", sw: "Siyo utabiri wa mafuriko ya kiwango cha barabara" },
    { icon: <AlertTriangle className="w-4 h-4" />, en: "Does not predict malaria, cholera, or asthma attacks", sw: "Haitabiri malaria, kipindupindu, au mapigo ya pumu" },
    { icon: <AlertTriangle className="w-4 h-4" />, en: "One station does not represent all of Juja", sw: "Kituo kimoja hakimwakilishi Juja nzima" },
    { icon: <AlertTriangle className="w-4 h-4" />, en: "Does not use generative AI as a forecasting engine", sw: "Haitumii AI ya kizalishaji kama injini ya utabiri" },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Hero */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, #103D2C 0%, #0a2a1e 100%)" }}
      >
        <div className="px-8 py-10 text-white">
          <div className="text-xs font-bold text-afya-gold uppercase tracking-widest mb-3">
            {t("about_motto")}
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{t("brand")}</h1>
          <p className="text-white/70 text-lg">{t("about_sub")}</p>
          <p className="text-white/50 text-sm mt-4 max-w-xl leading-relaxed">{t("about_body")}</p>
          <div className="mt-5 rounded-xl bg-afya-gold/10 border border-afya-gold/30 px-4 py-3 text-xs text-afya-gold/90">
            {t("about_disclaimer")}
          </div>
        </div>
        <div className="h-1" style={{ background: "linear-gradient(90deg, #006B3C, #F2B705)" }} aria-hidden="true" />
      </div>

      {/* How it works */}
      <Card>
        <CardTitle>{lang === "sw" ? "Jinsi Inavyofanya Kazi" : "How It Works"}</CardTitle>
        <div className="space-y-2">
          {[
            { step: "1", en: "Conduit local measurements", sw: "Vipimo vya kimaeneo vya Conduit" },
            { step: "2", en: "Quality control (station health rules)", sw: "Udhibiti wa ubora (kanuni za afya ya kituo)" },
            { step: "3", en: "Feature engineering", sw: "Uhandisi wa vipengele" },
            { step: "4", en: "Climate Reflex state classification", sw: "Uainishaji wa hali ya Climate Reflex" },
            { step: "5", en: "+1/+3/+6/+9h WBGT forecasting", sw: "Utabiri wa WBGT wa +1/+3/+6/+9saa" },
            { step: "6", en: "Risk / exposure interpretation", sw: "Ufafanuzi wa hatari / kupatwa" },
            { step: "7", en: "Best-Time activity recommendation", sw: "Pendekezo la shughuli la Wakati-Bora" },
            { step: "8", en: "Explainable output (EN + SW)", sw: "Hitimisho linaloweza kuelezeka (EN + SW)" },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-3">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ backgroundColor: "#006B3C" }}
                aria-hidden="true"
              >
                {item.step}
              </span>
              <span className="text-sm text-afya-muted">{lang === "sw" ? item.sw : item.en}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Data provenance */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-4 h-4 text-afya-muted" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">{t("data_provenance")}</CardTitle>
        </div>
        <div className="space-y-3">
          {PROVENANCE.map((p) => (
            <div key={p.name} className="flex items-start gap-3 rounded-xl border border-afya-border bg-afya-canvas/50 px-4 py-3">
              <span className="mt-0.5 shrink-0" aria-hidden="true">{p.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-afya-charcoal">{p.name}</div>
                <div className="text-xs text-afya-muted mt-0.5">{lang === "sw" ? p.detail_sw : p.detail_en}</div>
                <div className="text-[10px] font-semibold text-afya-muted/60 uppercase tracking-wide mt-1">
                  {lang === "sw" ? p.type.sw : p.type.en}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Scientific limitations */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-afya-gold" strokeWidth={1.8} aria-hidden="true" />
          <CardTitle className="mb-0">
            {lang === "sw" ? "Mapungufu ya Kisayansi" : "Scientific Limitations"}
          </CardTitle>
        </div>
        <div className="space-y-2">
          {LIMITS.map((l, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm text-afya-muted">
              <span className="text-afya-gold shrink-0 mt-0.5" aria-hidden="true">{l.icon}</span>
              <span>{lang === "sw" ? l.sw : l.en}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Example scenarios: illustrative, so labelled as such */}
      <Link
        href="/stories"
        className="flex items-center gap-3 rounded-2xl border border-afya-border bg-white px-5 py-4 hover:border-afya-green/50 transition-colors group"
      >
        <BookOpen className="w-5 h-5 text-afya-muted shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-afya-charcoal">{t("nav_stories")}</span>
            <span className="rounded-full border border-afya-gold/40 bg-afya-gold/10 px-2 py-0.5 text-[9px] font-bold tracking-wide text-[#8a6d00]">
              {t("illustrative")}
            </span>
          </div>
          <p className="text-xs text-afya-muted mt-0.5">{t("about_examples_note")}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-afya-muted group-hover:text-afya-green transition-colors shrink-0" strokeWidth={2} aria-hidden="true" />
      </Link>

      {/* Build note */}
      <div className="text-center text-xs text-afya-muted/50 space-y-1 pb-4">
        <p>{lang === "sw"
          ? "AFYA MAZINGIRA · Toleo la hackathon · Uthibitisho wa dhana JKUAT/Juja · Septemba 2026"
          : "AFYA MAZINGIRA · Hackathon build · JKUAT/Juja proof of concept · September 2026"}</p>
        <p>{lang === "sw"
          ? "Inaundwa na JHUB Africa na JKUAT Conduit"
          : "Built with JHUB Africa and the JKUAT Conduit station"}</p>
      </div>
    </div>
  );
}
