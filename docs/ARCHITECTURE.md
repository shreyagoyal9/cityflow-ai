# CityFlow AI — Architecture

> Status: **Phases 1–6 complete.** Everything described below is implemented.
>
> Phase 6 added a Python ML service, multiple journeys per person, one-off trip
> planning, a rewards ledger, the Municipal Dashboard as a third in-repository
> portal, and per-city configuration. It also reversed two earlier decisions.
> **See [10-PHASE-6.md](10-PHASE-6.md) for what changed and why** — this
> document has been updated for the new portal layout but the Phase 6 document
> is the authority on the reasoning.

---

## 1. The three portals

CityFlow AI has three separate parts. They are deliberately **not** merged.

| Portal | Who uses it | Where it lives |
|---|---|---|
| **User / Commuter Portal** | Citizens | This repository, routes `/`, `/dashboard`, `/profile` |
| **Admin Portal** | The CityFlow AI project team today; possibly a government authority in future | This repository, routes under `/admin` |
| **Municipal Dashboard** | Municipal road-maintenance staff | This repository, routes under `/municipal` *(moved in-house in Phase 6)* |

### What the Municipal Dashboard may and may not do

It is responsible for: receiving reported road problems → inspection →
verification → work assignment → repair → sign-off. The workflow is a state
machine (`web/src/lib/municipal/workflow.ts`) that makes the dishonest
sequences unreachable: an issue cannot be assigned before an inspector verifies
it, or completed before work has started, and every transition writes an audit
row naming the officer.

It has **no authority** over user schedules, departure recommendations, traffic
optimisation, demand forecasting, the recommendation engine, or the Admin Portal.

It also **cannot see any commuter data at all** — not a routine, not a
departure, not who reported a pothole. That is enforced twice: `proxy.ts` gates
the route on the `MUNICIPAL` role at the edge, `lib/auth/municipal.ts` re-checks
against the database inside every page and API route, and no query in
`lib/municipal/` touches a commuter table.

### A fourth service, not a fourth portal

The **ML service** (`ml/`, FastAPI) is not a portal and has no interface. It
holds no database, no sessions and no personal data: a commuter reaches it as an
opaque `ref` string. It exists because Prophet, XGBoost and OR-Tools are Python
libraries that cannot run on Vercel's serverless runtime. The web application
falls back to its own TypeScript demand model whenever the service is absent or
slow, and says on screen which one produced the numbers.

---

## 2. Technology choices (all free tiers)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, TypeScript) | Frontend and backend in one deployable unit |
| Styling | **Tailwind CSS v4** with CSS-variable design tokens | Light/dark theming without duplicating styles |
| Database | **PostgreSQL on Neon** (free tier) | Free plan does not expire and does not pause the project |
| ORM | **Prisma** | Type-safe queries; schema is the single source of truth |
| Auth | Email + password, **bcryptjs** hashing, **jose** JWT in an httpOnly cookie | No paid identity provider needed |
| Hosting | **Vercel** Hobby plan | Free, deploys straight from GitHub |
| Maps *(Phase 2)* | **Leaflet + OpenStreetMap tiles** | No API key, no billing |
| Simulation *(Phase 4)* | **SUMO** + OpenStreetMap road network | Open source, runs offline |
| Road sensing *(Phase 5)* | Browser **DeviceMotion** + **Geolocation** APIs | Works on any modern phone with no app, no SDK and no cost |

---

## 3. Folder layout

```
cityflow-ai/
├── docs/                     Documentation (setup, architecture, design system)
└── web/                      The Next.js application
    ├── prisma/
    │   └── schema.prisma     Database tables
    └── src/
        ├── app/              Pages and API routes (Next.js App Router)
        │   ├── api/          Backend endpoints
        │   ├── layout.tsx    Shared shell: fonts, theme, city context, header, footer
        │   └── page.tsx      Landing page
        ├── components/
        │   ├── auth/         Sign-up / log-in forms, CityFlow ID card
        │   ├── brand/        Logo
        │   ├── city/         City context, selector, skyline artwork, backdrop
        │   ├── admin/        Admin Portal chrome, panels, heatmap, simulation form
        │   ├── chat/         The assistant panel and its confirmation card
        │   ├── dashboard/    Recommendation card, peak strip, status cards, history
        │   ├── landing/      Landing-page sections
        │   ├── layout/       Header and footer
        │   ├── map/          Leaflet map + search, loaded browser-side only
        │   ├── onboarding/   The four-step travel-routine wizard
        │   ├── roads/        Road-issue form, photo resizing, phone impact detector
        │   ├── profile/      Profile editor (reuses the onboarding steps)
        │   ├── theme/        Light/dark theme provider and toggle
        │   └── ui/           Reusable primitives (Button, Card, Badge, TextField…)
        ├── lib/
        │   ├── admin/        Aggregated analytics + SUMO demand export
        │   ├── roads/        Road issues: merging, evidence, priority, hand-off
        │   ├── auth/         Password hashing, JWT, session, CityFlow ID generation, admin guard
        │   ├── chat/         Time parsing, intent recognition, assistant replies,
        │   │                 and app-guide.ts — what Saarthi knows about the app
        │   ├── demand/       Time slots, baseline model, aggregation, engine, optimiser, zones
        │   ├── app-time.ts   "Today" and "now" in the application timezone (IST)
        │   ├── cities.ts     Supported cities (single source of truth)
        │   ├── db.ts         Prisma client
        │   ├── env.ts        Environment variable access
        │   ├── intent-service.ts          Stores a confirmed plan, then re-optimises
        │   ├── recommendation-service.ts  Ties the engine to the database
        │   ├── participation.ts  What one person has actually contributed
        │   ├── rate-limit.ts     In-memory ceiling for citizen-content endpoints
        │   ├── travel.ts     Transport modes and destination types
        │   └── validation.ts Zod schemas shared by client and server
        └── proxy.ts          Route protection (runs before pages render;
                               called middleware.ts before Next.js 16)
```

**Rule followed throughout:** UI components never talk to the database. They call
an API route, which uses `lib/` helpers, which use Prisma.

---

## 4. Request flow

### Signing up

```
Browser (signup form)
  → validate with Zod on the client
  → POST /api/auth/signup
      → validate with the SAME Zod schema on the server
      → reject duplicate email
      → hash password (bcrypt, 10 rounds)
      → generate a unique anonymous CityFlow ID  (CF-XXXXXXX)
      → insert row in "users"
      → sign a JWT and set an httpOnly cookie
  → redirect to /welcome  (shows the CityFlow ID + privacy explanation)
```

### Opening a protected page

```
Browser → /dashboard
  → proxy.ts verifies the cookie signature (no database call)
      → invalid?  redirect to /login?next=/dashboard
      → valid?    continue
  → page loads the full user record with Prisma (Node runtime)
```

**Why the split:** every request passes through the proxy, so it must stay fast.
It only verifies the cookie signature; the database is read later, in the page.

---

## 4b. How a recommendation is produced

```
profile (usual departure, required arrival, journey time, flexibility)
        +
demand model  →  predicted demand index 0-100 per 15-minute slot
        ↓
only slots the person AGREED to (earlier / later / neither)
        ↓
discard any slot whose estimated arrival misses the required arrival
        ↓
pick the lowest-demand slot; tie-break towards the usual time
        ↓
is it at least 8 index points better?  no → recommend keeping the usual time
        ↓
store it (with its reason) + explain it on screen
```

**The demand model is a modelled baseline, not measured traffic.** It reproduces
the shape urban demand reliably takes — an overnight floor, a sharp morning
peak, a midday bump, a broader evening peak, a flatter weekend — scaled per
city and varied per day by a deterministic wobble. `predictDemandIndex()` in
`lib/demand/demand-model.ts` is the single seam where real aggregated demand
replaces it in Phase 3; no screen has to change.

---

## 4c. Demand smoothing — how the peak is not simply moved

This is the mechanism the whole project exists for.

```
person confirms a plan in the assistant
        ↓
POST /api/intent/confirm          ← the ONLY endpoint that writes travel data
        ↓
travel_intentions row (structured; the chat text is never stored)
        ↓
demand_slot_aggregates: one trip moves from its old slot to its new slot
        ↓
adjusted(slot) = baseline(slot)
               + confirmed trips in slot × TRIP_WEIGHT
               + any active network event
        ↓
reoptimiseCity(): recompute EVERY pending recommendation, in a stable order,
                  adding each person's new slot to the curve BEFORE the next
                  person is considered
        ↓
anyone whose time moved gets updatedByOptimiser + updateReason
        ↓
dashboard shows "Your recommendation has been updated", and why
```

**Why this cannot stack everyone on one slot.** The demand value the engine
reads already contains everybody else's confirmed departures. The moment people
start moving to 8:45, 8:45's index rises — for the next person to ask, and for
the re-optimisation pass. The sequential pass in `optimizer.ts` is what turns
"everyone is told 8:45" into 8:30 / 8:45 / 9:00.

**What the optimiser will not do.** It never moves someone who has already
committed; it never rewrites a stored travel intention; it never breaks a
person's required arrival or their stated flexibility direction. It changes what
is *recommended*, tells them it changed, and leaves the decision with them.

**Determinism.** Users are processed ordered by id, so the same data always
produces the same result. That is what makes the outcome explainable rather
than a lottery.

**Where it runs.** Inline after each confirmation — a few dozen rows at this
scale. In a real deployment this belongs on a queue.

---

## 4d. The Admin Portal's privacy boundary

The boundary is **structural, not procedural**. Every function in
`lib/admin/analytics.ts` returns counts and averages; none of them selects a
user id, a CityFlow ID, an email or a home area. The portal cannot display an
individual, rather than merely choosing not to.

Two further rules hold everywhere in the portal and in every CSV export:

- A person who switched off *"count my trip in city-level demand totals"* during
  onboarding is excluded from every figure. `shareAggregatedDemand: true`
  appears in each query for that reason.
- Zone demand is built from real registered routines — a confirmed plan where
  one exists, otherwise that person's usual departure on a day they said they
  travel. Nothing is invented, and the UI states which is which.

**Access control has two layers.** `proxy.ts` blocks `/admin` at the edge using
the role in the signed cookie; `lib/auth/admin.ts` re-checks against the
database inside every page and API route. The second is not redundant: a cookie
is a snapshot, and rights can be revoked after it was issued. The consequence in
the other direction is that a newly promoted admin must sign in again.

---

## 4e. Simulation evaluation (SUMO + OpenStreetMap)

The application produces demand files and stores results. **It does not run
SUMO** — SUMO is a desktop simulator, and a web app claiming to have run one
would be fabricating the project's key evidence.

```
Admin Portal  ──exports──▶  baseline.trips.xml   (everyone at their usual time)
                            cityflow.trips.xml   (everyone at the recommended time)
                            tazs.add.xml         (zone template, edges left blank)
                                   │
                     netconvert / duarouter / sumo   ← on a workstation
                                   │
Admin Portal  ◀──recorded──  metrics typed back in, compared side by side
```

Same travellers, same origins and destinations, same trip count. **The only
difference between the two files is departure time**, which is what makes any
difference in the results attributable to demand smoothing.

Full pipeline, including where each metric comes from in SUMO's output:
[docs/04-SUMO-EVALUATION.md](04-SUMO-EVALUATION.md).

---

## 4f. Road-condition intelligence, and where its authority stops

```
citizen report  ──┐
                  ├──▶ merge by ~50 m grid cell + issue type
phone jolt      ──┘         (lib/roads/cell.ts)
                                   │
                       weigh the evidence          human report = 1
                       (lib/roads/confidence.ts)   phone jolt    = 0.5
                                   │
                   POSSIBLE → LIKELY → CONFIRMED_BY_REPORTS
                                   │
                       score the priority
                       (lib/roads/priority.ts)
                       0.3 evidence + 0.4 severity + 0.3 exposure
                                   │
                   Admin Portal → Download hand-off file (JSON)
                                   │
                     ══════════ SYSTEM BOUNDARY ══════════
                                   │
                       Municipal Dashboard: inspect → repair → status
```

**What CityFlow AI contributes that a complaints inbox cannot.** It knows how
many trips pass through each area, so it can distinguish two identical potholes
— one affecting four hundred people a morning, one affecting twelve. That is
the `exposure` term, and it is the only justification for a traffic-demand
system having an opinion about road repairs at all.

**Three deliberate design decisions.**

- *Severity is the maximum anybody reported, not the average.* Nine people
  calling a pothole minor does not cancel one person whose wheel it broke.
  Under-stating a hazard is the worse failure.
- *A phone detection is worth half a human report.* An accelerometer cannot tell
  a pothole from a speed breaker. Someone who stopped and chose a category has
  actually looked at it.
- *One person can raise an issue's evidence exactly once.* Enforced by a unique
  constraint on `(roadIssueId, userId)`, not by application logic that could be
  bypassed by a retry.

**What is deliberately absent.** There is no inspect action, no assign, no
repair status, no due date, no crew — anywhere in this codebase. The only status
kept is `handedOverAt`, which means *"this appeared in a file we gave them"* and
nothing more. CityFlow AI is never told whether anything was fixed, so it must
never display a repair status. See
[docs/06-MUNICIPAL-HANDOFF.md](06-MUNICIPAL-HANDOFF.md).

---

## 4g. What "participation" is allowed to claim

`/participation` shows only figures the system genuinely observed: days with a
plan, plans confirmed, how far departures moved, road reports made.

There is no "time saved", no "CO₂ avoided", no "you helped N commuters".
CityFlow AI does not measure anybody's real journey — the demand figures are
model output — so every one of those would be invented. Rewards are listed as
**possible future benefits** with a plain statement that none exists and nothing
is being earned, because fake points would be worse than no points.

---

## 4h. Saarthi, and the two questions a commuter actually asks

Saarthi answers two different kinds of thing, and they are parsed by the same
rule-based pipeline:

```
"I want to leave at 6 PM today"      →  a TRAVEL INTENT      →  a proposal card
"Where do I report a pothole?"       →  an APP QUESTION      →  an answer + a link
```

**Why the second one exists.** Before it, every "where is…", "how do I…" and
"who can see my data" fell through to the parser's UNKNOWN branch and was
answered with a list of travel sentences. That is a bad answer: the person asked
something reasonable and the product does have an answer. An assistant that
cannot explain the thing it is embedded in is not a guide, and *saarthi* means
guide.

**How the two are told apart** — `lib/chat/intent-parser.ts`, in this order:

1. greeting, small talk, `help`
2. `ASK_RECOMMENDATION` — "when should I leave?" is unambiguous and deserves the
   real answer rather than a page link
3. **`ASK_APP_HELP`**, but only when all three hold:
   - the sentence is SHAPED as a question about the product ("how do I…",
     "where is…", "what is…"), not as an instruction;
   - a topic in `lib/chat/app-guide.ts` scores at least
     `CONFIDENT_TOPIC_SCORE`;
   - it is not a travel question in disguise. *"What is traffic like at 6 PM"*
     and *"how does traffic prediction work"* both mention traffic; the first
     carries **both a clock time and a travel word**, and that combination is
     never treated as a question about the app.
4. `ASK_TRAFFIC`, then the travel matchers as before

**Scoring.** A multi-word keyword scores the square of its word count, so one
three-word hit beats three unrelated one-word hits. A short list of
`strongKeywords` per topic — words that can only mean that topic in this product,
like "pothole" or "rewards" — score as much as a two-word phrase.

**When it is unsure it says so.** A weak match is offered as a question
("Did you want to know about reporting a road problem?"), never answered as
though it were certain. Being wrong about what somebody asked is worse than
admitting the guess.

**The rule every answer in `app-guide.ts` follows:** it must be true of the
application as it exists. No planned feature described as real. Where something
is not built — changing a password, repair status, rewards — the answer says so.
An assistant that confidently describes a screen the person then cannot find
costs them their trust in everything else it said.

---

## 5. Privacy model

- `users.email` exists for authentication, recovery and service messages **only**.
- `users.cityflowId` (e.g. `CF-8X42K91`) is what every other part of the system uses.
- The Admin Portal *(Phase 4)* will read **aggregated** figures only —
  "8,200 trips expected between 6:00–6:15 PM", never "CF-8X42K91 is travelling at 6 PM".
- The session cookie is `httpOnly`, `sameSite=lax`, and `secure` in production.
- Road reports store `userId` for exactly two reasons: so one person cannot
  inflate an issue's evidence, and so they can see their own reports. It is
  never selected by an Admin Portal query, never appears in a CSV export, and
  never appears in the Municipal Dashboard hand-off.
- Photos are re-encoded through a canvas in the browser, which strips the
  camera's embedded GPS metadata. Location is attached only when the person
  explicitly asks for it.
- Road sensing sends only the points where a jolt happened — never a track of
  the journey — and only while the person has it switched on.

---

## 6. What each later phase adds

| Phase | Adds |
|---|---|
| **2** | Travel-routine onboarding, real commuter dashboard, Leaflet map, profile editing. New tables: `TravelProfile`, `Recommendation` |
| **3** | ✅ Built: assistant, intent recognition, confirmation flow, `TravelIntention`, `DemandSlotAggregate`, `NetworkEvent`, city-wide re-optimisation |
| **4** | ✅ Built: Admin Portal at `/admin` with its own chrome and role guard, city overview, zone × slot heatmap, CSV reports, system status, SUMO/OSM demand export and baseline vs CityFlow comparison |
| **5+** | ✅ Built: Saarthi on every page, app-knowledge answers with "take me there" links, small talk, near-miss suggestions. New column: `ChatMessage.link` |
| **5** | ✅ Built: citizen road-issue reporting with in-browser photo resizing, phone motion-sensor road-impact detection, duplicate merging, evidence weighting, exposure-based prioritisation, JSON hand-off to the existing Municipal Dashboard, "My CityFlow participation", rate limiting, edge role check, accessibility pass. New tables: `RoadIssue`, `RoadIssueReport` |

---

## 7. Design principles that constrain the code

1. Do not move congestion — smooth demand. A shift is only accepted after the
   **new** time slot has been checked for overload.
2. Recommendations are suggestions, never instructions.
3. Predictions are presented as estimates, never certainties.
4. Every recommendation carries a plain-language reason.
5. Mock data is allowed only where real data does not exist yet, and must sit
   behind the same data layer the real source will use — so swapping it in
   later changes one file, not the UI.
