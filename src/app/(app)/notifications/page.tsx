"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { useAuth } from "@/lib/contexts/auth";
import { ACTIVITY_PROFILES } from "@/lib/afya/constants";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Bell, BellOff, Plus, Trash2, ToggleLeft, ToggleRight,
  CheckCircle2, AlertTriangle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NotifRule {
  id: number;
  name: string;
  rule_type: string;
  activity_type?: string;
  enabled: boolean;
  created_at: string;
}

const RULE_TYPES = [
  { key: "state_transition",   label_en: "Environmental state transition",    label_sw: "Mabadiliko ya hali ya mazingira" },
  { key: "exposure_tier",      label_en: "Exposure entering a higher tier",   label_sw: "Kupatwa kuingia kiwango cha juu" },
  { key: "best_time",          label_en: "Best-Time recommendation changes",  label_sw: "Mapendekezo ya Wakati-Bora yanabadilika" },
  { key: "rain",               label_en: "Rain-transition alerts",            label_sw: "Tahadhari za mabadiliko ya mvua" },
  { key: "data_quality",       label_en: "Data-quality degradation",          label_sw: "Kudhoofika kwa ubora wa data" },
];

export default function NotificationsPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const [rules, setRules] = useState<NotifRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [demoPush, setDemoPush] = useState(false);

  // New rule form
  const [showForm, setShowForm] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState("state_transition");
  const [ruleActivity, setRuleActivity] = useState("general");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) loadRules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadRules() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      if (res.ok) setRules(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function saveRule() {
    if (!ruleName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: ruleName, rule_type: ruleType, activity_type: ruleActivity, enabled: true }),
        credentials: "include",
      });
      setRuleName("");
      setShowForm(false);
      loadRules();
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: NotifRule) {
    await fetch(`/api/notifications/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
      credentials: "include",
    });
    loadRules();
  }

  async function deleteRule(id: number) {
    await fetch(`/api/notifications/${id}`, { method: "DELETE", credentials: "include" });
    loadRules();
  }

  async function enablePush() {
    setPushLoading(true);
    try {
      if ("serviceWorker" in navigator && "PushManager" in window) {
        const vapidRes = await fetch("/api/push/vapid-key");
        const vapidData = await vapidRes.json();

        if (vapidData.configured) {
          // Real push (not demo)
          try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: vapidData.public_key,
            });
            const keyP256dh = sub.getKey("p256dh");
            const keyAuth = sub.getKey("auth");
            if (keyP256dh && keyAuth) {
              await fetch("/api/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  endpoint: sub.endpoint,
                  keys: {
                    p256dh: btoa(String.fromCharCode(...Array.from(new Uint8Array(keyP256dh)))),
                    auth: btoa(String.fromCharCode(...Array.from(new Uint8Array(keyAuth)))),
                  },
                }),
                credentials: "include",
              });
            }
            setPushEnabled(true);
          } catch {
            // Permission denied or unavailable
            setPushEnabled(false);
          }
        } else {
          // Demo mode — simulate local push registration
          setDemoPush(true);
          setPushEnabled(true);
        }
      } else {
        alert(t("push_not_supported"));
      }
    } finally {
      setPushLoading(false);
    }
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto mt-8">
        <Card>
          <div className="text-center py-8 space-y-3">
            <Bell className="w-10 h-10 text-afya-muted/40 mx-auto" strokeWidth={1.5} aria-hidden="true" />
            <p className="font-semibold text-afya-charcoal">{t("protected_route")}</p>
            <a href="/sign-in" className="text-sm font-semibold text-afya-green hover:underline">{t("sign_in")}</a>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-afya-charcoal">{t("notif_title")}</h1>
        <p className="text-sm text-afya-muted mt-0.5">{t("notif_subtitle")}</p>
      </div>

      {/* Push enable */}
      <Card>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-afya-green/10 flex items-center justify-center shrink-0" aria-hidden="true">
              <Bell className="w-5 h-5 text-afya-green" strokeWidth={1.8} />
            </div>
            <div>
              <p className="font-semibold text-afya-charcoal text-sm">{t("enable_push")}</p>
              <p className="text-xs text-afya-muted mt-0.5">
                {pushEnabled
                  ? demoPush ? t("demo_push_notice") : t("push_enabled")
                  : lang === "sw"
                    ? "Arifa za mazingira zinatumwa moja kwa moja kwenye kivinjari chako"
                    : "Environmental alerts are pushed directly to your browser"}
              </p>
            </div>
          </div>
          <button
            onClick={enablePush}
            disabled={pushEnabled || pushLoading}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors",
              pushEnabled
                ? "bg-afya-green/10 text-afya-green"
                : "bg-afya-deep text-white hover:bg-afya-deep/90",
            )}
          >
            {pushLoading && <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
            {pushEnabled && <CheckCircle2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
            {(pushEnabled && !demoPush) ? t("push_enabled") : t("enable_push")}
          </button>
        </div>
      </Card>

      {/* Rules */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-afya-charcoal">{t("notification_rules")}</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-afya-green px-3 py-2 text-sm font-semibold text-white hover:bg-afya-green/90 transition-colors"
          aria-expanded={showForm}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
          {t("new_rule")}
        </button>
      </div>

      {/* New rule form */}
      {showForm && (
        <Card>
          <CardTitle>{t("create_alert")}</CardTitle>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-afya-muted block mb-1.5">{t("rule_name")}</label>
              <input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder={lang === "sw" ? "Mfano: Tahadhari ya joto" : "e.g. Midday heat alert"}
                className="w-full rounded-lg border border-afya-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-afya-green placeholder:text-afya-muted/50"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-afya-muted block mb-1.5">{t("rule_type")}</label>
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value)}
                  className="w-full rounded-lg border border-afya-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-afya-green"
                >
                  {RULE_TYPES.map((rt) => (
                    <option key={rt.key} value={rt.key}>
                      {lang === "sw" ? rt.label_sw : rt.label_en}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-afya-muted block mb-1.5">{t("rule_activity")}</label>
                <select
                  value={ruleActivity}
                  onChange={(e) => setRuleActivity(e.target.value)}
                  className="w-full rounded-lg border border-afya-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-afya-green"
                >
                  {ACTIVITY_PROFILES.map((p) => (
                    <option key={p.key} value={p.key}>
                      {lang === "sw" ? p.label_sw : p.label_en}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={saveRule}
                disabled={!ruleName.trim() || saving}
                className="flex-1 rounded-xl bg-afya-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-afya-green/90 disabled:opacity-40 transition-colors"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin mx-auto" strokeWidth={2} aria-hidden="true" /> : t("save_rule")}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-afya-border px-4 py-2.5 text-sm font-semibold text-afya-muted hover:bg-afya-canvas transition-colors"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Rules list */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : rules.length === 0 ? (
        <Card>
          <div className="text-center py-10 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-afya-canvas flex items-center justify-center mx-auto" aria-hidden="true">
              <BellOff className="w-7 h-7 text-afya-muted/50" strokeWidth={1.5} />
            </div>
            <p className="font-semibold text-afya-charcoal">{t("no_notif")}</p>
            <p className="text-sm text-afya-muted max-w-xs mx-auto">{t("no_notif_sub")}</p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-afya-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-afya-green/90 transition-colors"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              {t("create_alert")}
            </button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => {
            const meta = RULE_TYPES.find((rt) => rt.key === rule.rule_type);
            return (
              <Card key={rule.id} className="!p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                    rule.enabled ? "bg-afya-green/10" : "bg-afya-canvas",
                  )} aria-hidden="true">
                    <Bell className={cn("w-5 h-5", rule.enabled ? "text-afya-green" : "text-afya-muted/40")} strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-afya-charcoal">{rule.name}</div>
                    <div className="text-xs text-afya-muted mt-0.5">
                      {meta ? (lang === "sw" ? meta.label_sw : meta.label_en) : rule.rule_type}
                      {rule.activity_type && (
                        <> · {ACTIVITY_PROFILES.find((p) => p.key === rule.activity_type)?.label_en ?? rule.activity_type}</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleRule(rule)}
                      aria-pressed={rule.enabled}
                      aria-label={rule.enabled ? t("rule_active") : t("rule_inactive")}
                      className={cn(
                        "transition-colors",
                        rule.enabled ? "text-afya-green" : "text-afya-muted/40",
                      )}
                    >
                      {rule.enabled
                        ? <ToggleRight className="w-7 h-7" strokeWidth={1.8} />
                        : <ToggleLeft className="w-7 h-7" strokeWidth={1.8} />
                      }
                    </button>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-red/10 hover:text-afya-red transition-colors"
                      aria-label={t("delete_rule")}
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Demo example notice */}
      <div className="rounded-xl border border-afya-gold/30 bg-afya-gold/8 px-4 py-3">
        <p className="text-xs text-afya-muted">
          {lang === "sw"
            ? "Onyo: Katika hali ya uzalishaji, arifa zinatumwa kwa kutumia VAPID keys. Badilisha mipangilio yako kwa matumizi halisi."
            : "Note: For production push delivery, configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables."}
        </p>
      </div>
    </div>
  );
}
