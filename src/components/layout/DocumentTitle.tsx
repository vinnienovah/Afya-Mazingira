"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/contexts/language";
import { PALETTE_LINKS } from "@/components/command/commands";

// A page's own title, set in an effect, loses: the route's metadata is applied
// after the page commits and on every navigation, which is why the tab kept
// reading the site default and never followed the chosen language. Setting it
// here and holding it against that reapplication gives every page the same
// treatment in whichever language is showing.
const TITLE_KEYS: Record<string, string> = Object.fromEntries(
  PALETTE_LINKS.filter((l) => l.group === "pages" && !l.href.includes("?")).map((l) => [l.href, l.labelKey]),
);
TITLE_KEYS["/briefing"] = "cmd_briefing";

export default function DocumentTitle() {
  const pathname = usePathname();
  const { t, lang } = useLanguage();

  useEffect(() => {
    const key = TITLE_KEYS[pathname];
    if (!key) return;
    const title = `${t(key)} | AFYA MAZINGIRA`;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();

    const head = document.querySelector("head");
    if (!head) return;
    const watch = new MutationObserver(apply);
    watch.observe(head, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [pathname, t, lang]);

  return null;
}
