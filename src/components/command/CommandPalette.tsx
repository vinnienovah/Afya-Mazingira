"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, LayoutDashboard, TrendingUp, CalendarCheck, Map as MapIcon,
  BrainCircuit, Building2, History, Bell, User, Info, Printer,
  Languages, Sparkles, X, CornerDownLeft, Sprout, BookOpen,
  Activity, LineChart, Waves,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/language";
import { PALETTE_LINKS } from "./commands";

type Icon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

interface CommandItem {
  id: string;
  group: "pages" | "actions";
  labelKey: string;
  icon: Icon;
  keywords: string;
  run: () => void;
}

const ICONS: Record<string, Icon> = {
  "p-situation": LayoutDashboard,
  "p-forecast": TrendingUp,
  "p-plan": CalendarCheck,
  "p-farm": Sprout,
  "p-map": MapIcon,
  "p-climate": LineChart,
  "p-intelligence": BrainCircuit,
  "p-operations": Building2,
  "p-flood": Waves,
  "p-health": Activity,
  "p-replay": History,
  "p-stories": BookOpen,
  "p-notifications": Bell,
  "p-profile": User,
  "p-about": Info,
  "a-briefing": Printer,
  "a-ask": Sparkles,
};

export default function CommandPalette() {
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<CommandItem[]>(() => [
    ...PALETTE_LINKS.map((link) => ({
      id: link.id,
      group: link.group,
      labelKey: link.labelKey,
      icon: ICONS[link.id] ?? Search,
      keywords: link.keywords,
      run: () => router.push(link.href),
    })),
    { id: "a-language", group: "actions", labelKey: "cmd_language", icon: Languages, keywords: "language english kiswahili lugha en sw badilisha", run: () => setLang(lang === "en" ? "sw" : "en") },
  ], [router, lang, setLang]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const label = t(cmd.labelKey).toLowerCase();
      return label.includes(q) || cmd.keywords.includes(q);
    });
  }, [commands, query, t]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const execute = useCallback(
    (cmd: CommandItem) => {
      close();
      cmd.run();
    },
    [close],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" || target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !isTyping && !open) {
        e.preventDefault();
        setOpen(true);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Custom trigger (TopBar search button)
  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("afya:open-command-palette", onOpen);
    return () => window.removeEventListener("afya:open-command-palette", onOpen);
  }, []);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);


  if (!open) return null;
  const current = active < filtered.length ? active : 0;

  const pages = filtered.filter((c) => c.group === "pages");
  const actions = filtered.filter((c) => c.group === "actions");

  function renderItem(cmd: CommandItem, flatIdx: number) {
    const Icon = cmd.icon;
    const isActive = flatIdx === current;
    return (
      <li
        key={cmd.id}
        id={`cmd-option-${flatIdx}`}
        role="option"
        aria-selected={isActive}
        onMouseEnter={() => setActive(flatIdx)}
        onClick={() => execute(cmd)}
        className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${
          isActive ? "bg-afya-green/10" : ""
        }`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            isActive ? "bg-afya-green text-white" : "bg-afya-canvas text-afya-muted"
          }`}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className={`text-sm ${isActive ? "font-semibold text-afya-charcoal" : "text-afya-charcoal/90"}`}>
          {t(cmd.labelKey)}
        </span>
        {isActive && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-afya-muted">
            <CornerDownLeft className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          </span>
        )}
      </li>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-afya-deep/45 px-4 pt-[14vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("cmd_search")}
      onClick={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-afya-border bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-afya-border px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-afya-muted" strokeWidth={2} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={`cmd-option-${current}`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && filtered[current]) {
                e.preventDefault();
                execute(filtered[current]);
              }
            }}
            placeholder={t("cmd_search")}
            className="w-full bg-transparent text-sm text-afya-charcoal outline-none placeholder:text-afya-muted/60"
          />
          <button
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded-md text-afya-muted hover:bg-afya-canvas"
            aria-label={t("close")}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {/* Results */}
        <div id="cmd-list" role="listbox" aria-label={t("cmd_search")} className="max-h-[46vh] overflow-y-auto">
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-afya-muted">{t("cmd_empty")}</p>
          )}
          {pages.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-afya-muted/70">
                {t("cmd_pages")}
              </p>
              <ul>{pages.map((cmd) => renderItem(cmd, filtered.indexOf(cmd)))}</ul>
            </>
          )}
          {actions.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-afya-muted/70">
                {t("cmd_actions")}
              </p>
              <ul className="pb-2">{actions.map((cmd) => renderItem(cmd, filtered.indexOf(cmd)))}</ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-afya-border bg-afya-canvas/60 px-4 py-2 text-[10px] text-afya-muted">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-afya-border bg-white px-1 font-mono">↑↓</kbd>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-afya-border bg-white px-1 font-mono">↵</kbd>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-afya-border bg-white px-1 font-mono">esc</kbd>
            {t("close")}
          </span>
          <span className="ml-auto">⌘K</span>
        </div>
      </div>
    </div>
  );
}
