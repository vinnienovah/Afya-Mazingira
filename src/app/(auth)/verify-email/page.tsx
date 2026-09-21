"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useLanguage } from "@/lib/contexts/language";
import { Globe, RefreshCw, CheckCircle2, XCircle } from "lucide-react";

type Status = "verifying" | "success" | "failed";

export default function VerifyEmailPage() {
  const { t, lang, setLang } = useLanguage();
  const [status, setStatus] = useState<Status>("verifying");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    let active = true;
    const verify = async (value: string) => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: value }),
        });
        return res.ok;
      } catch {
        return false;
      }
    };
    (token ? verify(token) : Promise.resolve(false)).then((ok) => {
      if (active) setStatus(ok ? "success" : "failed");
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
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

      <div className="rounded-2xl bg-white p-7 shadow-2xl text-center">
        <motion.div
          key={status}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="py-2"
        >
          {status === "verifying" && (
            <>
              <RefreshCw className="w-8 h-8 text-afya-green animate-spin mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-sm text-afya-muted">{t("verifying_email")}</p>
            </>
          )}
          {status === "success" && (
            <>
              <div className="w-14 h-14 rounded-full bg-afya-green/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-afya-green" strokeWidth={1.5} />
              </div>
              <h1 className="text-xl font-bold text-afya-charcoal mb-2">{lang === "sw" ? "Imethibitishwa" : "Verified"}</h1>
              <p className="text-sm text-afya-muted mb-6">{t("email_verified_success")}</p>
              <Link
                href="/sign-in"
                className="inline-block w-full rounded-xl bg-afya-green px-6 py-3.5 text-sm font-bold text-white hover:bg-afya-green/90 transition-colors"
              >
                {t("go_to_sign_in")}
              </Link>
            </>
          )}
          {status === "failed" && (
            <>
              <div className="w-14 h-14 rounded-full bg-afya-red/10 flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-7 h-7 text-afya-red" strokeWidth={1.5} />
              </div>
              <h1 className="text-xl font-bold text-afya-charcoal mb-2">{lang === "sw" ? "Imeshindikana" : "Failed"}</h1>
              <p className="text-sm text-afya-muted mb-6">{t("email_verify_failed")}</p>
              <Link
                href="/sign-in"
                className="inline-block w-full rounded-xl border border-afya-border px-6 py-3.5 text-sm font-bold text-afya-charcoal hover:bg-afya-bg/60 transition-colors"
              >
                {t("back_to_sign_in")}
              </Link>
            </>
          )}
        </motion.div>
      </div>

      <p className="text-center text-white/40 text-xs">{t("about_motto")}</p>
    </div>
  );
}
