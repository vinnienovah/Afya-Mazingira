"use client";

import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { t as translate } from "@/lib/afya/i18n";
import type { Lang } from "@/lib/afya/types";
import { exposureTrend, type Trend } from "@/lib/afya/display";
import { useSituation } from "@/lib/contexts/situation";
import { Sparkles, Send, Loader2, BookOpen, GraduationCap } from "lucide-react";

interface AiPanelProps {
  context?: string; // optional context hint (e.g. "situation", "map")
  initialQuestions?: string[];
  // Extra fields merged into the /api/ai/explain request body, e.g. the
  // selected crop/stage on the Farm Advisory page, so the AI can answer
  // farm-specific questions instead of only general situation facts.
  extraParams?: Record<string, string>;
}

// The first suggestion follows where the forecast says exposure is heading.
const TREND_QUESTION: Record<Trend, Record<Lang, string>> = {
  rising: { en: "Why is exposure rising?", sw: "Kwa nini kupatwa na joto kunaongezeka?" },
  falling: { en: "Why is exposure falling?", sw: "Kwa nini kupatwa na joto kunapungua?" },
  stable: { en: "Why is exposure steady?", sw: "Kwa nini kupatwa na joto hakubadiliki?" },
};

const SUGGESTED_EN = [
  "What does this mean for outdoor work?",
  "Why is this the recommended time?",
  "How reliable is this data right now?",
];

const SUGGESTED_SW = [
  "Hii ina maana gani kwa kazi za nje?",
  "Kwa nini huu ndio wakati unaopendekezwa?",
  "Data hii ina uhakika kiasi gani sasa hivi?",
];

type Mode = "standard" | "plain";

interface Message {
  role: "user" | "assistant";
  text: string;
  source?: "llm" | "deterministic";
  provider?: "gemini" | "groq" | "openai" | "anthropic" | "deterministic";
  mode?: Mode;
  lang?: Lang; // language the answer was written in
  question?: string; // the question that produced this answer (for re-asking)
}

export default function AiPanel({ context = "situation", initialQuestions, extraParams }: AiPanelProps) {
  const { t, lang } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("standard");
  // Answers follow the page language until EN or SW is picked here.
  const [chosenLang, setChosenLang] = useState<Lang | null>(null);
  const answerLang: Lang = chosenLang ?? lang;
  const bottomRef = useRef<HTMLDivElement>(null);

  const { situation } = useSituation();
  const trend = situation ? exposureTrend(situation.current.wbgt_c, situation.forecast) : null;
  const suggested = initialQuestions ?? [
    ...(trend ? [TREND_QUESTION[trend][lang]] : []),
    ...(lang === "sw" ? SUGGESTED_SW : SUGGESTED_EN),
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ask(question: string, askMode: Mode = mode, showUserMessage = true, askLang: Lang = answerLang) {
    if (!question.trim() || loading) return;
    if (showUserMessage) {
      setMessages((m) => [...m, { role: "user", text: question }]);
    }
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: askLang, question, context, mode: askMode, ...extraParams }),
      });
      const data = await res.json();
      const failed = res.status === 429 ? translate(askLang, "ai_rate_limited") : translate(askLang, "error_generic");
      setMessages((m) => [...m, {
        role: "assistant",
        text: data.explanation ?? failed,
        source: data.source,
        provider: data.provider,
        mode: data.mode ?? askMode,
        lang: askLang,
        question,
      }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: translate(askLang, "no_ai"), mode: askMode, lang: askLang }]);
    } finally {
      setLoading(false);
    }
  }

  // Re-ask the same question in plain language, without duplicating the user bubble
  function explainSimply(msg: Message) {
    const msgLang = msg.lang ?? answerLang;
    const q = msg.question ?? (msgLang === "sw" ? "Eleza hali ya sasa" : "Explain the current situation");
    ask(q, "plain", false, msgLang);
  }

  // Answers the last question again in the chosen language.
  function switchLang(newLang: Lang) {
    if (newLang === answerLang || loading) return;
    setChosenLang(newLang);
    const lastQ = messages.filter((m) => m.role === "user").pop();
    if (lastQ) {
      setMessages([{ role: "user", text: lastQ.text }]);
      ask(lastQ.text, mode, false, newLang);
    } else {
      ask(newLang === "en" ? "Summarize the current situation" : "Fupisha hali ya sasa", mode, true, newLang);
    }
  }

  return (
    <div className="card-afya overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-afya-border px-5 py-3.5">
        <div className="w-7 h-7 rounded-lg bg-afya-gold/15 flex items-center justify-center shrink-0" aria-hidden="true">
          <Sparkles className="w-4 h-4 text-afya-gold" strokeWidth={1.8} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-afya-charcoal">{t("afya_ai")}</span>
        </div>

        {/* Reading-level toggle */}
        <div
          className="flex items-center rounded-lg border border-afya-border overflow-hidden text-[11px] font-semibold"
          role="group"
          aria-label={t("ai_mode_label")}
        >
          <button
            onClick={() => setMode("standard")}
            aria-pressed={mode === "standard"}
            title={t("ai_mode_standard_hint")}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors ${
              mode === "standard" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal"
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t("ai_mode_standard")}
          </button>
          <button
            onClick={() => setMode("plain")}
            aria-pressed={mode === "plain"}
            title={t("ai_mode_plain_hint")}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors ${
              mode === "plain" ? "bg-afya-green text-white" : "text-afya-muted hover:text-afya-charcoal"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t("ai_mode_plain")}
          </button>
        </div>

        {/* Language toggle for explanation */}
        <div
          className="flex items-center rounded-lg border border-afya-border overflow-hidden text-[11px] font-semibold"
          role="group"
          aria-label={t("ai_answer_language")}
        >
          <button
            onClick={() => switchLang("en")}
            disabled={loading}
            className={`px-2 py-1.5 transition-colors ${answerLang === "en" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal"}`}
            aria-pressed={answerLang === "en"}
          >
            EN
          </button>
          <button
            onClick={() => switchLang("sw")}
            disabled={loading}
            className={`px-2 py-1.5 transition-colors ${answerLang === "sw" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal"}`}
            aria-pressed={answerLang === "sw"}
          >
            SW
          </button>
        </div>
      </div>

      {/* Mode hint */}
      <div className="px-5 pt-3">
        <p className="text-[11px] text-afya-muted">
          {mode === "plain" ? t("ai_mode_plain_hint") : t("ai_mode_standard_hint")}
        </p>
      </div>

      {/* Messages */}
      <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto" aria-live="polite" aria-label="AI conversation">
        {messages.length === 0 && (
          <p className="text-sm text-afya-muted italic">{t("ask_placeholder")}</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-afya-deep text-white rounded-tr-sm"
                  : msg.mode === "plain"
                    ? "bg-afya-green/8 border border-afya-green/30 text-afya-charcoal rounded-tl-sm"
                    : "bg-afya-canvas border border-afya-border text-afya-charcoal rounded-tl-sm"
              }`}
            >
              {/* Plain-language badge */}
              {msg.role === "assistant" && msg.mode === "plain" && (
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-afya-green">
                  <BookOpen className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                  {t("ai_mode_plain")}
                </div>
              )}

              {msg.text}

              {msg.role === "assistant" && (
                <div className="mt-2 pt-2 border-t border-afya-border/60 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-afya-muted/70">
                  {msg.source === "llm" && msg.provider === "gemini" && (
                    <span>Gemini · {t("ai_disclaimer")}</span>
                  )}
                  {msg.source === "llm" && msg.provider === "groq" && (
                    <span>Groq · {t("ai_disclaimer")}</span>
                  )}
                  {msg.source === "llm" && msg.provider === "openai" && (
                    <span>OpenAI · {t("ai_disclaimer")}</span>
                  )}
                  {msg.source === "llm" && msg.provider === "anthropic" && (
                    <span>Anthropic · {t("ai_disclaimer")}</span>
                  )}
                  {msg.source === "deterministic" && (
                    <span className="italic">{translate(msg.lang ?? lang, "no_ai")}</span>
                  )}

                  {/* Explain simply, only offered on standard answers */}
                  {msg.mode !== "plain" && !loading && (
                    <button
                      onClick={() => explainSimply(msg)}
                      className="inline-flex items-center gap-1 rounded-full border border-afya-green/40 px-2 py-0.5 text-[10px] font-semibold text-afya-green hover:bg-afya-green/10 transition-colors"
                    >
                      <BookOpen className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                      {t("ai_explain_simply")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-afya-canvas border border-afya-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-afya-muted animate-spin" aria-hidden="true" />
              <span className="text-sm text-afya-muted">{answerLang === "sw" ? "Inaandika…" : "Writing…"}</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions */}
      {messages.length === 0 && (
        <div className="px-5 pb-3">
          <p className="text-[11px] font-medium text-afya-muted mb-2">{t("suggested_questions")}</p>
          <div className="flex flex-wrap gap-2">
            {suggested.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="rounded-full border border-afya-border bg-white px-3 py-1.5 text-xs text-afya-muted hover:border-afya-green hover:text-afya-green transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form
        className="flex items-center gap-2 border-t border-afya-border px-4 py-3"
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        role="search"
        aria-label={t("ask_placeholder")}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("ask_placeholder")}
          className="flex-1 bg-transparent text-sm text-afya-charcoal placeholder:text-afya-muted/60 outline-none min-w-0"
          aria-label={t("ask_placeholder")}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          aria-label={t("send")}
          className="w-8 h-8 rounded-lg bg-afya-green flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-afya-green/90 transition-colors shrink-0"
        >
          <Send className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
