"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { useAuth } from "@/lib/contexts/auth";
import { ACTIVITY_PROFILES } from "@/lib/afya/constants";
import { Card, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { CheckCircle2, RefreshCw, LogOut, Globe } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ProfilePage() {
  const { t, lang, setLang } = useLanguage();
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<{
    language: string; units: string; preferred_activities: string[]; notification_prefs: Record<string, boolean>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [units, setUnits] = useState("C");
  const [activities, setActivities] = useState<string[]>(["general"]);

  useEffect(() => {
    if (!user) return;
    fetch("/api/preferences", { credentials: "include" }).then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setPrefs(data.preferences);
        setUnits(data.preferences?.units ?? "C");
        setActivities(data.preferences?.preferred_activities ?? ["general"]);
        if (data.language === "en" || data.language === "sw") setLang(data.language);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function savePrefs() {
    setSaving(true);
    try {
      await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: lang, units, preferred_activities: activities }),
        credentials: "include",
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.push("/situation");
  }

  if (authLoading) {
    return <div className="skeleton h-32 rounded-2xl max-w-lg mx-auto mt-8" aria-label="Loading" />;
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto mt-8">
        <Card>
          <div className="text-center py-8 space-y-3">
            <p className="font-semibold text-afya-charcoal">{t("protected_route")}</p>
            <div className="flex gap-3 justify-center">
              <a href="/sign-in" className="text-sm font-semibold text-afya-green hover:underline">{t("sign_in")}</a>
              <a href="/sign-up" className="text-sm font-semibold text-afya-green hover:underline">{t("sign_up")}</a>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("profile_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("profile_subtitle")}</p>
      </div>

      {/* User card */}
      <Card>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-afya-green flex items-center justify-center text-2xl font-bold text-white shrink-0" aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-bold text-afya-charcoal">{user.name}</div>
            <div className="text-sm text-afya-muted">{user.email}</div>
            <div className="text-xs text-afya-muted/60 mt-0.5">
              {t("member_since")} {new Date(user.created_at).toLocaleDateString("en-KE", { month: "short", year: "numeric" })}
            </div>
          </div>
        </div>
      </Card>

      {/* Language */}
      <Card>
        <div className="flex items-center gap-2 mb-3" aria-hidden="true">
          <Globe className="w-4 h-4 text-afya-muted" strokeWidth={1.8} />
          <CardTitle className="mb-0">{t("language")}</CardTitle>
        </div>
        <div className="flex gap-2">
          {(["en", "sw"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={cn(
                "flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition-all",
                lang === l
                  ? "border-afya-green bg-afya-green text-white"
                  : "border-afya-border text-afya-charcoal hover:border-afya-green/50",
              )}
            >
              {l === "en" ? "English" : "Kiswahili"}
            </button>
          ))}
        </div>
      </Card>

      {/* Units */}
      <Card>
        <CardTitle>{t("units")}</CardTitle>
        <div className="flex gap-2">
          {["C", "F"].map((u) => (
            <button
              key={u}
              onClick={() => setUnits(u)}
              aria-pressed={units === u}
              className={cn(
                "flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition-all",
                units === u
                  ? "border-afya-green bg-afya-green text-white"
                  : "border-afya-border text-afya-charcoal hover:border-afya-green/50",
              )}
            >
              {u === "C" ? t("celsius") : t("fahrenheit")}
            </button>
          ))}
        </div>
      </Card>

      {/* Preferred activities */}
      <Card>
        <CardTitle>{t("preferred_activities")}</CardTitle>
        <div className="grid grid-cols-2 gap-2">
          {ACTIVITY_PROFILES.map((p) => {
            const active = activities.includes(p.key);
            return (
              <button
                key={p.key}
                onClick={() =>
                  setActivities((a) => active ? a.filter((x) => x !== p.key) : [...a, p.key])
                }
                aria-pressed={active}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-xs font-medium text-left transition-all",
                  active
                    ? "border-afya-green bg-afya-green/8 text-afya-green"
                    : "border-afya-border text-afya-charcoal hover:border-afya-green/50",
                )}
              >
                {lang === "sw" ? p.label_sw : p.label_en}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Save */}
      <button
        onClick={savePrefs}
        disabled={saving}
        className="w-full rounded-xl bg-afya-green px-6 py-3.5 text-sm font-bold text-white hover:bg-afya-green/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {saving
          ? <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          : saved
            ? <CheckCircle2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            : null
        }
        {saved ? t("plan_saved") : t("save")}
      </button>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full rounded-xl border border-afya-red/30 px-6 py-3.5 text-sm font-semibold text-afya-red hover:bg-afya-red/8 transition-colors flex items-center justify-center gap-2"
      >
        <LogOut className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
        {t("sign_out")}
      </button>
    </div>
  );
}
