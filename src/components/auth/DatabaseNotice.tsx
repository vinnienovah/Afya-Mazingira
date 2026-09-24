"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/contexts/language";
import { cn } from "@/lib/utils";

// Whether the server has a database is asked of the server, not guessed from a
// failed request: on a deploy without DATABASE_URL, accounts, saved plans and
// alerts can never work, and the pages that offer them should say so before
// anyone fills a form in.
export function DatabaseNotice({ className }: { className?: string }) {
  const { t } = useLanguage();
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((res) => res.json())
      .catch(() => null)
      .then((data: { database_configured?: boolean } | null) => {
        if (!cancelled && data) setConfigured(data.database_configured === true);
      });
    return () => { cancelled = true; };
  }, []);

  if (configured !== false) return null;

  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border border-afya-gold/50 bg-afya-gold/10 px-4 py-3 flex gap-2.5",
        className,
      )}
    >
      <AlertTriangle className="w-4 h-4 text-afya-orange shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
      <p className="text-sm text-afya-charcoal">{t("database_not_configured")}</p>
    </div>
  );
}
