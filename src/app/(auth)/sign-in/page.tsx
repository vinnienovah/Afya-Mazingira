"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/language";
import { useAuth } from "@/lib/contexts/auth";
import { Globe, RefreshCw, Eye, EyeOff } from "lucide-react";

const DEMO_EMAIL = "demo@afyahewa.dev";
const DEMO_PASSWORD = "afyahewa2026";

export default function SignInPage() {
  const { t, lang, setLang } = useLanguage();
  const { refresh } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!res.ok) {
        setError(t("error_auth"));
        return;
      }
      await refresh();
      router.push("/situation");
    } finally {
      setLoading(false);
    }
  }

  async function fillDemo() {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setDemoLoading(true);
    setError(null);
    try {
      // Try to sign in with demo credentials; if account doesn't exist, sign up first
      let res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
        credentials: "include",
      });

      if (!res.ok) {
        // Create demo account
        res = await fetch("/api/auth/sign-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Demo User",
            email: DEMO_EMAIL,
            password: DEMO_PASSWORD,
          }),
          credentials: "include",
        });
      }

      if (!res.ok) {
        setError(t("error_auth"));
        return;
      }

      await refresh();
      router.push("/situation");
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Brand header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-afya-green flex items-center justify-center shrink-0" aria-hidden="true">
          <Globe className="w-5 h-5 text-white" strokeWidth={1.5} />
        </div>
        <div>
          <div className="text-xl font-bold text-white">{t("brand")}</div>
          <div className="text-xs text-white/50">{t("tagline")}</div>
        </div>
        {/* Language toggle */}
        <div className="ml-auto flex items-center rounded-lg overflow-hidden text-xs font-bold border border-white/20">
          {(["en", "sw"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`px-2.5 py-1.5 transition-colors ${lang === l ? "bg-white/20 text-white" : "text-white/50"}`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Card */}
      <div className="rounded-2xl bg-white p-7 shadow-2xl">
        <h1 className="text-2xl font-bold text-afya-charcoal mb-1">{t("welcome_back")}</h1>
        <p className="text-sm text-afya-muted mb-6">{lang === "sw" ? "Ingia ili kuendelea na AFYA MAZINGIRA" : "Sign in to continue to AFYA MAZINGIRA"}</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="text-xs font-semibold text-afya-charcoal block mb-1.5">
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("email_placeholder")}
              autoComplete="email"
              required
              className="w-full rounded-xl border border-afya-border bg-white px-4 py-3 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green placeholder:text-afya-muted/50"
            />
          </div>

          <div>
            <label htmlFor="password" className="text-xs font-semibold text-afya-charcoal block mb-1.5">
              {t("password")}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("password_placeholder")}
                autoComplete="current-password"
                required
                className="w-full rounded-xl border border-afya-border bg-white px-4 py-3 pr-11 text-sm text-afya-charcoal focus:outline-none focus:ring-2 focus:ring-afya-green placeholder:text-afya-muted/50"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-afya-muted hover:text-afya-charcoal"
              >
                {showPw ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-afya-red/30 bg-afya-red/8 px-4 py-3 text-sm text-afya-charcoal" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-afya-green px-6 py-3.5 text-sm font-bold text-white hover:bg-afya-green/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading && <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
            {loading ? t("signing_in") : t("sign_in")}
          </button>
        </form>

        {/* Demo account */}
        <div className="mt-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 border-t border-afya-border" aria-hidden="true" />
            <span className="text-xs text-afya-muted">{t("or_label")}</span>
            <div className="flex-1 border-t border-afya-border" aria-hidden="true" />
          </div>
          <button
            onClick={fillDemo}
            disabled={demoLoading}
            className="w-full rounded-xl border-2 border-afya-gold/50 bg-afya-gold/8 px-6 py-3.5 text-sm font-bold text-[#7a5c00] hover:bg-afya-gold/15 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {demoLoading && <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
            {t("use_demo")}
          </button>
          <p className="text-xs text-afya-muted/60 text-center mt-2">
            {lang === "sw" ? "Hii itaunda au kuingia kwenye akaunti ya onyo" : "This will sign in to or create a demo account"}
          </p>
        </div>

        <p className="text-center text-sm text-afya-muted mt-5">
          {t("no_account")}{" "}
          <Link href="/sign-up" className="font-semibold text-afya-green hover:underline">
            {t("sign_up")}
          </Link>
        </p>
      </div>

      {/* Motto */}
      <p className="text-center text-white/40 text-xs">{t("about_motto")}</p>
    </div>
  );
}
