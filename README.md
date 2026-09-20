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

Status: **production-ready working prototype** — 16 pages, 25 API routes, 13 database tables, live data, live AI, installable PWA.

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
| **/map** | **Leaflet** regional outlook — official Kenya county boundaries, 5 layers (outlook/thermal/rain/vegetation/LST), time animation, county drill-down, station pulse marker |
| **/intelligence** | Model contributors, data-quality log, WBGT method, Climate Reflex frames |
| **/operations** | Institution command centre: alerts, affected activities, operational windows |
| **/replay** | Historical Replay — hide the future, step through a day, then **reveal** and audit the guidance |
| **/stories** | Case studies: farmer / coach / site supervisor / ops lead — each expressed as Data → Insight → Decision → Impact |
| **/briefing** | Server-rendered printable one-pager (state, metrics, best window, forecast table, state strip, provenance, disclaimer) |
| **/notifications** | Web-push + in-app environmental alerts with rule builder |
| **/profile, /about** | Account, preferences, provenance, methodology, non-goals |

**Plus:** ⌘K command palette · auth (sign up/in) · installable PWA with offline "last-known situation" · robots.txt + sitemap.xml.

---

## Architecture

```
                            ┌──────────────────────┐
                            │      USER (EN / SW)   │
                            └─────────┬─────────────┘
                                      │  PWA · Landing · 16 routes
        ┌─────────────────────────────┼─────────────────────────────┐
        │                     Next.js 16 · App Router                │
        │  ┌───────────────── 25 API routes ──────────────────┐     │
        │  │ situation · forecast · farm · map · ai/explain ·  │     │
        │  │ recommendations · plans · notifications · auth    │     │
        │  └───────────────────────┬───────────────────────────┘     │
        │                          │                                 │
        │  ┌───────────────────── DETERMINISTIC ENGINES (lib/afya) ─┐│
        │  │ sources.ts        live Conduit + demo synthesis        ││
        │  │ data-quality.ts   GOOD / DEGRADED / POOR               ││
        │  │ feature-engine.ts 15-min lags, deltas, rolling, cyclic  ││
        │  │ state-engine.ts   Climate Reflex state classifier       ││
        │  │ forecast-engine.ts +1h/+3h/+6h + conformal uncertainty  ││
        │  │ risk-engine.ts    activity-aware WBGT tiers             ││
        │  │ best-time-engine.ts lexicographic sliding window         ││
        │  │ farm-engine.ts    Hargreaves ET₀ · FAO-56 Kc · water    ││
        │  │                   balance · spray · stress · planting   ││
        │  │ explanation.ts    grounded LLM + deterministic fallback ││
        │  └──────────────────────────────────────────────────────┘ │
        │                          │                                 │
        │           Gemini → OpenAI → deterministic EN/SW templates   │
        └──────────────────────────┼─────────────────────────────────┘
                                   │
        ┌──────────────┬───────────┼───────────┬───────────────┐
   PostgreSQL      Copernicus    Open-Meteo   JHU     Kenya county
   (13 tables)     CDSE Catalog  ERA5-Land    Africa  GeoJSON
   users/plans/    Sentinel-2/3  (archive     Conduit  (public, 50 KB)
   sessions/rules  real dates    mirror)      POST
        └────────────────────────────────────────────────┘
```

---

## Data Sources & Provenance

| Source | Class | Cadence | Used for |
|---|---|---|---|
| **JKUAT Conduit** (jhuubafrica.com) | `MEASURED` | 15 min | Temperature, RH, pressure, wind speed/dir, solar IR, rain, WBGT-like |
| **ERA5-Land** (via archive mirror) | `REGIONAL MODEL` | ~5-day latency | Soil moisture, dewpoint, solar WM², local-regional anomaly |
| **CHIRPS** (v2 final) | `HISTORICAL CLIMATE` | daily | 7 d / 30 d rainfall, percentile, dry-spell |
| **Sentinel-2 / 3** (CDSE Catalog) | `SATELLITE-DERIVED` | per pass | Real acquisition dates + NDVI stats (best-effort) |
| **Kenya county boundaries** | `BOUNDARY` | static | Official administrative polygons, 11 counties, Douglas-Peucker simplified (50 KB) |

Every value on screen carries a provenance class badge — nothing is silently merged.

### Live-Conduit ingestion (spec-accurate cleaning)

- POSTs to `data.php` with `apikey / email / fromdate / todate`
- `-999.9` sentinels removed; `wind_gust_dir` excluded (broken by design)
- exact **15-minute mean-bucket grid**, dedupe keep-last, UTC anchored
- **limited 2-slot interpolation for continuous fields only** — rain channels are *never* interpolated
- `todate` is treated as **inclusive of today + 1 day** (the station batch-publishes overnight)
- **Auto-degrades to demo-synthesis** when credentials are absent or the station is unreachable — the `DemoObservation[]` contract is identical either way.

---

## The AI Communication Layer

A generative layer that translates validated results into natural language — **strictly downstream** of the science.

```
SituationResult JSON ──▶ buildExplanationFacts()
                            │ provider chain (in order)
                            ▼
                      1. Gemini  (structured JSON output)
                      2. OpenAI  (Responses API · json_schema strict)
                      3. Anthropic (legacy)
                      4. Deterministic reviewed templates
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
| UI | React 19 · TypeScript · Tailwind 4 · shadcn-style tokens |
| Database | PostgreSQL via **Drizzle ORM** (13 tables) |
| Data/Viz | SWR · Recharts · **Leaflet + react-leaflet** |
| AI providers | Gemini (primary) · OpenAI (fallback) · deterministic |
| Auth | Cookie + session in Postgres · scrypt hashing |
| PWA | manifest + service worker · web-push |
| Quality | zod · lucide-react · framer-motion · sonner |

---

## Project Structure

```
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
│   │   │   ├── intelligence/page.tsx
│   │   │   ├── operations/page.tsx
│   │   │   ├── replay/page.tsx
│   │   │   ├── stories/page.tsx
│   │   │   ├── notifications/page.tsx
│   │   │   ├── profile|about/page.tsx
│   │   │   └── (auth)/ sign-in | sign-up
│   │   ├── api/                          # 25 routes (see API Reference)
│   │   └── robots.ts · sitemap.ts
│   ├── components/
│   │   ├── ai/AiPanel.tsx                # bilingual AI chat (standard/plain)
│   │   ├── charts/ (ForecastChart · StateTimeline)
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
│   │   └── schema.ts                     # 13 tables
│   └── lib/afya/
│       ├── sources.ts                    # live Conduit + demo synthesis
│       ├── data-quality.ts · feature-engine.ts
│       ├── state-engine.ts · forecast-engine.ts
│       ├── risk-engine.ts · best-time-engine.ts
│       ├── farm-engine.ts · explanation.ts
│       ├── i18n.ts · format.ts · constants.ts · types.ts
│       └── map-data.ts (+ county indicator fixtures)
├── public/
│   ├── geo/counties.geojson              # official boundaries, simplified
│   ├── icons/ · manifest.json · sw.js · landing images
├── scripts/seed.ts                       # one-shot demo-seed for new DB
├── drizzle.config.json
├── .env.example
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js 18.18+** (or 20)
- **PostgreSQL 14+** (local, Docker, or Neon/Railway/etc.)

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

> 💡 **You can run the entire app in demo mode with a *blank* `.env`** — a realistic Conduit-shaped synthetic series and all engines will work. Add keys only for live data and live AI.

### 3. Provision the database

```bash
npm run dev &                       # or have Postgres already running
npx drizzle-kit push                # create all 13 tables
```

### 4. (Optional) seed a fresh database

```bash
npx tsx scripts/seed.ts
```

### 5. Run

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
| `DATABASE_URL` | PostgreSQL (required) | — |
| `CONDUIT_URL` | station endpoint (default from spec) | same |
| `CONDUIT_API_KEY` + `CONDUIT_EMAIL` | **Live station data** | Conduit-shaped demo series |
| `GEMINI_API_KEY` | Primary grounded AI explanations | — |
| `OPENAI_API_KEY` | Second AI provider | skip to deterministic |
| `LLM_API_KEY` | Legacy Anthropic provider | skip |
| `COPERNICUS_CLIENT_ID/SECRET` | Real Sentinel catalog dates | fixture dates |
| `CDS_URL` + `CDS_API_KEY` | CDS key for ERA5 Python-sidecar path (spec) | archive mirror is used |
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
| `GET /api/context` | ERA5 + CHIRPS + Sentinel context bundle |

Pages: `/` `/situation` `/forecast` `/plan` `/farm` `/map` `/intelligence` `/operations` `/replay` `/stories` `/briefing` `/notifications` `/profile` `/about` `/sign-in` `/sign-up`.

---

## Database Schema

13 tables under `src/db/schema.ts`:

**Identity** · `users` · `sessions` · `user_preferences`
**User assets** · `activity_plans` · `saved_activity_profiles` · `notification_rules` · `push_subscriptions`
**Environmental** · `conduit_observations` · `environmental_states` · `forecasts` · `activity_recommendations` · `data_quality_events` · `model_metadata` · `era5_context` · `chirps_context`

Auth is scrypt-hashed; sessions are HttpOnly cookies. Apply schema with `npx drizzle-kit push`.

---

## Honesty & Limitations

AFYA MAZINGIRA is *decision support, not certainty*. Kept explicit in the product:

- Deterministic engines (forecast/state/farm) are **coefficient-form implementations** that preserve the required scientific interfaces — a production system would swap in the trained tree-ensemble/MLP artifacts (Conduit → model → registry) without changing a single page; the app accepts that swap cleanly.
- **Sentinel-3 LST values are `null`** when unavailable — acquisition *dates* are real, but the SLSTR thermal band is not faked. Sentinel-2 NDVI mean is best-effort via the Statistics API.
- **Push notifications** run demo-safe until VAPID keys are configured.
- **Historical Replay** frames are real deterministic engine runs; the pipeline history is *synthesised* unless the `conduit_observations` table has been populated by a running live ingestion.
- **County boundaries** are official polygons; indicator values shading them are currently fixtures wired to the same provenance-labelled contract as the rest of the app.
- **Not** a medical, disease, flood-prediction, crop-disease or yield tool — the About page states the non-goals explicitly.

---

## Roadmap

- Hosted model-artifact ingestion (ExtraTrees/CatBoost/MLP serialized from the offline training pipeline) into `model_metadata`
- PostGIS for spatial queries and true recorded-day replay
- Multi-station Conduit network support per the spec’s scaling story
- Scheduled (cron) observation ingestion + ERA5/CDS Python sidecar for the spec-prescribed NetCDF path
- OG/Twitter share image & dark mode

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

Built for **Hack The Weather** at JKUAT. Deliberately spans the themes rather than picking one: **Smart Agriculture** (farm water balance), **Water Intelligence** (irrigation optimisation, drought/dry-spell), **Early Warning & Climate Risk** (state transitions + exposure tiers), **Environmental Monitoring** (Climate Reflex states), **AI & ML** (grounded bilingual explanations), **Data Visualization & Decision Intelligence** (charts, map, briefing, replay), and **Community & Public-Facing applications** (plain-language Kiswahili mode, no jargon).

> We are not another weather app. The Conduit station is the *truth*; everything else — states, forecasts, risk, best-window, farm advisory — is what that truth allows **every kind of user** to *decide and act on*.

---

## License & Disclaimer

MIT License. See [LICENSE](LICENSE).

> **AFYA MAZINGIRA provides environmental decision support. It does not provide medical diagnosis, emergency-response instructions, clinical advice, plant-disease diagnosis, crop-yield prediction or flood prediction.**

---

<div align="center">

**AFYA MAZINGIRA** · *From environmental data to early action* · JKUAT / Juja, Kenya · *Tumia data, uamue mapema.*

</div>