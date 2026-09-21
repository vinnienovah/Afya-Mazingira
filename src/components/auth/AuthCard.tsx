"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/contexts/language";
import { useAuth } from "@/lib/contexts/auth";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { PasswordStrengthMeter } from "@/components/auth/PasswordStrength";
import { Globe, RefreshCw, Eye, EyeOff, CheckCircle2, AlertCircle, Mail } from "lucide-react";

type Mode = "signin" | "signup";
type View = "form" | "check-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthCard({ initialMode }: { initialMode: Mode }) {
  const { t, lang, setLang } = useLanguage();
  const { refresh } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [view, setView] = useState<View>("form");
  const [pendingEmail, setPendingEmail] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  // Surface the Google OAuth redirect's ?error= without useSearchParams
  // (avoids a Suspense boundary requirement on this static auth page).
  useEffect(() => {
    const oauthError = new URLSearchParams(window.location.search).get("error");
    if (oauthError === "google_auth_failed") setError(t("error_google_auth"));
    else if (oauthError === "google_not_configured") setError(t("error_google_not_configured"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setView("form");
    setError(null);
    setUnverifiedEmail(null);
    setResendSent(false);
    setTouched({});
    router.replace(next === "signin" ? "/sign-in" : "/sign-up", { scroll: false });
  }

  // ─── Real-time validation ───────────────────────────────────────────────
  const emailValid = email.length === 0 ? null : EMAIL_RE.test(email);
  const passwordValid = mode === "signup" ? password.length >= 8 : password.length > 0;
  const confirmValid = mode === "signup" ? confirmPassword.length > 0 && confirmPassword === password : true;
  const nameValid = mode === "signup" ? name.trim().length > 0 : true;
  const formValid = emailValid === true && passwordValid && confirmValid && nameValid;

  function markTouched(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true, confirmPassword: true });
    if (!formValid) return;
    setLoading(true);
    setError(null);
    setUnverifiedEmail(null);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/sign-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, lang }),
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) { setError(t("error_email_taken")); return; }
        if (!res.ok) { setError(t("error_generic")); return; }
        if (data.verified) {
          await refresh();
          router.push("/situation");
        } else {
          setPendingEmail(data.email ?? email);
          setView("check-email");
        }
      } else {
        const res = await fetch("/api/auth/sign-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          credentials: "include",
        });
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          setError(t("error_email_not_verified"));
          setUnverifiedEmail(data.email ?? email);
          return;
        }
        if (!res.ok) { setError(t("error_auth")); return; }
        await refresh();
        router.push("/situation");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend(targetEmail: string) {
    setResendLoading(true);
    setResendSent(false);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail, lang }),
      });
      setResendSent(true);
    } finally {
      setResendLoading(false);
    }
  }

  const fieldClass = (invalid: boolean) =>
    `w-full rounded-xl border bg-white px-4 py-3 text-sm text-afya-charcoal focus:outline-none focus:ring-2 placeholder:text-afya-muted/50 ${
      invalid ? "border-afya-red/60 focus:ring-afya-red/40" : "border-afya-border focus:ring-afya-green"
    }`;

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
      <div className="rounded-2xl bg-white p-7 shadow-2xl overflow-hidden">
        <AnimatePresence mode="wait">
          {view === "check-email" ? (
            <motion.div
              key="check-email"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="text-center py-2"
            >
              <div className="w-14 h-14 rounded-full bg-afya-green/10 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-7 h-7 text-afya-green" strokeWidth={1.5} />
              </div>
              <h1 className="text-xl font-bold text-afya-charcoal mb-2">{t("check_your_email")}</h1>
              <p className="text-sm text-afya-muted mb-1">{t("verification_sent_to")}</p>
              <p className="text-sm font-semibold text-afya-charcoal mb-4">{pendingEmail}</p>
              <p className="text-xs text-afya-muted mb-6">{t("verification_instructions")}</p>

              <button
                onClick={() => handleResend(pendingEmail)}
                disabled={resendLoading}
                className="w-full rounded-xl border border-afya-border px-6 py-3 text-sm font-bold text-afya-charcoal hover:bg-afya-bg/60 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {resendLoading && <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
                {resendSent ? t("resend_email_sent") : t("resend_email")}
              </button>

              <button
                onClick={() => switchMode("signin")}
                className="w-full text-center text-sm font-semibold text-afya-green hover:underline mt-4"
              >
                {t("back_to_sign_in")}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, x: mode === "signup" ? 16 : -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: mode === "signup" ? -16 : 16 }}
                  transition={{ duration: 0.18 }}
                >
                  <h1 className="text-2xl font-bold text-afya-charcoal mb-1">
                    {mode === "signin" ? t("welcome_back") : t("join_afya")}
                  </h1>
                  <p className="text-sm text-afya-muted mb-6">
                    {mode === "signin"
                      ? (lang === "sw" ? "Ingia ili kuendelea na AFYA MAZINGIRA" : "Sign in to continue to AFYA MAZINGIRA")
                      : (lang === "sw" ? "Unda akaunti yako ya AFYA MAZINGIRA" : "Create your AFYA MAZINGIRA account")}
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                    {mode === "signup" && (
                      <div>
                        <label htmlFor="name" className="text-xs font-semibold text-afya-charcoal block mb-1.5">
                          {t("name")}
                        </label>
                        <input
                          id="name"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          onBlur={() => markTouched("name")}
                          placeholder={t("name_placeholder")}
                          autoComplete="name"
                          className={fieldClass(touched.name && !nameValid)}
                        />
                        {touched.name && !nameValid && (
                          <p className="text-xs text-afya-red mt-1">{t("field_required")}</p>
                        )}
                      </div>
                    )}

                    <div>
                      <label htmlFor="email" className="text-xs font-semibold text-afya-charcoal block mb-1.5">
                        {t("email")}
                      </label>
                      <div className="relative">
                        <input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          onBlur={() => markTouched("email")}
                          placeholder={t("email_placeholder")}
                          autoComplete="email"
                          className={fieldClass(touched.email && emailValid === false) + " pr-10"}
                        />
                        {emailValid !== null && (touched.email || email.length > 3) && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true">
                            {emailValid ? (
                              <CheckCircle2 className="w-4 h-4 text-afya-green" strokeWidth={2} />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-afya-red" strokeWidth={2} />
                            )}
                          </span>
                        )}
                      </div>
                      {touched.email && emailValid === false && (
                        <p className="text-xs text-afya-red mt-1">{t("email_invalid_format")}</p>
                      )}
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
                          onBlur={() => markTouched("password")}
                          placeholder={t("password_placeholder")}
                          autoComplete={mode === "signin" ? "current-password" : "new-password"}
                          minLength={mode === "signup" ? 8 : undefined}
                          className={fieldClass(touched.password && !passwordValid) + " pr-11"}
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
                      {mode === "signup" ? (
                        <>
                          <PasswordStrengthMeter password={password} />
                          {touched.password && !passwordValid && (
                            <p className="text-xs text-afya-red mt-1">{t("password_min")}</p>
                          )}
                        </>
                      ) : (
                        touched.password && !passwordValid && (
                          <p className="text-xs text-afya-red mt-1">{t("field_required")}</p>
                        )
                      )}
                    </div>

                    {mode === "signup" && (
                      <div>
                        <label htmlFor="confirmPassword" className="text-xs font-semibold text-afya-charcoal block mb-1.5">
                          {t("confirm_password")}
                        </label>
                        <input
                          id="confirmPassword"
                          type={showPw ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          onBlur={() => markTouched("confirmPassword")}
                          placeholder={t("confirm_password_placeholder")}
                          autoComplete="new-password"
                          className={fieldClass(touched.confirmPassword && !confirmValid)}
                        />
                        {touched.confirmPassword && !confirmValid && (
                          <p className="text-xs text-afya-red mt-1">{t("password_mismatch")}</p>
                        )}
                      </div>
                    )}

                    {error && (
                      <div className="rounded-xl border border-afya-red/30 bg-afya-red/8 px-4 py-3 text-sm text-afya-charcoal" role="alert">
                        <p>{error}</p>
                        {unverifiedEmail && (
                          <button
                            type="button"
                            onClick={() => handleResend(unverifiedEmail)}
                            disabled={resendLoading}
                            className="mt-2 text-xs font-bold text-afya-green hover:underline disabled:opacity-50"
                          >
                            {resendLoading && <RefreshCw className="w-3 h-3 animate-spin inline mr-1" strokeWidth={2} aria-hidden="true" />}
                            {resendSent ? t("resend_email_sent") : t("resend_email")}
                          </button>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-xl bg-afya-green px-6 py-3.5 text-sm font-bold text-white hover:bg-afya-green/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                      {loading && <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
                      {mode === "signin"
                        ? (loading ? t("signing_in") : t("sign_in"))
                        : (loading ? t("signing_up") : t("create_account"))}
                    </button>
                  </form>

                  {/* Google */}
                  <div className="mt-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex-1 border-t border-afya-border" aria-hidden="true" />
                      <span className="text-xs text-afya-muted">{t("or_label")}</span>
                      <div className="flex-1 border-t border-afya-border" aria-hidden="true" />
                    </div>
                    <GoogleButton />
                  </div>

                  <p className="text-center text-sm text-afya-muted mt-5">
                    {mode === "signin" ? (
                      <>
                        {t("no_account")}{" "}
                        <button type="button" onClick={() => switchMode("signup")} className="font-semibold text-afya-green hover:underline">
                          {t("sign_up")}
                        </button>
                      </>
                    ) : (
                      <>
                        {t("already_have_account")}{" "}
                        <button type="button" onClick={() => switchMode("signin")} className="font-semibold text-afya-green hover:underline">
                          {t("sign_in")}
                        </button>
                      </>
                    )}
                  </p>
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Motto */}
      <p className="text-center text-white/40 text-xs">{t("about_motto")}</p>
    </div>
  );
}
