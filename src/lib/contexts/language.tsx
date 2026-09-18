"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { Lang } from "@/lib/afya/types";
import { t as translate } from "@/lib/afya/i18n";

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const stored = localStorage.getItem("afya_lang") as Lang | null;
    if (stored === "en" || stored === "sw") {
      setLangState(stored);
      document.cookie = `afya_lang=${stored}; path=/; max-age=31536000; SameSite=Lax`;
    }
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("afya_lang", l);
    // Cookie mirrors preference so server-rendered pages (e.g. /briefing)
    // can respect the same language on first byte.
    document.cookie = `afya_lang=${l}; path=/; max-age=31536000; SameSite=Lax`;
  };

  const t = (key: string) => translate(lang, key);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
