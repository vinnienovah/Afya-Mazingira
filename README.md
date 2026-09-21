<div align="center">

# AFYA MAZINGIRA

### Hyperlocal Environmental Risk & Early Action Intelligence

**From environmental data to early action.**

[![Next.js](https://img.shields.io/badge/Next.js_16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React_19-149ECA?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind](https://img.shields.io/badge/Tailwind_4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-336791?logo=postgresql&logoColor=white)](https://orm.drizzle.team)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

*A Hack The Weather proof-of-concept at the JKUAT / Juja Conduit station, Kenya.*

</div>

---

## Table of Contents

- [What It Is](#what-it-is)
- [The Problem](#the-problem)
- [The Approach — Decision Intelligence, Not a Weather App](#the-approach)
- [Core Concepts](#core-concepts)
- [Features](#features)
- [Architecture](#architecture)
- [Data Sources & Provenance](#data-sources--provenance)
- [The AI Communication Layer](#the-ai-communication-layer)
- [Bilingual by Design (English ⇄ Kiswahili)](#bilingual-by-design)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Scripts](#scripts)
- [Honesty & Limitations](#honesty--limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Hackathon Alignment](#hackathon-alignment)
- [License & Disclaimer](#license--disclaimer)

---

## What It Is

**AFYA MAZINGIRA** (*“health of the environment”* in Kiswahili) is a full-stack environmental **decision-intelligence platform**. It ingests live ground-truth measurements from the JKUAT Conduit Automatic Weather Station, regional reanalysis (ERA5-Land), satellites (Sentinel-2/3) and rainfall climatology (CHIRPS), then transforms them into **states, forecasts, activity-aware risk, best-time recommendations and plain-language explanations** — for farmers, athletes, construction sites, campus operations, and the general public.

The product continuously answers three questions, in **English or Kiswahili**:

> 1. **What is happening?** — a recognised environmental *state*, not raw numbers.
> 2. **What does it mean for what I want to do?** — the activity turns data into a *decision*.
> 3. **When should I do it?** — a deterministic *best-time window*, never a guess.

Status: **live in production** at [afya-mazingira.vercel.app](https://afya-mazingira.vercel.app) — 18 pages, 30 API routes, 16 database tables, **real live Conduit station data**, real ERA5-Land and Copernicus Sentinel, real bilingual AI, installable PWA.

---

## The Problem

A weather app tells you *what the sky is doing*.
It does not help a person decide **what to do about it**.

| Who | What they actually need |
|---|---|
| 🌾 **Farmer (Juja)** | Should I irrigate today? When is it safe to spray? Is it worth planting yet? |
| 🏃 **Sports coach (JKUAT)** | Is 14:00 training inside the heat-stress window? When is the better slot? |
| 🏗️ **Construction supervisor** | Which hours will breach work/rest thresholds tomorrow morning? |
| 🏫 **Campus operations** | One shared picture for grounds, events and field trips. |
| 👩🏾 **General public** | Answers in **plain everyday language**, not meteorological jargon. |

All of these are answered from the **same validated environmental signal** — the art is translating it into the right decision for each person and communicating it clearly.

---

## The Approach

```
DATA  →  QUALITY  →  STATE  →  FORECAST  →  RISK  →  DECISION  →  IMPACT  →  EXPLANATION
```

AFYA MAZINGIRA is built around three non-negotiable principles:

1. **Deterministic first.** Every number, state, forecast, risk tier and recommended window is **computed**. The LLM only *explains* validated results — it never *produces* them.
2. **Activity-aware.** The same WBGT value means a different risk tier for a runner than for the same person walking. Decision is per-activity.
3. **Honest by design.** Data quality is a first-class signal; when the station degrades, uncertainty widens and strong recommendations are suppressed. Plain-language mode is acknowledged as simplified, hiding nothing.

---

## Core Concepts

### 🌀 Climate Reflex — 4 environmental states

The station's day is classified into recurring, physically meaningful states rather than raw readings:

| State | Character |
|---|---|
| 🟢 **Cool & Humid Stable** | Cool, moist, calm — typically overnight |
| 🟡 **Rapid Warming** | Temperature rising, humidity falling, radiation climbing |
| 🟠 **Hot / High-Radiation Exposure** | Peak temperature + radiation, elevated WBGT |
| 🟤 **Cooling / Recovery** | Temperature falling, humidity recovering |

States are colour-coded across every surface — the hero, timeline ribbon, forecast chart bands, replay, briefing.

### ⏱️ Deterministic Best-Time Engine

For an activity + duration + availability window, every 15-minute candidate slot is ranked **lexicographically** (risk tier → peak exposure → rain → uncertainty → mean). The recommendation is a filter over the forecast, **never a model's choice**.

### ⚠️ Data Quality as a First-Class Signal

`GOOD` → normal. `DEGRADED` → warnings + widened uncertainty. `POOR` → strong recommendations are **suppressed automatically**. Freshness, sensor-sync, field-sanity and horizon-elapse are all tracked.

---

## Features

| Page | What it does |
|---|---|
| **/** | Public bilingual landing — live station chip, problem framing, pipeline, provenance, non-goals |
| **/situation** | Act-structured: current state, metrics strip, best window (gold), quality warning, forecast chart, horizon cards, 24 h state ribbon, AI panel, technical measurements |
| **/forecast** | Full signature chart — measured line, dashed+1/3/6 h forecasts, uncertainty band, state-shaded background |
| **/plan** | Activity planner with the deterministic engine + reasons + alternative + saved plans CRUD |
| **/farm** 🌾 | Farm advisory: irrigation (mm & L/m²), spray window, field-work window, crop heat stress, planting outlook — 7 local crops × 4 stages |
| **/map** | **Leaflet** regional outlook — 11 real Kenya county boundaries, 5 layers (outlook/thermal/rain/vegetation/LST), time animation, county drill-down. Every county shows whether it has **Ground + Regional Intelligence** (Kiambu/JKUAT — real Conduit station + ERA5 + Sentinel) or **Regional Intelligence only** (the other 10 — ERA5 + Sentinel, no ground station) |
| **/climate** | **Climate History** dashboard — separate from Intelligence's always-"now" panel: pick any date range and daily/hourly granularity, chart Conduit (JKUAT) or ERA5-Land (any of 11 locations) temperature, humidity, wind, rain and WBGT. The Conduit archive goes back to June 2025 and stays current indefinitely — wide ranges are served straight from the live API in chunked batches, not a static snapshot |
| **/intelligence** (nav: **"Why?"**) | Model contributors, data-quality log, WBGT method, Climate Reflex frames, plus a real-time Climate Variables panel (Conduit + ERA5, last 30h/7d/21d) |
| **/operations** | Institution command centre: alerts, affected activities, operational windows |
| **/replay** | Historical Replay — hide the future, step through a day, then **reveal** and audit the guidance |
| **/stories** | Case studies: farmer / coach / site supervisor / ops lead — each expressed as Data → Insight → Decision → Impact |
| **/briefing** | Server-rendered printable one-pager (state, metrics, best window, forecast table, state strip, provenance, disclaimer) |
| **/notifications** | Web-push + in-app environmental alerts with rule builder |
| **/profile, /about** | Account, preferences, provenance, methodology, non-goals |

**Plus:** ⌘K command palette · email/password **and Google** sign-in, with a required email-verification step before a password account can log in · installable PWA with offline "last-known situation" · robots.txt + sitemap.xml.

---

## Architecture

```
                            ┌──────────────────────┐
                            │      USER (EN / SW)   │
                            └─────────┬─────────────┘
                                      │  PWA · Landing · 18 pages
        ┌─────────────────────────────┼─────────────────────────────┐
        │                     Next.js 16 · App Router                │
        │  ┌───────────────── 30 API routes ───────────────────┐    │
        │  │ situation · forecast · farm · map · climate-series ·│    │
        │  │ climate-history · ai/explain · recommendations ·    │    │
        │  │ plans · notifications · replay · auth (password +   │    │
        │  │ Google + email verification)                        │    │
        │  └───────────────────────┬───────────────────────────┘    │
        │                          │                                 │
        │  ┌───────────────────── DETERMINISTIC ENGINES (lib/afya) ─┐│
        │  │ sources.ts        live Conduit → CSV archive → demo    ││
        │  │ csv-source.ts     real archive (Jun 2025+), any range   ││
        │  │ sources-external  real ERA5-Land, Sentinel, rainfall    ││
        │  │ data-quality.ts   GOOD / DEGRADED / POOR               ││
        │  │ feature-engine.ts 15-min lags, deltas, rolling, cyclic  ││
        │  │ state-engine.ts   Climate Reflex state classifier       ││
        │  │ forecast-engine.ts +1h/+3h/+6h/+9h + conformal uncert.  ││
        │  │ risk-engine.ts    activity-aware WBGT tiers             ││
        │  │ best-time-engine.ts lexicographic sliding window         ││
        │  │ farm-engine.ts    Hargreaves ET₀ · FAO-56 Kc · water    ││
        │  │                   balance · spray · stress · planting   ││
        │  │ explanation.ts    grounded LLM + deterministic fallback ││
        │  └──────────────────────────────────────────────────────┘ │
        │                          │                                 │
        │     Gemini → Groq → OpenAI → Anthropic → deterministic     │
        │                     EN/SW templates                        │
        └──────────────────────────┼─────────────────────────────────┘
                                   │
   ┌───────────┬────────────┬──────┴──────┬───────────┬────────────┐
PostgreSQL  Copernicus   Open-Meteo    JHUB Africa   Kenya county  Resend ·
(Neon,      CDSE Catalog ERA5-Land     Conduit       GeoJSON       Google
16 tables)  Sentinel-2/3 (archive      (live API +   (11 real      OAuth
            real dates   mirror)       CSV archive)  counties)
   └───────────────────────────────────────────────────────────────┘
```

---

## Data Sources & Provenance

| Source | Class | Cadence | Used for |
|---|---|---|---|
| **JKUAT Conduit** (conduit.jhubafrica.com) | `MEASURED` | ~15 min (audited: mean 96.9 obs/day across 465 days) | Temperature, RH, pressure, wind speed/dir, solar IR, rain, WBGT-like — **live**, confirmed working against the real endpoint |
| **Conduit CSV archive** (`data/*.csv`) | `MEASURED` (recorded) | manual re-export | Real recorded fallback covering June 2025 onward, for whenever the live API is unreachable, and for anything the live API's own ~1-month-per-request limit can't reach directly |
| **ERA5-Land** (Open-Meteo archive mirror) | `REGIONAL MODEL` | ~5-day latency (near-real-time); full archive back to 1940 for the Climate History dashboard | Temperature/humidity/wind/pressure regional baseline, soil moisture, local-regional anomaly, **and** the real rainfall totals described below |
| **Rainfall context** (labeled `CHIRPS` in the UI) | `REGIONAL MODEL` | daily | 7 d / 30 d totals, percentile, dry/wet spell — computed from real ERA5-Land precipitation (the same fetch above), **not** the actual CHIRPS gridded product. A genuine CHIRPS point-extraction needs raster tooling (GDAL/`geotiff.js`) this deployment doesn't run yet — see [Roadmap](#roadmap) |
| **Sentinel-2 / 3** (Copernicus CDSE Catalog + Statistics API) | `SATELLITE-DERIVED` | per pass | Real acquisition dates + NDVI stats (best-effort, cloud-filtered for the primary JKUAT area; a lighter-weight quality-gated sample for the other 10 counties) |
| **Kenya county boundaries** | `BOUNDARY` | static | 11 real county polygons (public/geo/counties.geojson) — the flagship JKUAT/Kiambu county gets **Ground + Regional Intelligence** (real Conduit); the other 10 get **Regional Intelligence** (ERA5 + Sentinel only, no ground station) |

Every value on screen carries a provenance class badge — nothing is silently merged.

### Live-Conduit ingestion (spec-accurate cleaning)

- POSTs to `data.php` with `apikey / email / fromdate / todate`
- The live API rejects any single request spanning more than ~a month — confirmed directly against the real endpoint. Wide historical queries (Climate History dashboard) are chunked into ≤28-day batches and merged
- `-999.9` sentinels removed; `wind_gust_dir` excluded (broken by design)
- exact **15-minute mean-bucket grid**, dedupe keep-last, UTC anchored
- **limited 2-slot interpolation for continuous fields only** — rain channels are *never* interpolated
- `todate` is treated as **inclusive of today + 1 day** (observations can land a little behind real time)
- **Preference order: live API → CSV archive → synthetic demo (last resort).** Freshness is always judged from the *observation's own timestamp* against the real clock, never from how recently the app last polled — so a station that's gone quiet for hours shows up honestly as degraded/poor quality instead of being hidden behind a fresh-looking cache.

---

## The AI Communication Layer

A generative layer that translates validated results into natural language — **strictly downstream** of the science.

```
SituationResult JSON ──▶ buildExplanationFacts()
                            │ provider chain (in order)
                            ▼
                      1. Gemini  (structured JSON output)
                      2. Groq    (free-tier fallback, OpenAI-compatible API)
                      3. OpenAI  (Responses API · json_schema strict)
                      4. Anthropic (legacy)
                      5. Deterministic reviewed templates
                            │
                            ▼
                 post-generation grounding validator
                 (temperatures, clock times, risk & quality
                  categories must match the facts, never the raw UTC)
```

- **Two reading levels:** `Standard` (full technical detail) and **Plain language** (short everyday wording, "you" address, jargon explicitly banned) — both bilingual.
- **Structured output only** — JSON with exactly one `explanation` field.
- **Deterministic fallback is a reviewed twin** of each mode, so the product works with zero provider keys.
- **Never** forecasts independently, changes numbers, invents thresholds, or gives medical advice.

---

## Bilingual by Design

- **Every** static string has a reviewed English *and* natural Kiswahili twin (`src/lib/afya/i18n.ts`) — not machine-translated at runtime.
- Runtime switch via the header toggle; preference persisted in `localStorage` **and** an `afya_lang` cookie so **server-rendered pages** (`/briefing`) respect it on first byte.
- AI explanations generate directly in the selected language.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, RSC, Turbopack) |
| UI | React 19 · TypeScript · Tailwind 4 · shadcn-style tokens · framer-motion |
| Hosting | **Vercel** (auto-deploy from GitHub on every push to `main`) |
| Database | PostgreSQL via **Drizzle ORM** (16 tables), hosted on **Neon** (Vercel Marketplace integration) |
| Data/Viz | SWR · Recharts · **Leaflet + react-leaflet** |
| AI providers | Gemini → Groq (free tier) → OpenAI → Anthropic → deterministic |
| Auth | Cookie + session in Postgres · scrypt hashing · **Google OAuth** (authorization-code flow, no SDK) · email verification via **Resend** |
| PWA | manifest + service worker · web-push |
| Quality | zod · lucide-react · sonner |

---

## Project Structure

```
├── data/
│   ├── conduit_master_2025_2026.csv      # real recorded archive, Jun 2025+
│   └── README.md                         # format + refresh workflow
├── src/
│   ├── app/
│   │   ├── page.tsx                      # /  landing (server, full HTML)
│   │   ├── briefing/page.tsx             # /briefing (SERVER-rendered, printable)
│   │   ├── (app)/
│   │   │   ├── layout.tsx                # AppShell (sidebar / mobile nav)
│   │   │   ├── situation/page.tsx
│   │   │   ├── forecast/page.tsx
│   │   │   ├── plan/page.tsx
│   │   │   ├── farm/page.tsx
│   │   │   ├── map/page.tsx
│   │   │   ├── climate/page.tsx          # Climate History dashboard
│   │   │   ├── intelligence/page.tsx     # nav label: "Why?"
│   │   │   ├── operations/page.tsx
│   │   │   ├── replay/page.tsx
│   │   │   ├── stories/page.tsx
│   │   │   ├── notifications/page.tsx
│   │   │   └── profile|about/page.tsx
│   │   ├── (auth)/ sign-in | sign-up | verify-email
│   │   ├── api/                          # 30 routes (see API Reference)
│   │   └── robots.ts · sitemap.ts
│   ├── components/
│   │   ├── ai/AiPanel.tsx                # bilingual AI chat (standard/plain)
│   │   ├── auth/ (AuthCard · GoogleButton · PasswordStrength)
│   │   ├── charts/ (ForecastChart · StateTimeline · ClimateVariablesPanel)
│   │   ├── command/CommandPalette.tsx    # ⌘K
│   │   ├── landing/Landing.tsx
│   │   ├── layout/ (AppShell · Sidebar · TopBar · MobileNav)
│   │   ├── map/CountyLeafletMap.tsx
│   │   ├── briefing/BriefingActions.tsx
│   │   ├── pwa/ServiceWorkerRegister.tsx
│   │   └── ui/ (Card · chips · skeletons · buttons · inputs)
│   ├── contexts/ (language · auth · situation)
│   ├── db/
│   │   ├── index.ts                      # pool (pg) + re-use across HMR
│   │   └── schema.ts                     # 16 tables
│   └── lib/
│       ├── auth/ (logic · google · verification)
│       └── afya/
│           ├── sources.ts                # live Conduit → CSV archive → demo
│           ├── csv-source.ts             # real archive reader, any date range
│           ├── sources-external.ts       # real ERA5-Land, Sentinel, rainfall
│           ├── copernicus.ts             # shared CDSE auth + Statistics API
│           ├── data-quality.ts · feature-engine.ts
│           ├── state-engine.ts · forecast-engine.ts
│           ├── risk-engine.ts · best-time-engine.ts
│           ├── farm-engine.ts · explanation.ts
│           ├── i18n.ts · format.ts · constants.ts · types.ts
│           └── map-data.ts (real 11-county boundaries + indicators)
├── public/
│   ├── geo/counties.geojson              # 11 real county boundaries
│   ├── icons/ · manifest.json · sw.js · landing images
├── gadm41_KEN_shp/                       # full Kenya county/subcounty/ward
│                                          # shapefiles (gitignored, local-only)
│                                          # — for a future location picker
├── scripts/seed.ts                       # one-shot demo-seed for new DB
├── drizzle.config.ts                     # reads DATABASE_URL from .env
├── .env.example
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js 18.18+** (or 20)
- **PostgreSQL 14+** — local (`brew install postgresql@16`), Docker, or Neon/Railway/etc.

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

> 💡 **You can run the entire app in demo mode with a *blank* `.env`** — a realistic Conduit-shaped synthetic series and all engines will work. Add keys only for live data and live AI. `DATABASE_URL` is the one variable most features actually need (auth, plans, notifications) — the live weather/satellite/AI data path works without a database at all.

### 3. Provision the database

```bash
npm run dev &                       # or have Postgres already running
npx drizzle-kit push                # create all 16 tables
```

### 4. (Optional) add the Conduit CSV archive

Drop a CSV export from the Conduit dashboard at `data/conduit_master_2025_2026.csv` (format + refresh workflow in `data/README.md`) to get real recorded station data instead of synthetic demo data whenever the live API is unreachable. Not required — the app runs fine without it.

### 5. (Optional) seed a fresh database

```bash
npx tsx scripts/seed.ts
```

### 6. Run

```bash
npm run dev          # http://localhost:3000
```

| Command | Purpose |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm start` | production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | strict `tsc --noEmit` |

---

## Deployment

Live at **[afya-mazingira.vercel.app](https://afya-mazingira.vercel.app)**, deployed on **Vercel** with **Neon Postgres** (provisioned via the Vercel Marketplace integration — no separate Neon account needed).

The GitHub repository is connected to the Vercel project, so every push to `main` auto-deploys to production, and every pull request gets its own preview deployment with a unique URL.

To deploy your own instance:

1. Import the repo at [vercel.com/new](https://vercel.com/new)
2. Add the Neon Postgres integration from the Vercel Marketplace (or bring your own `DATABASE_URL`)
3. Add the remaining environment variables from `.env.example` in the project's Settings → Environment Variables
4. Run `npx drizzle-kit push` once against the production `DATABASE_URL` to create the schema
5. Set `NEXT_PUBLIC_APP_URL` to your assigned `*.vercel.app` domain (or custom domain) and redeploy — it's used to build the Google OAuth redirect URI and email verification links

---

## Environment Variables

Everything is **server-side only** — never in the browser bundle. All optional.

| Variable | Live impact when set | Fallback when absent |
|---|---|---|
| `DATABASE_URL` | PostgreSQL — needed for auth/plans/notifications | live weather/AI data still works without it |
| `CONDUIT_URL` | station endpoint (default from spec) | same |
| `CONDUIT_API_KEY` + `CONDUIT_EMAIL` | **Live station data** | `data/*.csv` archive, then demo series |
| `CONDUIT_CSV_PATH` | override the archive file location | `data/conduit_master_2025_2026.csv` |
| `GEMINI_API_KEY` | Primary grounded AI explanations | — |
| `GROQ_API_KEY` | Free-tier fallback (OpenAI-compatible API) | skip to OpenAI |
| `OPENAI_API_KEY` | Third AI provider | skip to Anthropic |
| `LLM_API_KEY` | Legacy Anthropic provider | skip to deterministic |
| `COPERNICUS_CLIENT_ID/SECRET` | Real Sentinel catalog dates + NDVI, any of 11 counties | fixture dates |
| `CDS_URL` + `CDS_API_KEY` | CDS key for ERA5 Python-sidecar path (spec) | Open-Meteo archive mirror is used, no key needed |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | "Continue with Google" sign-in | button shows a friendly "not configured" error |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Real verification emails on sign-up | accounts auto-verify (dev/demo mode) |
| `VAPID_PUBLIC/PRIVATE_KEY` | Real web-push delivery | demo-safe simulation |
| `APP_TIMEZONE` | default `Africa/Nairobi` | same |
| `NEXT_PUBLIC_APP_URL` | canonical URL for sitemap/OG | `http://localhost:3000` |

> ⚠️ **Never commit real keys.** `.env` is gitignored; `.env.example` holds only placeholders. Rotate any credential that has been pasted outside secure storage.

---

## API Reference

Selected routes (all JSON unless noted; `POST` bodies are validated with zod):

| Route | Summary |
|---|---|
| `GET /api/situation` | Full pipeline output: state, current, forecast, quality, best-time, state-history, context, provenance (15 s server cache) |
| `GET /api/forecast` | Horizons + full series + uncertainty bands |
| `POST /api/farm` `{crop, stage}` | Irrigation action + depth (mm), water balance, spray/stress/planting |
| `GET /api/map` | County indicators + satellite acquisition metadata |
| `POST /api/ai/explain` `{lang, mode}`, `GET /api/ai/status` | Grounded bilingual explanation, `standard`/`plain`; provider readiness |
| `POST /api/recommendations` `{activity,duration_minutes,window_start,window_end}` | Deterministic best-time + reasons (never a model pick) |
| `POST /api/replay` `{date,activity,duration_minutes}` | Hourly deterministic replay frames for a historical day |
| `GET/POST /api/plans` · `POST /api/plans/:id/rerun|duplicate` | Saved activity plans |
| `GET/POST /api/notifications` · `POST /api/push/*` | Alert rules + web-push |
| `POST /api/auth/sign-up|sign-in|sign-out` · `GET /api/auth/me` | Cookie sessions |
| `GET /api/auth/google` · `GET /api/auth/google/callback` | Google OAuth 2.0 sign-in (authorization-code flow) |
| `POST /api/auth/verify-email` · `POST /api/auth/resend-verification` | Email verification (Resend), required before password sign-in works |
| `GET /api/climate-series` | Always-"now" climate variables panel (last 30h/7d/21d) for the Intelligence page |
| `GET /api/climate-history` | Climate History dashboard: arbitrary date range (up to 366 days), daily/hourly granularity, Conduit (JKUAT, CSV archive + live top-up) or ERA5-Land (any location) |
| `GET /api/context` | ERA5 + CHIRPS + Sentinel context bundle |

Pages: `/` `/situation` `/forecast` `/plan` `/farm` `/map` `/intelligence` `/climate` `/operations` `/replay` `/stories` `/briefing` `/notifications` `/profile` `/about` `/sign-in` `/sign-up` `/verify-email`.

---

## Database Schema

16 tables under `src/db/schema.ts`:

**Identity** · `users` (password *or* Google — `google_id`, `avatar_url`, `auth_provider`, `email_verified`/`email_verified_at`) · `email_verification_tokens` · `sessions` · `user_preferences`
**User assets** · `activity_plans` · `saved_activity_profiles` · `notification_rules` · `push_subscriptions`
**Environmental** · `conduit_observations` · `environmental_states` · `forecasts` · `activity_recommendations` · `data_quality_events` · `model_metadata` · `era5_context` · `chirps_context`

Password auth is scrypt-hashed; Google accounts carry no local password. Sessions are HttpOnly cookies. New password sign-ups must verify their email (Resend) before sign-in works — see [Environment Variables](#environment-variables). Apply schema with `npx drizzle-kit push`.

---

## Honesty & Limitations

AFYA MAZINGIRA is *decision support, not certainty*. Kept explicit in the product:

- Deterministic engines (forecast/state/farm) are **coefficient-form implementations** that preserve the required scientific interfaces — a production system would swap in the trained tree-ensemble/MLP artifacts (Conduit → model → registry) without changing a single page; the app accepts that swap cleanly.
- **Sentinel-3 LST values are `null`** when unavailable — acquisition *dates* are real, but the SLSTR thermal band is not faked. Sentinel-2 NDVI mean is best-effort via the Statistics API.
- **Push notifications** run demo-safe until VAPID keys are configured.
- **Historical Replay** frames are real deterministic engine runs. The Climate History dashboard (`/climate`) now backs this with genuinely real historical data too — a CSV archive of the live Conduit station plus live-API top-up for anything newer, chunked around the API's undocumented one-month-per-request limit — so a visitor checking in months from now still sees real, current data rather than a frozen snapshot; the `conduit_observations` table remains an optional path for a running live-ingestion cron job that hasn't been scheduled in this deployment.
- **County boundaries** are official polygons; indicator values shading them are real ERA5-Land/Sentinel readings for all 11 counties, with Conduit ground-station data additionally available for JKUAT/Kiambu (see the Ground+Regional vs. Regional-only badges on `/map` and `/situation`).
- **Not** a medical, disease, flood-prediction, crop-disease or yield tool — the About page states the non-goals explicitly.

---

## Roadmap

- Hosted model-artifact ingestion (ExtraTrees/CatBoost/MLP serialized from the offline training pipeline) into `model_metadata`
- PostGIS for spatial queries and true recorded-day replay
- Multi-station Conduit network support per the spec’s scaling story
- Scheduled (cron) `conduit_observations` ingestion + ERA5/CDS Python sidecar for the spec-prescribed NetCDF path, so Historical Replay's day-by-day state simulation can draw on a continuously-growing live table instead of only the CSV archive + on-demand live fetch
- Genuine CHIRPS point extraction: the current rainfall context uses real ERA5-Land precipitation (the same data already fetched for the temperature/humidity context) as an honest substitute — CHIRPS itself isn't a queryable API but a gridded product distributed as raw GeoTIFFs, so a real integration means fetching + raster-decoding those files (e.g. via `geotiff.js`, since GDAL isn't available in this serverless runtime) rather than a simple endpoint swap
- OG/Twitter share image & dark mode
- Full location picker backed by the bundled GADM Kenya shapefiles (47 counties / 300 sub-counties / 1,442 wards) — currently only the 11-county fixed list is selectable

---

## Contributing

PRs and issues are welcome. Please follow the existing bilingual pattern (`src/lib/afya/i18n.ts`) and keep the deterministic-before-LLM rule: **computed values must never pass through the generative layer**.

```bash
git clone https://github.com/<you>/afya-mazingira.git
cd afya-mazingira && npm install
cp .env.example .env   # fill DATABASE_URL
npx drizzle-kit push
npm run dev
```

---

## Hackathon Alignment

Built for **Hack The Weather** at JKUAT. Deliberately spans the themes rather than picking one: **Smart Agriculture** (farm water balance), **Water Intelligence** (irrigation optimisation, drought/dry-spell), **Early Warning & Climate Risk** (state transitions + exposure tiers, +9h forecast horizon), **Environmental Monitoring** (Climate Reflex states, real live Conduit ground-station data), **AI & ML** (grounded bilingual explanations across Gemini/Groq/OpenAI/Anthropic), **Data Visualization & Decision Intelligence** (charts, map, briefing, replay, and the Climate History dashboard's up-to-a-year date-range explorer), and **Community & Public-Facing applications** (plain-language Kiswahili mode, no jargon, Google sign-in).

> We are not another weather app. The Conduit station is the *truth*; everything else — states, forecasts, risk, best-window, farm advisory — is what that truth allows **every kind of user** to *decide and act on*.

---

## License & Disclaimer

MIT License. See [LICENSE](LICENSE).

> **AFYA MAZINGIRA provides environmental decision support. It does not provide medical diagnosis, emergency-response instructions, clinical advice, plant-disease diagnosis, crop-yield prediction or flood prediction.**

---

<div align="center">

**AFYA MAZINGIRA** · *From environmental data to early action* · JKUAT / Juja, Kenya · *Tumia data, uamue mapema.*

</div>