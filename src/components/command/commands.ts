// Where the command palette can take you. Kept apart from the component so
// the links can be checked against the pages that exist.

export interface PaletteLink {
  id: string;
  group: "pages" | "actions";
  labelKey: string;
  href: string;
  keywords: string;
}

export const PALETTE_LINKS: PaletteLink[] = [
  { id: "p-situation", group: "pages", labelKey: "nav_situation", href: "/situation", keywords: "home current now hali sasa" },
  { id: "p-forecast", group: "pages", labelKey: "nav_forecast", href: "/forecast", keywords: "forecast wbgt chart utabiri" },
  { id: "p-plan", group: "pages", labelKey: "nav_plan", href: "/plan", keywords: "plan activity best time window panga shughuli" },
  { id: "p-farm", group: "pages", labelKey: "nav_farm", href: "/farm", keywords: "farm irrigation crop spray planting shamba kilimo mwagilia" },
  { id: "p-map", group: "pages", labelKey: "nav_map", href: "/map", keywords: "map counties regional ramani hatari" },
  { id: "p-climate", group: "pages", labelKey: "nav_climate", href: "/climate", keywords: "dashboard climate history variables live dashibodi historia hali ya hewa" },
  { id: "p-intelligence", group: "pages", labelKey: "nav_intelligence", href: "/intelligence", keywords: "why intelligence model contributors ujasusi" },
  { id: "p-operations", group: "pages", labelKey: "nav_operations", href: "/operations", keywords: "operations institutional command uendeshaji" },
  { id: "p-flood", group: "pages", labelKey: "nav_flood", href: "/flood", keywords: "flood rain soil saturation mafuriko mvua udongo" },
  { id: "p-health", group: "pages", labelKey: "nav_health", href: "/health", keywords: "station health quality sensors sentinel afya kituo" },
  { id: "p-replay", group: "pages", labelKey: "nav_replay", href: "/climate?tab=replay", keywords: "replay historical simulation marudio" },
  { id: "p-stories", group: "pages", labelKey: "nav_stories", href: "/stories", keywords: "stories scenarios examples illustrative hadithi mifano" },
  { id: "p-notifications", group: "pages", labelKey: "nav_notifications", href: "/notifications", keywords: "notifications alerts push arifa" },
  { id: "p-profile", group: "pages", labelKey: "nav_profile", href: "/profile", keywords: "profile settings account default activity wasifu" },
  { id: "p-about", group: "pages", labelKey: "about_title", href: "/about", keywords: "about provenance methodology kuhusu" },
  { id: "a-briefing", group: "actions", labelKey: "cmd_briefing", href: "/briefing", keywords: "briefing print pdf report taarifa chapisha" },
  { id: "a-ask", group: "actions", labelKey: "cmd_ask_ai", href: "/situation#ai-section", keywords: "ask ai why explanation gemini kwa nini eleza" },
];
