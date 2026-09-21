"use client";

import { createContext, useContext, useState, useEffect, type ReactNode, useSyncExternalStore } from "react";
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

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readStoredLang(): Lang | null {
  const stored = localStorage.getItem("afya_lang");
  return stored === "en" || stored === "sw" ? stored : null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const stored = useSyncExternalStore(subscribeStorage, readStoredLang, () => null);
  const [chosen, setChosen] = useState<Lang | null>(null);
  const lang: Lang = chosen ?? stored ?? "en";

  // The cookie mirrors the choice so server-rendered pages (/briefing) can use
  // the same language on first byte.
  useEffect(() => {
    document.cookie = `afya_lang=${lang}; path=/; max-age=31536000; SameSite=Lax`;
  }, [lang]);

  const setLang = (l: Lang) => {
    setChosen(l);
    localStorage.setItem("afya_lang", l);
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
