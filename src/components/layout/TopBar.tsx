"use client";

import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/contexts/language";
import { useSituation } from "@/lib/contexts/situation";
import { QualityDot } from "@/components/ui/QualityDot";
import { MapPin, Search } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  "/situation": "nav_situation",
  "/forecast": "nav_forecast",
  "/plan": "nav_plan",
  "/farm": "nav_farm",
  "/stories": "nav_stories",
  "/flood": "nav_flood",
  "/health": "nav_health",
  "/map": "nav_map",
  "/climate": "nav_climate",
  "/intelligence": "nav_intelligence",
  "/operations": "nav_operations",
  "/notifications": "nav_notifications",
  "/profile": "nav_profile",
  "/about": "about_title",
};

export default function TopBar() {
  const pathname = usePathname();
  const { lang, setLang, t } = useLanguage();
  const { situation } = useSituation();

  const titleKey = Object.entries(PAGE_TITLES).find(([path]) =>
    pathname === path || pathname.startsWith(path + "/"),
  )?.[1];

  return (
    <header className="shrink-0 bg-afya-canvas border-b border-afya-border px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
      {/* Page title (desktop) / brand (mobile) */}
      <div className="flex-1 min-w-0">
        <span className="hidden lg:block text-[15px] font-semibold text-afya-charcoal">
          {titleKey ? t(titleKey) : "AFYA MAZINGIRA"}
        </span>
        <span className="lg:hidden text-[17px] font-bold text-afya-deep">{t("brand")}</span>
      </div>

      {/* Location chip */}
      <div className="hidden sm:flex items-center gap-1.5 text-afya-muted text-sm">
        <MapPin className="w-3.5 h-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <span>{t("location")}</span>
      </div>

      {/* Data quality indicator */}
      {situation && (
        <QualityDot status={situation.quality.status} freshnessMinutes={situation.quality.freshness_minutes} />
      )}

      {/* Data source badge: live / recorded archive / demo */}
      {situation?.data_source === "DEMO" && (
        <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-afya-gold/50 bg-afya-gold/10 px-2.5 py-1 text-[11px] font-semibold text-[#8a6d00]">
          <span className="w-1.5 h-1.5 rounded-full bg-afya-gold inline-block" aria-hidden="true" />
          {t("demo_mode")}
        </span>
      )}
      {situation?.data_source === "CONDUIT_ARCHIVE" && (
        <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-[#247B78]/40 bg-[#247B78]/10 px-2.5 py-1 text-[11px] font-semibold text-[#247B78]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#247B78] inline-block" aria-hidden="true" />
          {t("conduit_archive_badge")}
        </span>
      )}
      {situation?.data_source === "CONDUIT_LIVE" && (
        <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-afya-green/40 bg-afya-green/10 px-2.5 py-1 text-[11px] font-semibold text-afya-green">
          <span className="w-1.5 h-1.5 rounded-full bg-afya-green inline-block live-pulse" aria-hidden="true" />
          {t("conduit_live_badge")}
        </span>
      )}

      {/* Command palette trigger */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("afya:open-command-palette"))}
        className="flex items-center gap-2 rounded-lg border border-afya-border bg-white px-2.5 py-1.5 text-xs text-afya-muted hover:bg-afya-canvas transition-colors"
        aria-label={t("cmd_search")}
      >
        <Search className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
        <span className="hidden md:inline">{t("cmd_search")}</span>
        <kbd className="hidden md:inline rounded border border-afya-border bg-afya-canvas px-1 text-[10px] font-mono">
          ⌘K
        </kbd>
      </button>

      {/* Language switcher */}
      <div className="flex items-center rounded-lg border border-afya-border bg-white overflow-hidden text-xs font-semibold">
        <button
          onClick={() => setLang("en")}
          aria-pressed={lang === "en"}
          className={`px-2.5 py-1.5 transition-colors ${lang === "en" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal"}`}
        >
          EN
        </button>
        <button
          onClick={() => setLang("sw")}
          aria-pressed={lang === "sw"}
          className={`px-2.5 py-1.5 transition-colors ${lang === "sw" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal"}`}
        >
          SW
        </button>
      </div>
    </header>
  );
}
