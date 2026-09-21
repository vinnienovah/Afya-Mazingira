"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, CalendarCheck, MapIcon, MoreHorizontal, Activity } from "lucide-react";
import { useLanguage } from "@/lib/contexts/language";
import { useState } from "react";
import { BrainCircuit, Building2, Bell, User, Info, X, Sprout, LineChart, Waves } from "lucide-react";
import { cn } from "@/lib/utils";

const PRIMARY = [
  { href: "/situation", icon: LayoutDashboard, key: "nav_situation" },
  { href: "/forecast",  icon: TrendingUp,      key: "nav_forecast" },
  { href: "/plan",      icon: CalendarCheck,   key: "nav_plan" },
  { href: "/map",       icon: MapIcon,         key: "nav_map" },
];

const OVERFLOW = [
  { href: "/farm",          icon: Sprout,       key: "nav_farm" },
  { href: "/climate",       icon: LineChart,    key: "nav_climate" },
  { href: "/intelligence",  icon: BrainCircuit, key: "nav_intelligence" },
  { href: "/health",        icon: Activity,     key: "nav_health" },
  { href: "/operations",    icon: Building2,    key: "nav_operations" },
  { href: "/flood",         icon: Waves,        key: "nav_flood" },
  { href: "/notifications", icon: Bell,         key: "nav_notifications" },
  { href: "/profile",       icon: User,         key: "nav_profile" },
  { href: "/about",         icon: Info,         key: "about_title" },
];

export default function MobileNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [overflowOpen, setOverflowOpen] = useState(false);

  const isOverflowActive = OVERFLOW.some((item) => pathname.startsWith(item.href));

  return (
    <>
      {/* Overflow sheet */}
      {overflowOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setOverflowOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-afya-border transition-transform duration-300 ease-out lg:hidden safe-bottom",
          overflowOpen ? "translate-y-0" : "translate-y-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav_more")}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="text-sm font-semibold text-afya-charcoal">{t("nav_more")}</span>
          <button
            onClick={() => setOverflowOpen(false)}
            aria-label={t("close")}
            className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-canvas"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
        <nav className="px-4 pb-6 grid grid-cols-2 gap-1" aria-label="More navigation">
          {OVERFLOW.map(({ href, icon: Icon, key }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOverflowOpen(false)}
              aria-current={pathname.startsWith(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors",
                pathname.startsWith(href)
                  ? "bg-afya-deep/10 text-afya-deep"
                  : "text-afya-muted hover:bg-afya-canvas hover:text-afya-charcoal",
              )}
            >
              <Icon className="w-4 h-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span>{t(key)}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* Bottom nav bar */}
      <nav
        className="sticky bottom-0 left-0 right-0 z-40 bg-white border-t border-afya-border safe-bottom lg:hidden"
        aria-label="Primary navigation"
      >
        <div className="flex" role="list">
          {PRIMARY.map(({ href, icon: Icon, key }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                role="listitem"
                aria-current={active ? "page" : undefined}
                aria-label={t(key)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                  active ? "text-afya-green" : "text-afya-muted hover:text-afya-charcoal",
                )}
              >
                <Icon
                  className={cn("w-5 h-5", active && "stroke-[2.2]")}
                  strokeWidth={active ? 2.2 : 1.5}
                  aria-hidden="true"
                />
                <span>{t(key)}</span>
                {active && (
                  <span className="w-4 h-0.5 rounded-full bg-afya-green" aria-hidden="true" />
                )}
              </Link>
            );
          })}
          <button
            onClick={() => setOverflowOpen((o) => !o)}
            aria-expanded={overflowOpen}
            aria-label={t("nav_more")}
            className={cn(
              "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
              isOverflowActive || overflowOpen ? "text-afya-green" : "text-afya-muted hover:text-afya-charcoal",
            )}
          >
            <MoreHorizontal className="w-5 h-5" strokeWidth={isOverflowActive || overflowOpen ? 2.2 : 1.5} aria-hidden="true" />
            <span>{t("nav_more")}</span>
            {isOverflowActive && !overflowOpen && (
              <span className="w-4 h-0.5 rounded-full bg-afya-green" aria-hidden="true" />
            )}
          </button>
        </div>
      </nav>
    </>
  );
}
