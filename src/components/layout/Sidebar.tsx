"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, TrendingUp, CalendarCheck, MapIcon, BrainCircuit,
  Building2, History, Bell, User, Info, Globe, Sprout, BookOpen, LineChart,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/language";
import { useAuth } from "@/lib/contexts/auth";
import { useSituation } from "@/lib/contexts/situation";
import { STATES } from "@/lib/afya/constants";
import { cn } from "@/lib/utils";

const NAV_MAIN = [
  { href: "/situation",    icon: LayoutDashboard, key: "nav_situation" },
  { href: "/forecast",     icon: TrendingUp,      key: "nav_forecast" },
  { href: "/plan",         icon: CalendarCheck,   key: "nav_plan" },
  { href: "/farm",         icon: Sprout,          key: "nav_farm" },
  { href: "/map",          icon: MapIcon,         key: "nav_map" },
  { href: "/climate",      icon: LineChart,       key: "nav_climate" },
  { href: "/intelligence", icon: BrainCircuit,    key: "nav_intelligence" },
  { href: "/operations",   icon: Building2,       key: "nav_operations" },
  { href: "/replay",       icon: History,         key: "nav_replay" },
  { href: "/stories",      icon: BookOpen,        key: "nav_stories" },
];

const NAV_SECONDARY = [
  { href: "/notifications", icon: Bell,       key: "nav_notifications" },
  { href: "/profile",       icon: User,       key: "nav_profile" },
  { href: "/about",         icon: Info,       key: "about_title" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const { situation } = useSituation();

  const currentState = situation?.state.state_id ?? 1;
  const stateMeta = STATES[currentState];

  return (
    <aside className="w-64 flex flex-col bg-afya-deep text-white h-full shrink-0" aria-label="Sidebar navigation">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <div className="w-9 h-9 rounded-xl bg-afya-green flex items-center justify-center shrink-0" aria-hidden="true">
          <Globe className="w-5 h-5 text-white" strokeWidth={1.5} />
        </div>
        <div>
          <div className="font-bold text-[17px] leading-tight tracking-tight text-white">
            {t("brand")}
          </div>
          <div className="text-[11px] text-white/50 leading-tight line-clamp-1">
            {t("tagline")}
          </div>
        </div>
      </div>

      {/* Location + Quality */}
      <div className="mx-4 mb-4 rounded-lg bg-white/8 px-3 py-2.5">
        <div className="text-[11px] text-white/60 font-medium mb-1">{t("location")}</div>
        {situation ? (
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full live-pulse shrink-0"
              style={{ backgroundColor: stateMeta.color }}
              aria-hidden="true"
            />
            <span className="text-[12px] font-semibold text-white/90 leading-tight">
              {lang === "sw" ? stateMeta.name_sw : stateMeta.name}
            </span>
          </div>
        ) : (
          <div className="skeleton h-4 w-28 rounded" />
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 mb-3 border-t border-white/10" aria-hidden="true" />

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-0.5" aria-label="Main navigation">
        {NAV_MAIN.map(({ href, icon: Icon, key }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-afya-green text-white"
                  : "text-white/65 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span className="truncate">{t(key)}</span>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" aria-hidden="true" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Secondary nav */}
      <div className="px-3 pb-3 space-y-0.5">
        <div className="mx-1 mb-2 border-t border-white/10" aria-hidden="true" />
        {NAV_SECONDARY.map(({ href, icon: Icon, key }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-afya-green text-white"
                  : "text-white/50 hover:bg-white/8 hover:text-white",
              )}
            >
              <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span className="truncate">{t(key)}</span>
            </Link>
          );
        })}
      </div>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-white/10">
        {user ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-afya-green flex items-center justify-center shrink-0 text-sm font-bold text-white" aria-hidden="true">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{user.name}</div>
              <div className="text-[11px] text-white/50 truncate">{user.email}</div>
            </div>
          </div>
        ) : (
          <Link
            href="/sign-in"
            className="block w-full text-center rounded-lg bg-afya-green px-4 py-2 text-sm font-semibold text-white hover:bg-afya-green/90 transition-colors"
          >
            {t("sign_in")}
          </Link>
        )}
      </div>
    </aside>
  );
}
