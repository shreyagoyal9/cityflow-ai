# CityFlow AI

### Smarter Departures, Smoother Journeys

CityFlow AI is a **proactive** traffic-management system.

Existing systems ask *“which road should this vehicle take?”*
CityFlow AI asks *“how do we prevent too many vehicles from entering the road
network at the same time?”*

Instead of rerouting people once congestion already exists, CityFlow AI predicts
travel demand ahead of time, learns how flexible each commuter is, and
distributes trips across nearby departure slots so the peak becomes less sharp
for everyone.

---

## 👉 New here? Start with the setup guide

**[docs/00-SETUP-STEP-BY-STEP.md](docs/00-SETUP-STEP-BY-STEP.md)** — click-by-click
instructions to run the project and deploy it online for free.

Other documentation:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the system is put together
- [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) — colours, theming, accessibility rules
- [docs/04-SUMO-EVALUATION.md](docs/04-SUMO-EVALUATION.md) — how to test the core claim with SUMO
- [docs/07-SAARTHI.md](docs/07-SAARTHI.md) — how the assistant works
- [docs/09-RESULTS.md](docs/09-RESULTS.md) — **the simulation result, with its limitations**
- [docs/10-PHASE-6.md](docs/10-PHASE-6.md) — **what Phase 6 added, and what it changed its mind about**
- [docs/11-DEMO-WALKTHROUGH.md](docs/11-DEMO-WALKTHROUGH.md) — **a ten-minute end-to-end demo, in order**
- [ml/README.md](ml/README.md) — the Python forecasting and optimisation service

---

## The three portals

CityFlow AI has three parts, deliberately kept apart, each with its own role:

| Portal | Route | Who it is for | What it can see |
|---|---|---|---|
| **Commuter** | `/dashboard` | Citizens | Only their own data |
| **Admin** | `/admin` | The CityFlow AI team | Aggregated city demand — never an individual |
| **Municipal** | `/municipal` | Council road staff | Road issues and the workforce — **no commuter data at all** |

The separation is enforced twice: at the edge in `proxy.ts` using the signed
session cookie, and again against the database inside every page and API route.
A municipal officer cannot reach a single person's travel routine anywhere in
the product, and nothing in the municipal code path is able to query one.

---

## Architecture

```
                    ┌──────────────────────────────┐
   Browser ───────► │  Next.js 16 (TypeScript)     │
                    │  3 portals, all API routes   │
                    │  Prisma ── PostgreSQL        │
                    └──────────┬───────────────────┘
                               │ HTTP, 2.5s timeout,
                               │ falls back silently
                    ┌──────────▼───────────────────┐
                    │  FastAPI (Python)            │
                    │  Prophet + XGBoost forecast  │
                    │  OR-Tools CP-SAT optimiser   │
                    │  NetworkX corridors          │
                    │  Redis cache (optional)      │
                    └──────────────────────────────┘
```

**Why two services.** Prophet, XGBoost and OR-Tools are Python libraries with
no usable JavaScript equivalent, and none of them run on Vercel's serverless
runtime. So the forecasting brain is a separate FastAPI service.

**Why the web app survives without it.** The ML service is optional. If it is
not configured, is asleep, or times out, the web application falls back to its
own TypeScript demand model and the Admin Portal says which one produced the
numbers on screen. Recommendations degrade in quality; they never disappear.
That is deliberate — a free-tier container that sleeps after 15 minutes should
not be able to take the product down during a demonstration.

---

## Current status

| Phase | Scope | Status |
|---|---|---|
| **1** | Foundation, design system, landing page, city selection, theming, authentication, anonymous CityFlow ID | ✅ |
| **2** | Travel-routine onboarding, demand model, recommendation engine, commuter dashboard, Leaflet map | ✅ |
| **3** | AI assistant, travel-intent recognition, confirmed plans, demand aggregation, city-wide re-optimisation | ✅ |
| **4** | Admin Portal, demand heatmap, reports, SUMO + OpenStreetMap evaluation | ✅ |
| **5** | Road-issue reporting, phone road-impact detection, participation, accessibility and security pass | ✅ |
| **6** | Python ML service, multiple journeys, one-off trip planning, rewards ledger, Municipal Dashboard, weather, email verification and password reset, per-city configuration, Docker Compose, CI | ✅ |

---

## Tech stack

| Layer | Technology |
|---|---|
| Web framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 with CSS-variable design tokens |
| Database | PostgreSQL (Neon free plan, or Postgres in Docker) |
| ORM | Prisma |
| Auth | bcrypt password hashing + JWT session in an httpOnly cookie |
| Forecasting | **Prophet** + **XGBoost** (FastAPI service) |
| Optimisation | **Google OR-Tools** CP-SAT multi-agent scheduling |
| Network modelling | **NetworkX** |
| Caching | Redis (optional — the service runs without it) |
| Maps | Leaflet + OpenStreetMap |
| Weather | Open-Meteo (free, no API key) |
| Simulation | SUMO + OpenStreetMap road network |
| Road sensing | Browser DeviceMotion + Geolocation — no app, no SDK |
| Email | Resend HTTP API (optional — logs to the terminal without it) |
| Containers | Docker Compose (web, ML, Postgres, Redis, Nginx) |
| CI | GitHub Actions — typecheck, Jest, production build, pytest |
| Hosting | Vercel (web) + any container host (ML) |

---

## Quick start

### Option A — the hosted route (what production uses)

```bash
cd web
npm install
cp .env.example .env     # fill in DATABASE_URL and AUTH_SECRET
npm run db:push
npm run dev
```

Open <http://localhost:3000>. The ML service is optional; without it the
built-in demand model is used and the app tells you so.

### Option B — the whole stack in Docker

```bash
docker compose up --build
```

Open <http://localhost:8080>. This brings up the web app, the Python ML
service, Postgres, Redis and Nginx with no accounts or API keys required.

> Requires **Node 22+** and, for the ML service, **Python 3.10+** (3.9 will not
> work — see [ml/README.md](ml/README.md)).

---

## Tests

```bash
cd web && npm test      # recommendation engine, trip planner, savings, workflow
cd ml   && pytest       # forecasting, and the smoothing claim itself
```

The ML suite is the one that matters most. It asserts the product's central
claim directly: that the optimiser **conserves total demand**, that **no slot
ends up busier than the original peak**, and that somebody who declared no
flexibility is **never moved**, however much better the objective would be.

---

## Principles this project holds to

1. Do not move congestion from one time to another — **smooth demand**.
2. Recommendations are **suggestions**, never instructions.
3. Predictions are **estimates**, never presented as certainties.
4. Every recommendation explains **why**.
5. Individual identity stays out of city-level analysis — an anonymous
   **CityFlow ID** carries travel behaviour instead.
6. The Municipal Dashboard has **no authority over traffic recommendations**
   and no access to commuter data.
7. A detected road impact is a **possible** issue until independent reports
   agree — and even then it is "confirmed by reports", never "verified". Only a
   named inspector who visited the site can verify a defect.
8. **No figure is shown without its provenance.** Where an estimate is
   displayed — time saved, fuel not burned — the method and the fact that
   nothing was measured appear beside it, in body text, not a tooltip.
9. The assistant only describes features that exist. When something is not
   built, it says so rather than sending somebody looking for it.

### One principle we changed our mind about

Phases 1–5 refused to show **any** "time saved" figure, on the grounds that no
real journey had been timed. That reasoning was sound, and the risk it guarded
against is real: a number like "8 minutes saved" outlives every caveat printed
next to it.

Phase 6 shows the figure anyway, because a commuter deciding whether to
reorganise their morning deserves to know the expected size of the prize, and
"demand index 74 versus 51" does not answer that for most people. The risk is
now **managed rather than avoided**: the figure is derived only from values the
system actually holds, floored rather than rounded so it never overstates,
suppressed entirely when it falls inside the model's own noise, and every
component that renders it is required to render the method with it. See
`web/src/lib/demand/savings.ts`, where the reasoning is written out in full.

---

## Does it work?

In simulation on an OpenStreetMap network of central Bhopal with 436 modelled
road trips, applying CityFlow AI's recommendations reduced the busiest
15-minute departure window from **52 to 39 vehicles (−25%)**, with departures
falling across the whole 08:00–09:45 peak and rising on the earlier shoulder.
**No new peak formed elsewhere** — which is the difference between smoothing
demand and relocating congestion.

Mean travel time was unchanged, as expected at a vehicle count well below
network capacity.

Full method, the reason only 25% of commuters could be moved, a parameter
sensitivity analysis and every limitation: **[docs/09-RESULTS.md](docs/09-RESULTS.md)**.

---

> An academic capstone project. CityFlow AI is not an official government service.
