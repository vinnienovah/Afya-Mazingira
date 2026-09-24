import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sitemap from "../src/app/sitemap";
import robots from "../src/app/robots";
import { PALETTE_LINKS } from "../src/components/command/commands";

const APP = path.join(process.cwd(), "src", "app");

/** True when a page file serves this path, in the (app) group or at the top level. */
function pageExists(route: string): boolean {
  const clean = route.split(/[?#]/)[0].replace(/^\//, "");
  return [path.join(APP, clean, "page.tsx"), path.join(APP, "(app)", clean, "page.tsx")].some((f) => fs.existsSync(f));
}

// /replay only redirects to the Dashboard's Replay tab.
const REDIRECT_ONLY = ["/replay"];

test("every command palette link opens a page that exists", () => {
  for (const link of PALETTE_LINKS) assert.ok(pageExists(link.href), `${link.id} -> ${link.href}`);
});

test("the palette reaches the Dashboard and Flood Conditions, and Replay through the Dashboard tab", () => {
  const hrefs = PALETTE_LINKS.map((l) => l.href);
  assert.ok(hrefs.includes("/climate"));
  assert.ok(hrefs.includes("/flood"));
  assert.ok(hrefs.includes("/climate?tab=replay"));
  for (const redirect of REDIRECT_ONLY) assert.ok(!hrefs.includes(redirect));
});

test("palette entries are unique", () => {
  assert.equal(new Set(PALETTE_LINKS.map((l) => l.id)).size, PALETTE_LINKS.length);
  assert.equal(new Set(PALETTE_LINKS.map((l) => l.href)).size, PALETTE_LINKS.length);
});

const sitemapPaths = () => sitemap().map((entry) => new URL(entry.url).pathname.replace(/\/$/, ""));

test("the sitemap lists the farm, dashboard, flood, station health and example pages", () => {
  const paths = sitemapPaths();
  for (const p of ["/farm", "/climate", "/flood", "/health", "/stories"]) assert.ok(paths.includes(p), p);
});

test("every sitemap entry is a real page, not a redirect", () => {
  for (const p of sitemapPaths()) {
    assert.ok(pageExists(p || "/"), p);
    assert.ok(!REDIRECT_ONLY.includes(p), p);
  }
});

test("the sitemap lists nothing robots.txt asks crawlers to skip", () => {
  const rules = robots().rules;
  const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((r) => r.disallow ?? []);
  for (const p of sitemapPaths()) {
    for (const prefix of disallowed) assert.ok(!(p || "/").startsWith(prefix), `${p} under ${prefix}`);
  }
});
