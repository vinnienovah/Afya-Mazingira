import { NextResponse } from "next/server";

// Provider readiness only. No secret values or identifying project metadata
// ever leave the server.
export async function GET() {
  return NextResponse.json({
    communication_layer: "ready",
    providers: {
      gemini: !!process.env.GEMINI_API_KEY,
      groq: !!process.env.GROQ_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.LLM_API_KEY,
      deterministic_fallback: true,
    },
    preferred_provider: process.env.GEMINI_API_KEY
      ? "gemini"
      : process.env.GROQ_API_KEY
        ? "groq"
        : process.env.OPENAI_API_KEY
          ? "openai"
          : process.env.LLM_API_KEY
            ? "anthropic"
            : "deterministic",
  });
}
