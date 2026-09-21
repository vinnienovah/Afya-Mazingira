# Afya Mazingira

Heat and weather decisions for the JKUAT campus in Juja, Kenya, built on the Conduit@Empathy1 weather station.

Live at **[afya-mazingira.vercel.app](https://afya-mazingira.vercel.app)**. Built for Hack The Weather 2026 (JHUB Africa).

**In one example.** A site supervisor in Juja is planning tomorrow's concrete pour. The station's own record shows how much the season matters: from January to March 2026 about half of all working hours were in the HIGH heat band for outdoor work, against about 3 % in July and August 2025. Afya Mazingira reads the station every 15 minutes, forecasts WBGT for the next nine hours, and tells the supervisor which daylight hours carry the least heat risk for construction, in English or Kiswahili.

---

## 1. Project name

**Afya Mazingira**, Kiswahili for "health of the environment".

## 2. Problem statement

**Heat already costs Kenya a great deal of outdoor work.** Heat exposure cost Kenya 1.1 billion potential labour hours in 2024, 51 hours per person, and agriculture accounted for 74 % of the loss. People had 424 more hours of heat-stress risk for moderate outdoor activity than in 1990 to 1999 [1].

**Around Juja the work is outdoors.** Quarrying building stone is one of Juja's most significant economic activities, alongside construction and farming [2]. In a study of Kenyan farmers wearing sensors, outdoor WBGT peaked between 14:00 and 15:00 [3].

**The station's own record shows how much the season matters.** Between 07:00 and 18:00 at JKUAT, shade WBGT reached 21 °C or more, the HIGH band for outdoor work, in 47 to 51 % of hours from January to March 2026, against about 3 % in July and August 2025. For construction the share was about 70 % from January to April. A tool tuned on the cool months would miss the risk; the 15-month archive does not.

**Water is short and used inefficiently.** Kiambu's own climate risk assessment lists erratic rainfall and water scarcity among the county's hazards, reports yield losses from low soil moisture and late rains, and records inadequate irrigation capacity [4]. Where Kenyan smallholders irrigate, efficiency is low: 201 small-scale irrigators in the Lake Naivasha basin reached 31 % water-use efficiency [5], and farmer-led irrigation rarely gets information support [6].

**The information people get is too coarse to act on.** Kenya Met defines heatwaves per town, for example three or more days above 32 °C for Nairobi [7]. The Kenya Agricultural Observatory Platform sends ward-level forecasts and advisories to about 250,000 farmers a month in five counties [8]. None of this says, for one site and one activity, which hours today are risky and when the work should move.

Users we have evidence for: outdoor workers and farmers around Juja. Users we think would benefit but have not yet asked: JKUAT sports coaches, campus grounds and events teams, and construction site supervisors.

## 3. Solution

Afya Mazingira turns the station's readings into decisions, in English and Kiswahili:

- **What is happening:** the current environmental state (cool and humid, rapid warming, hot, cooling), learned from 15 months of the station's own record.
- **What comes next:** WBGT every 15 minutes out to nine hours, with an uncertainty band tested on months the model never saw.
- **What it means for you:** a risk band for the activity you choose (walking, sports, construction, field work, events) and the best daylight window to do it.
- **For farms:** irrigation depth, spraying and field-work windows, crop heat stress and a planting outlook from station temperature and ERA5-Land rainfall and soil moisture.
- **Around the region:** the same heat method applied to ten neighbouring counties from reanalysis, clearly marked as regional rather than measured.

Every number is computed in code. Language models only reword results the code has already produced, and a checker rejects any reply that states a temperature, time or risk band the code did not.

## 4. How Conduit@Empathy data is used

The station (Conduit@Empathy1, JKUAT, lat -1.0997, lon 37.0145, 1,523 m) is the core of every output.

**Where the data comes from.** Three routes to the same instrument, in order of preference:

1. **Live, two feeds.** JHUB's Conduit API (needs a key) and the public live feed of the CHORDS portal the station reports to (instrument 61, no key). Both are asked and the one with the more recent observation wins. On 21 September the Conduit API's latest reading was 17 hours old while CHORDS was 13 minutes old.
2. **The recorded archive,** `data/conduit_master_2025_2026.csv`: 45,043 rows every 15 minutes from 1 June 2025 to 8 September 2026.
3. A synthetic series only if neither covers the time asked for, always labelled DEMO.

**Cleaning.** Every source goes onto one 15-minute grid. Repeated timestamps are removed and counted. The station's missing-value code (-999.9) is treated as missing. Gaps up to 30 minutes are interpolated; longer ones are carried forward so the engines keep running, and every such value is marked as filled in. Data quality is GOOD, DEGRADED (over an hour old, or a critical reading filled in) or POOR (over three hours old), and POOR suppresses recommendations.

**Station health first.** Before any reading is used it passes the quality rules of the Conduit Sentinel specification, scaled to 15-minute data: plausible ranges, sudden jumps, readings stuck for hours, the three thermometers disagreeing, a sensor silent all day, the two rain gauges disagreeing, and the firmware's derived values. `npm run station-report` runs them over the whole archive; the **Station Health** page shows that report and the same checks on the last 24 hours. Over the 465 days on record:

- the station is healthy most of the time: a mean daily score of 98.8 out of 100, no day below 80, and only two gaps longer than an hour;
- the firmware WBGT is more than 1.5 °C below the wet bulb in 42.9 % of readings (62 % at night), so the app does not use it;
- rain gauge 2 recorded nothing on 53 days when gauge 1 measured rain, so rainfall totals come from ERA5-Land;
- the gust-direction column is a copy of the gust speed on every day;
- the firmware wet bulb agrees with Stull (2011) to 0.032 °C, so the app uses it.

These go on the page as findings to report to JHUB.

**WBGT from the station's own sensors.** The station's firmware WBGT column reads **below the wet bulb in 63.6 % of the archive**, which a real WBGT cannot do. We do not use it. WBGT here is the ISO 7243 form without solar load, 0.7 x wet bulb + 0.3 x air temperature, from the station's wet bulb (which agrees with Stull (2011) to 0.03 °C) and its air temperature. When the firmware value falls below the wet bulb, the Why? page says so.

**Environmental states.** k-means with four clusters on the archive's training months (June 2025 to March 2026), named by their centres:

| State | Mean air temperature | Humidity | Temperature change | Typical time |
|---|---|---|---|---|
| Cool and humid, stable | 16.4 °C | 84 % | -0.1 °C/h | 05:00 |
| Rapid warming | 23.0 °C | 60 % | +2.2 °C/h | 10:00 |
| Hot, high radiation | 27.0 °C | 45 % | +0.2 °C/h | 14:00 |
| Cooling, recovery | 20.9 °C | 64 % | -1.2 °C/h | 19:00 |

The "next state" shown on the page is the one that most often followed in the archive, with how often it did.

**Forecast.** One ridge regression for each 15-minute step ahead, from 25 features of the last hour of station data (temperature, humidity, pressure, wind, light, wet bulb, WBGT, their one-hour changes and means, and time of day and year). Fitted on June 2025 to March 2026, the 80 % band set from April and May 2026, and scored on June to September 2026, which the fit never saw:

| Lead time | Mean error | Assuming no change | 80 % band | Inside the band | Same risk band | Band too low |
|---|---|---|---|---|---|---|
| +1 h | 0.45 °C | 0.64 °C | ±0.74 °C | 81 % | 91.8 % | 4.3 % |
| +3 h | 0.79 °C | 1.64 °C | ±1.20 °C | 79 % | 86.2 % | 5.7 % |
| +6 h | 0.90 °C | 2.85 °C | ±1.31 °C | 76 % | 84.9 % | 7.5 % |
| +9 h | 0.98 °C | 3.56 °C | ±1.55 °C | 79 % | 85.2 % | 8.3 % |

The last two columns score what people act on: how often the forecast puts the hour in the same risk band as the station then measured, and how often in a lower one, the error that could leave someone unprepared.

**Tested month by month.** Those scores come from one cool season, so `npm run evaluate` also refits the forecast on everything before each month from October 2025 to September 2026 and scores that month alone:

| Season | +1 h | +3 h | +9 h | Assuming no change, +3 h | Same risk band, +3 h | Band too low, +3 h |
|---|---|---|---|---|---|---|
| Hot, January to March 2026 | 0.58 °C | 1.01 °C | 1.12 °C | 1.91 °C | 76.9 % | 17.1 % |
| All other months | 0.49 °C | 0.84 °C | 1.05 °C | 1.61 °C | 81.3 % | 7.8 % |

The forecast beats "no change" in every month at every horizon. In the hot season it is less accurate, and it puts the hour in too low a band about twice as often, running about 0.3 °C low in February and March. That is where the next round of work goes (see Known limitations).

`npm run fit` refits both models from the archive through the same cleaning and feature code the app runs.

**Farm advisory.** Station air temperature drives Hargreaves reference evapotranspiration and FAO-56 crop water demand, combined with ERA5-Land rainfall and soil moisture.

**Regional outlook.** Kiambu, where the station stands, uses the station pipeline. The other ten counties use ERA5-Land and Open-Meteo through the same shade WBGT (with Stull's wet bulb), labelled as regional.

## 5. Features

| Page | What it does |
|---|---|
| **Situation** | The current state, readings, data quality, the +1/+3/+6/+9 h forecast with each horizon's tested error, the best window for an activity, and the AI explanation |
| **Forecast** | Measured WBGT with the 15-minute forecast and its band, shaded by state |
| **Plan Activity** | Best-time search for an activity, duration and time window, with reasons, an alternative and saved plans |
| **Farm Advisory** | Irrigation depth in mm and litres per m², spray and field-work windows, crop heat stress and planting outlook for 7 crops and 4 growth stages |
| **Risk Map** | Leaflet on OpenStreetMap: 11 county boundaries with outlook, heat, rain and vegetation layers and a time slider; station-backed versus regional marked on each |
| **Dashboard** | Live climate variables, a climate history explorer over any date range, and historical replay: step through a past day with the future hidden, then reveal what the station recorded |
| **Station Health** | Sensor-group status for the last 24 hours, the daily health score since June 2025, firmware and thermometer audits, the rules, and findings to report to JHUB |
| **Why?** | Data quality flags, the state timeline, the fitted model table with test-month scores, and the regional context |
| **Operations** | A day's planned activities, each judged against the forecast with a cooler window suggested when there is one |
| **Flood Risk** | Current rainfall and soil saturation by county. Conditions only; not a flood forecast |
| **Notifications** | Threshold alerts by email (daily job) and web push |
| **Briefing** | A printable one-page summary, rendered on the server |

Also: sign-in with email and password or Google, email verification, saved plans, a ⌘K command palette, and an installable app that shows the last known situation offline.

## 6. Technology stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Charts and maps | Recharts, Leaflet with react-leaflet |
| Data | PostgreSQL with Drizzle ORM (Neon in production) |
| Models | Ridge regression and k-means, fitted in TypeScript by `scripts/fit-models.ts` |
| Language models | Gemini, then Groq, OpenAI and Anthropic, then written templates |
| Email and push | Resend, Web Push (VAPID) |
| Hosting | Vercel, with a daily Vercel Cron job for alerts |
| Checks | TypeScript, ESLint, Node's test runner via tsx, GitHub Actions |

## 7. Architecture

```
Conduit API  ---+
CHORDS live  ---+--> 15-minute grid --> data quality --> features --+--> state (k-means)
Archive CSV  ---+    (duplicates counted,                           |
                      gaps marked, shade WBGT)                      +--> forecast (ridge, per step)
                                                                            |
                                     risk band per activity <---------------+
                                     best-time window, farm advisory, alerts
                                                  |
ERA5-Land, Open-Meteo, Sentinel-2 ---> regional context and county map
                                                  |
                                     pages, briefing, email, push
                                     language model rewording, checked against the computed facts
```

Code: `src/lib/afya/` holds the engines (`sources`, `sentinel`, `data-quality`, `feature-engine`, `state-engine`, `forecast-engine`, `risk-engine`, `best-time-engine`, `farm-engine`, `explanation`), `src/lib/afya/model/` the fitted models, `src/app/` the pages and API routes, `scripts/` the model fit, the station report and the database seed, `tests/` the tests.

## 8. Installation and setup

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env
npm run dev
```

The app runs with an empty `.env`: station data comes from the public CHORDS feed, or the committed archive when offline. `.env.example` explains each variable. For sign-in, saved plans and alerts, set `DATABASE_URL` to a PostgreSQL database and create the tables:

```bash
npm run db:push
```

Deploying to Vercel: import the repository, add the Neon integration (it sets `DATABASE_URL`), add the variables from `.env.example` including `CRON_SECRET`, run `npm run db:push` once against the production database, and set `NEXT_PUBLIC_APP_URL` to the deployed address.

## 9. Usage

Open the app and start at **Situation**. Choose an activity to see its risk and best window; open **Why?** to see where each number comes from.

| Command | What it does |
|---|---|
| `npm run dev` | Development server on http://localhost:3000 |
| `npm test` | 32 tests, no network |
| `npm run typecheck` / `npm run lint` | Type check and lint |
| `npm run fit` | Refit the forecast and states from the archive |
| `npm run station-report` | Rerun the station health checks over the archive |
| `npm run build` | Production build |

Main API routes (JSON):

| Route | Returns |
|---|---|
| `GET /api/situation` | The whole pipeline output: readings, quality, state, forecast, risk, best time, context |
| `GET /api/forecast` | Forecast horizons and the 15-minute series with bands |
| `POST /api/recommendations` | Best window for `{activity, duration_minutes, window_start, window_end}` |
| `POST /api/farm` | Advisory for `{crop, stage}` |
| `POST /api/replay` | Hour-by-hour replay of a past day `{date}` |
| `GET /api/map` | County indicators and satellite acquisitions |
| `GET /api/station-health` | The archive health report and the same checks on the last 24 hours |
| `GET /api/climate-history` | Any date range, daily or hourly, station or ERA5-Land |

## 10. Data sources

| Source | Used for | Credit and terms |
|---|---|---|
| Conduit@Empathy1, via JHUB's Conduit API | Live station readings | JHUB Africa (JKUAT) and SPACE-SI. Access by API key |
| Conduit@Empathy1 on the UCAR 3D-PAWS FEWS NET CHORDS portal, instrument 61 | Live station readings | Public live feed. CHORDS: Daniels et al. (2014), doi:10.5065/d6v1236q |
| Conduit archive, `data/conduit_master_2025_2026.csv` | Model fitting, fallback, history, replay | Exported from the Conduit dashboard |
| ERA5-Land via the Open-Meteo archive API | Regional temperature, humidity, rainfall and soil moisture | Open-Meteo, CC BY 4.0. Contains modified Copernicus Climate Change Service information |
| Open-Meteo forecast API | Regional forecast when the station is silent, county map | Open-Meteo, CC BY 4.0 |
| Copernicus Sentinel-2, via the Copernicus Data Space | NDVI and acquisition dates | Contains modified Copernicus Sentinel data |
| County boundaries, `public/geo/counties.geojson` | Map | _Source to be added by the team_ |
| Landing page photographs | Decoration | Unsplash licence |

Methods: Stull (2011), *J. Appl. Meteor. Climatol.* 50, 2267-2269 (wet bulb); ISO 7243 (WBGT); Hargreaves and Samani (1985) and FAO-56, Allen et al. (1998) (crop water).

## 11. AI usage

The AI tool used in this project is Anthropic's Claude: Claude Code, and Claude in Cowork during planning. It was used for debugging and explaining code errors, for writing code, tests and documentation, and for research and data analysis. The team reviewed and ran every change and can explain each part of the solution.

## 12. Screenshots / demo

Demo video: _link to be added_

![Situation](docs/screenshots/situation.png)

![Why? page with the fitted model table](docs/screenshots/why.png)

![Station Health](docs/screenshots/station-health.png)

![Risk Map on OpenStreetMap](docs/screenshots/risk-map.png)

![Operations](docs/screenshots/operations.png)

## 13. Team members

| Member | Role |
|---|---|
| **Vincent Kongo** ([@vinnienovah](https://github.com/vinnienovah)) | Data scientist and environmental specialist |
| **Phillip Muchemi** | Data scientist and GIS specialist |
| **George Kamundia** ([@GKamundia](https://github.com/GKamundia)) | Computer scientist, machine learning and AI specialist |

Between them the team covers the environmental science behind the heat and farm advice, the GIS behind the regional map and county boundaries, and the machine learning behind the forecast, the environmental states and the station health checks.

## 14. Future development

- **Add the sun to WBGT.** Calibrate the station's light sensor to irradiance so direct-sun WBGT can be computed, not only shade WBGT.
- **More stations.** The CHORDS portal lists 75 3D-PAWS instruments in Kenya. The live feed address is a setting, and `npm run fit` refits from any station's archive in the same format.
- **Refit monthly** as the archive grows, and publish the scores each time.
- **Reach people without a smartphone.** Send the daily best window and heat alerts by SMS and WhatsApp. The first partner to approach is the Kiambu county agricultural extension service, which already advises farmers around Juja.
- **CHIRPS rainfall** by point extraction from its gridded files, in place of ERA5-Land.
- **Partners:** JHUB Africa for station access, Kiambu county agriculture officers for the farm advisory, and the JKUAT sports and estates departments as first users.

## 15. Licence

MIT. See [LICENSE](LICENSE). Station and reanalysis data remain under their providers' terms (section 10).

---

## Known limitations

- **WBGT is shade WBGT.** It leaves out direct sun because the station's light sensor is not calibrated to irradiance. In full midday sun WBGT is several degrees higher, so the bands understate risk for work in the open.
- **The risk bands are our own.** 18, 21 and 24 °C WBGT and the activity adjustments are screening bands chosen by the project, not a published occupational or medical limit.
- **The forecast under-warns more in the hot season.** Tested month by month, it put the hour in too low a risk band 17.1 % of the time from January to March 2026, against 7.8 % in other months. Treat hot-season forecasts near a band boundary as the higher band.
- **Rain probability is a rule of thumb** (falling pressure and high humidity raise it), not fitted: the station's rain gauges are too sparse to fit it on.
- **Rainfall context is ERA5-Land,** not CHIRPS.
- **When ERA5-Land or the satellite catalogue cannot be reached** (and in historical replay, which does not fetch past context), their panels show "-" instead of numbers and data quality carries a `regional_context_unavailable` flag. No stand-in values are shown as data.
- **The flood page shows conditions,** rainfall and soil saturation, not a flood forecast.
- **The Conduit API can lag by most of a day;** the CHORDS feed covers for it, but carries no rain readings, so live rain is only seen when the Conduit API is current. Rainfall totals always come from ERA5-Land.
- **Rate limits are per server instance,** so they are weak on a serverless host.
- **The Kiswahili text** should be checked by a fluent speaker before wider use.

## Reproducibility

- `npm test` runs every test without network access.
- `npm run fit` rebuilds `src/lib/afya/model/wbgt-forecast.json` and `states.json` from the archive, and `npm run station-report` rebuilds `station-health.json`. The split is fixed by date and the clustering is seeded, so a refit on the same archive gives the same models.

## Build timeline

The repository starts on 18 September 2026 with the first version of the app in one commit. Everything since, through 21 September, is in the commit history.

## Sources

1. Lancet Countdown on Health and Climate Change (2025). *Health and climate change in Kenya: Data sheet 2025.* https://lancetcountdown.org/wp-content/uploads/2025/10/Kenya_Lancet-Countdown_2025_Data-Sheet-1.pdf
2. County Government of Kiambu (2023). *Juja Municipality Integrated Development Plan 2023-2028*, sections 3.3 and 4.0. https://kiambu.go.ke/wp-content/uploads/2024/12/Juja-Municipality-IDEP-Final.pdf
3. Kwaro, D. et al. (2025). Acceptability and feasibility of research grade wearables for monitoring heat stress in Kenyan farmers. *npj Digital Medicine.* https://pmc.ncbi.nlm.nih.gov/articles/PMC12059195/
4. County Government of Kiambu (2023). *Kiambu County Participatory Climate Risk Assessment.* https://maarifa.cog.go.ke/sites/default/files/2024-06/PCRA%20Improved%20Version_Kiambu_06.10.2023.pdf
5. Njiraini, G. W. and Guthiga, P. M. (2013). Are small-scale irrigators water use efficient? Evidence from Lake Naivasha basin, Kenya. *Environmental Management.* https://link.springer.com/article/10.1007/s00267-013-0146-1
6. Mati, B. M. (2023). Farmer-led irrigation development in Kenya. *Agricultural Water Management.* https://www.sciencedirect.com/science/article/pii/S0378377422006527
7. Capital FM (2 February 2026). "Kenya MET explains heatwave limits as high temperatures persist across the country." https://allafrica.com/stories/202602020114.html
8. AICCRA (June 2023). "Kenyan agriculture data platform gets upgrade." https://aiccra.cgiar.org/news/kenyan-agriculture-data-platform-gets-upgrade
