"use client";

import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/language";
import { Sparkles, Send, Loader2, BookOpen, GraduationCap } from "lucide-react";

interface AiPanelProps {
  context?: string; // optional context hint (e.g. "situation", "map")
  initialQuestions?: string[];
}

const SUGGESTED_EN = [
  "Why is exposure rising?",
  "What does this mean for outdoor work?",
  "Why is this the recommended time?",
  "How reliable is this data right now?",
];

const SUGGESTED_SW = [
  "Kwa nini kupatwa kunazidi?",
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
  question?: string; // the question that produced this answer (for re-asking)
}

export default function AiPanel({ context = "situation", initialQuestions }: AiPanelProps) {
  const { t, lang } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("standard");
  const bottomRef = useRef<HTMLDivElement>(null);

  const suggested = initialQuestions ?? (lang === "sw" ? SUGGESTED_SW : SUGGESTED_EN);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ask(question: string, askMode: Mode = mode, showUserMessage = true) {
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
        body: JSON.stringify({ lang, question, context, mode: askMode }),
      });
      const data = await res.json();
      setMessages((m) => [...m, {
        role: "assistant",
        text: data.explanation ?? t("error_generic"),
        source: data.source,
        provider: data.provider,
        mode: data.mode ?? askMode,
        question,
      }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: t("no_ai"), mode: askMode }]);
    } finally {
      setLoading(false);
    }
  }

  // Re-ask the same question in plain language, without duplicating the user bubble
  function explainSimply(msg: Message) {
    const q = msg.question ?? (lang === "sw" ? "Eleza hali ya sasa" : "Explain the current situation");
    ask(q, "plain", false);
  }

  function switchLang(newLang: "en" | "sw") {
    const lastQ = messages.filter((m) => m.role === "user").pop();
    if (lastQ) {
      setMessages([]);
      setTimeout(() => ask(lastQ.text, mode), 50);
    } else {
      setTimeout(
        () => ask(newLang === "en" ? "Summarize the current situation" : "Fupisha hali ya sasa", mode),
        50,
      );
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
        <div className="flex items-center rounded-lg border border-afya-border overflow-hidden text-[11px] font-semibold">
          <button
            onClick={() => switchLang("en")}
            className={`px-2 py-1.5 transition-colors ${lang === "en" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal"}`}
            aria-pressed={lang === "en"}
          >
            EN
          </button>
          <button
            onClick={() => switchLang("sw")}
            className={`px-2 py-1.5 transition-colors ${lang === "sw" ? "bg-afya-deep text-white" : "text-afya-muted hover:text-afya-charcoal"}`}
            aria-pressed={lang === "sw"}
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
                    <span>✦ Gemini · {t("ai_disclaimer")}</span>
                  )}
                  {msg.source === "llm" && msg.provider === "groq" && (
                    <span>✦ Groq · {t("ai_disclaimer")}</span>
                  )}
                  {msg.source === "llm" && msg.provider === "openai" && (
                    <span>✦ OpenAI · {t("ai_disclaimer")}</span>
                  )}
                  {msg.source === "llm" && msg.provider === "anthropic" && (
                    <span>✦ Anthropic · {t("ai_disclaimer")}</span>
                  )}
                  {msg.source === "deterministic" && (
                    <span className="italic">{t("no_ai")}</span>
                  )}

                  {/* Explain simply — only offered on standard answers */}
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
              <span className="text-sm text-afya-muted">{lang === "sw" ? "Inaandika…" : "Writing…"}</span>
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
