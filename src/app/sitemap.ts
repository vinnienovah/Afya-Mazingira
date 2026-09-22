import type { MetadataRoute } from "next";

const base = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://afya-mazingira.local").replace(/\/$/, "");

// Public pages only. /replay is left out because it only redirects to the
// Dashboard's Replay tab; /profile and /notifications need a sign-in.
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: { path: string; priority: number }[] = [
    { path: "", priority: 1.0 },
    { path: "/situation", priority: 0.9 },
    { path: "/forecast", priority: 0.8 },
    { path: "/plan", priority: 0.8 },
    { path: "/farm", priority: 0.8 },
    { path: "/map", priority: 0.8 },
    { path: "/climate", priority: 0.7 },
    { path: "/intelligence", priority: 0.7 },
    { path: "/flood", priority: 0.7 },
    { path: "/health", priority: 0.6 },
    { path: "/operations", priority: 0.6 },
    { path: "/briefing", priority: 0.6 },
    { path: "/stories", priority: 0.5 },
    { path: "/about", priority: 0.5 },
  ];

  return staticRoutes.map(({ path, priority }) => ({
    url: `${base()}${path}`,
    lastModified: new Date("2026-09-18"),
    changeFrequency: path === "" || path === "/situation" ? "hourly" as const : "daily" as const,
    priority,
  }));
}
