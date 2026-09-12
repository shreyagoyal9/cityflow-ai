# End-to-end demo walkthrough

Follow this in order and every part of CityFlow AI gets exercised: the commuter
platform, the rewards ledger, the Municipal Dashboard's repair workflow, and the
Admin Portal's view of the whole thing.

It takes about ten minutes. Nothing here is scripted or faked — every number you
see is produced by the code from the data you enter.

---

## Before you start

```bash
cd web
npm install
npm run db:push
npm run dev
```

Open <http://localhost:3000>.

Optional, for the real forecasting model rather than the built-in fallback:

```bash
# In a second terminal. Needs Python 3.10+ — see ml/README.md
cd ml && source .venv/bin/activate
uvicorn app.main:app --port 8000
```

Then add `ML_SERVICE_URL="http://localhost:8000"` to `web/.env` and restart
`npm run dev`. The Admin Portal's Configuration page will show it as reachable.

---

## Act 1 — Morning, as a commuter

**1. Create an account.** Sign up at `/signup`. Note the anonymous CityFlow ID
you are given — something like `CF-8X42K91`. That, not your name or email, is
what carries your travel behaviour into every city-level figure.

> With no `RESEND_API_KEY` configured, your confirmation email is printed to the
> terminal running `npm run dev`, link and all. Paste it into the browser to see
> the confirmation flow work end to end.

**2. Set up your routine.** Complete onboarding. Use a **09:00** departure and a
**10:00** required arrival with a **25-minute** journey, and allow **30 minutes**
of flexibility in both directions. 09:00 sits on the modelled morning peak, so
there will be something to recommend.

**3. Read your recommendation** on `/dashboard`. You should see:

- a suggested departure earlier or later than 09:00
- the predicted demand at both times, as a 0–100 index
- an estimated time saved, **with the method printed beside it**
- points on offer if you follow it

Press **"Why am I seeing this?"** and check the numbers add up.

**4. Add a second journey.** Go to `/journeys` → **Add a journey** — the trip
home, say **18:00** departure. Return to the dashboard and you now have two
recommendation cards, in departure order. This is the case the pre–Phase 6
system could not handle at all, and the evening peak is the larger of the two in
every city we modelled.

**5. Accept a recommendation.** Press **"Use 08:45"** (or whatever it offers).
Watch the points land — the notice tells you your new balance.

**6. Check `/rewards`.** Your points are there, with a ledger entry naming the
journey. Try redeeming something; note the honesty notice above the catalogue
saying no partner is actually connected.

**7. Plan a one-off trip.** Go to `/plan`. Set an arrival of **10:30**, trip type
**Flight**. Notice the 45-minute safety buffer, and that the reasoning explains
it. Change the type to **Film** and re-run: the buffer drops to 10 minutes and
the departure moves later. The planner will never offer a quieter slot that
arrives late.

**8. See whether it works.** Go to `/insights`. The day curve shows the city's
shape with your own departures marked. Below it, **"Did the peak flatten, or just
move?"** compares the departure times people's routines specify against the ones
they actually confirmed — real stored data, not a simulation — and states
plainly whether a new peak formed elsewhere.

> With one user you will see a very small chart. That is honest: it is counting
> confirmed plans, and there is one. Run `npm run demo:seed` for a populated
> city.

---

## Act 2 — Midday, the road reports itself

**9. Report a road issue.** Go to `/roads` → report a pothole. Add a photo if
you like; the browser downscales it before upload.

**10. Try the sensor detector.** On a phone, the road-impact detector on the same
page uses `DeviceMotion` to spot jolts while you travel. On a laptop it will
tell you the sensors are unavailable rather than pretending.

Note the wording throughout: a single report is a **possible** road issue. Even
with many reports it becomes "confirmed by reports" — never "verified".

---

## Act 3 — Afternoon, as the council

**11. Give yourself municipal access.** In a second terminal:

```bash
cd web && npm run role:set -- your@email.com MUNICIPAL
```

**Sign out and sign back in** — your login cookie still says `USER` until a new
one is issued.

**12. Add an employee.** `/municipal/employees` → **Add an employee**. Staff
number `BMC-1742`, any name, role **Field worker**.

**13. Work the queue.** `/municipal/issues` shows road issues ordered by priority
score — evidence strength, reported severity, and how many trips pass through.
Open yours.

**14. Try to break the workflow.** Attempt to assign the issue while it is still
**New**. It refuses, and tells you *why*: an issue must be verified by an
inspector before work is assigned. That is a state machine, not a status
dropdown — the dishonest sequences are unreachable.

**15. Now do it properly.** **Verified** → **Assigned** (pick your employee, set
a due date) → **In progress** → **Completed** → **Closed**. Watch the **History**
panel build an audit trail of every step, with who did it and when.

**16. Note what this portal cannot see.** There is no commuter data anywhere in
it — not a routine, not a departure, and not who reported the pothole. The
reports panel shows what people wrote and never who wrote it.

---

## Act 4 — Evening, the city's view

**17. Switch to admin.**

```bash
cd web && npm run role:set -- your@email.com ADMIN
```

Sign out and back in. An `ADMIN` account can open all three portals.

**18. Read `/admin`.** The overview opens with **Modelled impact today** —
recommendations followed, estimated person-hours, estimated fuel, high-priority
road issues — with the assumptions behind each figure in the same card, in body
text. That placement is deliberate: those numbers are exactly the kind that end
up in a slide with the caveat stripped off.

**19. Tune the city.** `/admin/config`. Move the **high-priority threshold** and
save; go back to `/municipal/issues` and see which issues are now flagged.
Change **points for following a recommendation** and check `/rewards` — the
citizen-facing page reflects it immediately, with no redeploy.

**20. Check the services.** The same page reports whether the ML service is
reachable and whether email is configured, and says plainly what happens when
each is not.

---

## What to look for while you do this

The interesting thing about this product is not any single screen — it is
whether it keeps its promises when they are inconvenient. Some specific things
worth noticing:

| Where | What to notice |
|---|---|
| Any recommendation | Never proposes a time outside the flexibility you set. Turn flexibility off and it stops suggesting changes entirely. |
| Time saved | Always accompanied by its method, always floored rather than rounded, and absent when the difference is inside the model's noise. |
| `/insights` | Says whether a new peak formed, rather than reporting a headline reduction and staying quiet about it. |
| Road issues | "Possible" → "confirmed by reports" → and only an inspector can make it "verified". |
| `/municipal` | Refuses invalid transitions with an explanation of what to do instead. |
| Rewards | States above the catalogue that no partner is connected. |
| `/settings` | Says the notification preferences are stored and respected but that no delivery channel is built yet. |
| Forgot password | Returns the same message whether or not the address has an account. |
| Empty states | Distinguish "you have not set this up" from "there is nothing to show" — those need different things said. |

---

## Populated demo data

For a city that looks lived-in:

```bash
cd web
npm run demo:seed      # creates users, routines and confirmed plans
npm run demo:optimise  # runs the city-wide re-optimisation pass
npm run demo:check     # verifies the seed landed correctly
npm run demo:clear     # removes it all again
```

See [08-DEMO-DATA.md](08-DEMO-DATA.md) for what the seed contains and what it
deliberately does not.
