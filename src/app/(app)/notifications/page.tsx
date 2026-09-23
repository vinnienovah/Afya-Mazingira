"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { useAuth } from "@/lib/contexts/auth";
import { ACTIVITY_PROFILES } from "@/lib/afya/constants";
import { tf } from "@/lib/afya/i18n";
import { fmtAsOf } from "@/lib/afya/format";
import { Card, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { DatabaseNotice } from "@/components/auth/DatabaseNotice";
import {
  Bell, BellOff, Plus, Trash2, ToggleLeft, ToggleRight,
  CheckCircle2, RefreshCw, Mail,
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

type PushState = "checking" | "unsupported" | "off" | "on" | "denied";

interface DeliveryStatus {
  database_configured: boolean;
  email_configured: boolean;
  push_configured: boolean;
  /** When the daily cron job last ran, ISO, or null if it never has here. */
  last_checked_at: string | null;
}

/** The VAPID public key as the bytes pushManager.subscribe expects. */
function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// The service worker registers after page load; wait for it, but not forever:
// if it cannot install, serviceWorker.ready never settles.
async function readyRegistration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration | null> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
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
  const [delivery, setDelivery] = useState<DeliveryStatus | null>(null);
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  // New rule form
  const [showForm, setShowForm] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState("state_transition");
  const [ruleActivity, setRuleActivity] = useState("general");
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  // The rule whose delete has been asked for but not yet confirmed. A rule is
  // easy to lose to one stray tap on a phone and there is no undo.
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  useEffect(() => {
    if (user) loadRules();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const status = await fetch("/api/notifications/status")
        .then((res) => (res.ok ? (res.json() as Promise<DeliveryStatus>) : null))
        .catch(() => null);
      let state: PushState = "unsupported";
      if (pushSupported()) {
        const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
        const subscription = await registration?.pushManager.getSubscription().catch(() => null);
        state = subscription ? "on" : Notification.permission === "denied" ? "denied" : "off";
      }
      if (cancelled) return;
      setDelivery(status);
      setPushState(state);
    })();
    return () => { cancelled = true; };
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
    setConfirmingDelete(null);
    await fetch(`/api/notifications/${id}`, { method: "DELETE", credentials: "include" });
    loadRules();
  }

  async function sendTestAlert() {
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setTestResult(data.message ?? t("error_generic"));
      } else if (data.test_email_sent) {
        setTestResult(lang === "sw"
          ? "Hakuna sheria iliyochochewa na hali za sasa, barua pepe ya majaribio imetumwa."
          : "None of your rules are triggered by current conditions, sent a test email instead.");
      } else {
        setTestResult(lang === "sw"
          ? `Barua pepe imetumwa kwa: ${data.triggered.join(", ")}`
          : `Email sent for: ${data.triggered.join(", ")}`);
      }
    } catch {
      setTestResult(t("error_generic"));
    } finally {
      setTestSending(false);
    }
  }

  async function enablePush() {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const key = await fetch("/api/push/vapid-key").then((res) => res.json());
      if (!key.configured || !key.public_key) {
        setDelivery((d) => (d ? { ...d, push_configured: false } : d));
        return;
      }
      const registration = await readyRegistration();
      if (!registration) {
        setPushMessage(t("push_sw_unavailable"));
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState(permission === "denied" ? "denied" : "off");
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(key.public_key),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
        credentials: "include",
      });
      if (!res.ok) {
        await subscription.unsubscribe();
        setPushMessage(t("error_generic"));
        return;
      }
      setPushState("on");
    } catch {
      setPushMessage(t("error_generic"));
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          credentials: "include",
        });
        await subscription.unsubscribe();
      }
      setPushState("off");
    } catch {
      setPushMessage(t("error_generic"));
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTestPush() {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const res = await fetch("/api/push/send", { method: "POST", credentials: "include" });
      setPushMessage(
        res.ok ? t("push_test_sent")
          : res.status === 429 ? t("error_rate_limited")
            : res.status === 404 ? t("push_no_subscription")
              : res.status === 503 ? t("push_not_configured")
                : t("error_generic"),
      );
    } catch {
      setPushMessage(t("error_generic"));
    } finally {
      setPushBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto mt-8 space-y-4">
        <DatabaseNotice />
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

      <DatabaseNotice />

      {/* How alerts are delivered */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-afya-green/10 flex items-center justify-center shrink-0" aria-hidden="true">
              <Mail className="w-5 h-5 text-afya-green" strokeWidth={1.8} />
            </div>
            <div className="text-sm text-afya-charcoal pt-2">
              {delivery === null ? (
                <Skeleton className="h-4 w-64 rounded" />
              ) : (
                <>
                  <p>{delivery.email_configured ? t("notif_delivery_email") : t("notif_delivery_email_off")}</p>
                  <p className="text-xs text-afya-muted mt-1">
                    {delivery.last_checked_at
                      ? tf(lang, "notif_last_checked", { time: fmtAsOf(delivery.last_checked_at, lang) })
                      : t("notif_never_checked")}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 flex-wrap border-t border-afya-border pt-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-afya-green/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <Bell className="w-5 h-5 text-afya-green" strokeWidth={1.8} />
              </div>
              <div>
                <p className="font-semibold text-afya-charcoal text-sm">{t("push_title")}</p>
                <p className="text-xs text-afya-muted mt-0.5">
                  {delivery && !delivery.push_configured ? t("push_not_configured")
                    : pushState === "unsupported" ? t("push_not_supported")
                      : pushState === "denied" ? t("push_denied")
                        : pushState === "on" ? t("push_on_hint")
                          : t("push_available_hint")}
                </p>
              </div>
            </div>
            {delivery?.push_configured && pushState === "off" && (
              <button
                onClick={enablePush}
                disabled={pushBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-afya-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-afya-deep/90 disabled:opacity-50 transition-colors"
              >
                {pushBusy && <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
                {t("enable_push")}
              </button>
            )}
            {delivery?.push_configured && pushState === "on" && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={sendTestPush}
                  disabled={pushBusy}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-afya-border px-3 py-2 text-sm font-semibold text-afya-charcoal hover:bg-afya-canvas disabled:opacity-50 transition-colors"
                >
                  {pushBusy && <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
                  {t("push_send_test")}
                </button>
                <button
                  onClick={disablePush}
                  disabled={pushBusy}
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-afya-muted hover:bg-afya-canvas disabled:opacity-50 transition-colors"
                >
                  {t("push_turn_off")}
                </button>
              </div>
            )}
          </div>
          {pushMessage && (
            <p className="text-xs text-afya-charcoal" role="status">{pushMessage}</p>
          )}
        </div>
      </Card>

      {/* Rules */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-afya-charcoal">{t("notification_rules")}</h2>
        <div className="flex items-center gap-2">
          {rules.length > 0 && (
            <button
              onClick={sendTestAlert}
              disabled={testSending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-afya-border px-3 py-2 text-sm font-semibold text-afya-charcoal hover:bg-afya-canvas disabled:opacity-50 transition-colors"
            >
              {testSending && <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
              {t("send_test_alert")}
            </button>
          )}
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-afya-green px-3 py-2 text-sm font-semibold text-white hover:bg-afya-green/90 transition-colors"
            aria-expanded={showForm}
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            {t("new_rule")}
          </button>
        </div>
      </div>

      {testResult && (
        <div className="rounded-xl border border-afya-green/30 bg-afya-green/8 px-4 py-3 flex gap-2" role="status">
          <CheckCircle2 className="w-4 h-4 text-afya-green shrink-0 mt-0.5" strokeWidth={1.8} aria-hidden="true" />
          <p className="text-sm text-afya-charcoal">{testResult}</p>
        </div>
      )}

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
                    {confirmingDelete === rule.id ? (
                      <div className="flex items-center gap-1.5" role="group" aria-label={t("delete_rule")}>
                        <span className="text-xs text-afya-muted">{t("confirm")}</span>
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="rounded-lg bg-afya-red px-2.5 py-1 text-xs font-semibold text-white hover:bg-afya-red/90 transition-colors"
                        >
                          {t("yes")}
                        </button>
                        <button
                          onClick={() => setConfirmingDelete(null)}
                          className="rounded-lg border border-afya-border px-2.5 py-1 text-xs font-semibold text-afya-muted hover:bg-afya-canvas transition-colors"
                        >
                          {t("no")}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingDelete(rule.id)}
                        className="p-1.5 rounded-lg text-afya-muted hover:bg-afya-red/10 hover:text-afya-red transition-colors"
                        aria-label={t("delete_rule")}
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
