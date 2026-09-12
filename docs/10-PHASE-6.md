# Phase 6 — what was added, and what changed its mind

Phase 6 is the largest change since Phase 1. It added the Python ML service the
project's own specification called for, three whole features the commuter
platform was missing, a third portal, and the infrastructure to run the lot with
one command.

It also reversed two earlier decisions. Those are the interesting part, and they
are documented first.

---

## 1. Two reversals

### 1.1 "There is no time saved"

**Phases 1–5 refused to display any time-saved figure.** The reasoning, quoted
from the old README:

> There is no "time saved", because nobody's real journey was measured.

That was correct and the risk it guarded against is real. A number like "you
saved 8 minutes" is remembered long after any caveat beside it is forgotten,
and it would have been the easiest thing in the product to quote dishonestly.

**Phase 6 shows the figure.** The reason is that the refusal solved an honesty
problem by creating a usefulness one: a commuter deciding whether to move their
morning needs to know the expected size of the prize, and "predicted demand 74
versus 51" does not tell them. Refusing to answer the question people actually
have is its own kind of failure.

The risk is now managed rather than avoided, in four specific ways:

1. **Derived only from what the system holds.** The difference between the
   journey length the demand model expects at the usual slot and at the
   recommended slot, using the light-traffic journey time the person entered
   themselves. Nothing is invented or fetched from anywhere.
2. **Floored, never rounded.** Between overstating and understating a benefit
   we have not measured, understating is the only honest direction to err.
3. **Suppressed below 2 minutes.** Inside that range the difference is within
   the model's own precision, so it is reported as no meaningful saving rather
   than as a small one.
4. **The method travels with the number.** `estimateSavings()` returns the
   figure and a sentence describing exactly how it was derived, and every
   component that renders one renders the other — in body text, on the same
   screen, not behind a tooltip.

See `web/src/lib/demand/savings.ts`. The header comment there is the canonical
statement of this decision, including what would make it a measurement rather
than an estimate (opt-in recording of real departure and arrival times) and
where that would plug in.

### 1.2 "The Municipal Dashboard is a separate system"

**Phases 1–5 treated road repair as somebody else's responsibility.** CityFlow
AI prioritised road issues, exported a hand-off file, and stopped. The old
README was explicit that modelling inspections, work orders or crews "would be
quietly taking over a responsibility that is not ours".

**Phase 6 builds the repair workflow in.** A prioritised list that nothing
consumes is not a hand-off, it is a dead end — and the project's own end-to-end
demo scenario (assign to an employee, mark completed, update the dashboard)
could not be demonstrated at all.

The honesty rule that justified the old position is not abandoned. It is now
**enforced by the data model** instead of by omission:

- `confidence` — POSSIBLE → LIKELY → CONFIRMED_BY_REPORTS — is what **citizen
  evidence** supports. The system sets it automatically from report counts.
- `status` — NEW → VERIFIED → ASSIGNED → ACKNOWLEDGED → IN_PROGRESS →
  COMPLETED → CLOSED — is what a **named officer has done**.

They are separate columns because they are different kinds of claim. An issue
can be CONFIRMED_BY_REPORTS and still NEW, because twenty citizens agreeing is
not the council acting. Only a person can move an issue to VERIFIED, and the
state machine in `web/src/lib/municipal/workflow.ts` makes the dishonest
sequences unreachable rather than merely discouraged — an issue cannot be
assigned before it is verified, or completed before work started.

---

## 2. The ML service

`ml/` is a FastAPI service with three endpoints: `/health`, `/forecast`,
`/optimize`.

### Why each library is there

| Library | Job | Why not something simpler |
|---|---|---|
| **Prophet** | The calendar-driven shape of demand: daily double peak, weekly cycle, flatter weekend | It also returns an uncertainty interval, which matters for a product whose first principle is that a prediction is not a measurement |
| **XGBoost** | Fitted to **Prophet's residuals**, not to demand | Prophet cannot see rain, a closure or an event. Stacking this way keeps the seasonal structure interpretable and gives the tree model only the job it is good at |
| **OR-Tools** CP-SAT | Assign every flexible trip to a departure slot, minimising the busiest slot of the day | This is the whole point of the project (see below) |
| **NetworkX** | Corridor modelling, so two trips only compete if they share road | City-wide totals hide the fact that a corridor can saturate while the city looks fine |

### Why a solver, and not just per-person advice

Recommending a quieter slot to one person is easy: look at the curve, pick the
dip. Doing it for everybody is a different problem, because **the advice
invalidates itself** — tell ten thousand people that 08:45 is quiet and 08:45
stops being quiet. Greedy per-person advice does not smooth a peak, it
relocates it, which is the exact failure CityFlow AI exists to avoid.

Stated properly it is multi-agent scheduling:

```
minimise   peak_weight · max_s(load[s])  +  disruption_weight · Σ|shift_i|
subject to every trip departing in exactly one slot
           from the set that person actually agreed to
```

`peak_weight` alone would flatten the curve perfectly by moving everyone to the
edge of their window — optimal and socially absurd. The disruption term is what
keeps the answer humane: somebody is moved only when moving them actually buys
peak reduction. Both weights are configurable per city, because that trade-off
is a policy decision rather than an engineering one.

**Consent is structural, not a check.** A person who declared no flexibility has
exactly one allowed slot, so the model has exactly one variable that can be
true. No objective value can move them. There is a test for this.

### Honest limitations

1. **A new city has no history.** Under seven days of real observations,
   `/forecast` returns a *seasonal prior* — the shape urban demand normally
   takes — tagged `method: "seasonal_prior"` with confidence capped at 35. It is
   not a measurement and the API says so on every response.
2. **The corridor graph is not a routed road network.** It knows two zones are
   connected; not by which road, how many lanes, or where the junction backs
   up. Corridor pressure is therefore relative, never a vehicles-per-hour claim.
3. **Rain's effect is assumed, not fitted.** Coarse, capped, and documented at
   the point of use.

---

## 3. New commuter features

| Feature | Why it mattered |
|---|---|
| **Multiple journeys** | The single-routine model assumed one trip a day. Almost everyone makes two, and the **evening peak is the larger one in every city we looked at** — so the system could never help with the journey people find worst. Existing profiles migrate automatically on first read. |
| **Plan a trip** | A one-off trip inverts the constraint: it starts from an arrival deadline and works backwards, with a safety buffer sized by consequence (45 minutes for a flight, 10 for a film). It will never recommend a quieter slot that arrives late. |
| **Rewards** | Demand smoothing asks people to do something mildly inconvenient for a mostly collective benefit. Points are the acknowledgement that the inconvenience is real. The ledger is append-only and double-entry-checkable; **the partnerships are not real and the UI says so above the catalogue.** |
| **Traffic insights** | Shows the working: the day's curve, why your own time was chosen, and a before/after comparison built from stored `plannedDeparture` vs `updatedDeparture` — real people counted at two times, not a simulation. It reports honestly when a peak was **relocated** rather than flattened. |
| **Weather** | Rain is the most reliable non-calendar predictor of a bad commute. Open-Meteo, free, no key, and omitted entirely rather than guessed when unreachable. |
| **Email verification & password reset** | Only a SHA-256 hash of each token is stored, tokens are single-use and expire, a new one invalidates the old, and resetting cancels every other live token. The forgot-password endpoint returns an **identical response** whether or not the address has an account — otherwise it is an account-enumeration oracle, which for a product that knows people's travel patterns is worse than a normal privacy leak. |

---

## 4. Per-city configuration

Sixteen thresholds moved out of code and into the `city_configs` table:
priority thresholds, sensor sensitivity, every reward value, the default
flexibility window, the peak threshold.

Every one is a judgement that belongs to a city rather than to us. What counts
as a high-priority pothole in Bhopal is not what counts in Mumbai. Hard-coding
them meant a redeploy each time a council changed its mind about its own policy.

Defaults are literally the constants that preceded the table, so an
unconfigured city behaves exactly as it did before. `getCityConfig()` never
returns null.

---

## 5. Infrastructure

- **Docker Compose** — web, ML service, Postgres, Redis, Nginx. One command,
  no accounts, no API keys. Production still runs on Vercel + Neon; both paths
  are supported deliberately.
- **Nginx** — one front door, the ML service on an internal network with no
  published port, separate rate-limit buckets (the forecasting endpoints are
  far more expensive than a page load), security headers set at the proxy so
  they cover error pages the app never sees.
- **GitHub Actions** — four independent jobs: typecheck, Jest, a real
  `next build`, and pytest. The build job is the one that catches what
  typechecking cannot — a server component importing browser-only code, a bad
  route export, a page that will not compile.

---

## 6. What is still not built

Stated plainly, because a project that hides its gaps is harder to trust than
one that lists them.

- **No real traffic feed.** Every demand figure is a model prediction. The seam
  is `predictDemandIndex()` and the aggregation on top of it.
- **No measured journeys.** Time saved and fuel are estimates. Opt-in recording
  of departure and arrival times is what would change that.
- **No delivery channel for notifications.** The preferences are stored and
  respected by the code that decides what to send; there is no push service or
  email digest yet, so in practice the only thing that reaches a person is what
  they see on screen. The settings page says so.
- **No partner integrations for rewards.** Redemption produces a reference code
  and a ledger entry. No money moves and no business is notified.
- **Carpool matching and multi-modal nudging** are modelled in the schema
  (`carpoolInterest`, `publicTransportInterest`, mode weights in the optimiser)
  but there is no matching engine yet.
- **Images live in database columns** as data URLs, bounded to ~200 KB and
  downscaled in the browser. A production deployment would use object storage;
  that change touches one column and one upload route.
