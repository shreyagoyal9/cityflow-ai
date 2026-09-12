# Handing road issues to the Municipal Dashboard

> ## ⚠️ SUPERSEDED BY PHASE 6
>
> **This document describes how things worked in Phases 1–5, when the Municipal
> Dashboard was an external system and CityFlow AI's involvement stopped at
> exporting a prioritised list.**
>
> **In Phase 6 the Municipal Dashboard moved into this repository**, at
> `/municipal`, with a full inspection → assignment → repair → sign-off
> workflow and an employee directory. The reasoning for that reversal — and how
> the honesty rule below is now enforced by the data model rather than by
> leaving the feature out — is in
> [10-PHASE-6.md](10-PHASE-6.md#12-the-municipal-dashboard-is-a-separate-system).
>
> **What is still accurate here:** the evidence model, the priority scoring, the
> merging of duplicate reports, and above all the distinction between what
> citizen reports can support and what only an inspection can establish. The
> hand-off export at `/api/admin/roads/handoff` also still exists, for a council
> that runs its own system and wants the list rather than the workflow.
>
> **What is no longer accurate:** the "Municipal Dashboard" column below now
> describes the `/municipal` portal in this repository, not a third-party
> system.

---

## Who does what

| | CityFlow AI | Municipal Dashboard |
|---|---|---|
| Collect citizen reports | ✅ | |
| Detect road impacts from phone sensors | ✅ | |
| Merge duplicate reports about the same spot | ✅ | |
| Weigh the evidence | ✅ | |
| Rank by how many people are affected | ✅ | |
| **Inspect** | | ✅ |
| **Prioritise for repair (final say)** | | ✅ |
| **Repair** | | ✅ |
| **Track repair status** | | ✅ |
| Control departure recommendations | ✅ | ❌ never |

CityFlow AI's contribution is the one thing a complaints inbox cannot do: it
knows how many trips pass through each area, so it can say which of two
identical potholes affects four hundred people a morning and which affects
twelve.

Where the line sits: CityFlow AI **suggests an order**. The municipal authority
decides. Their priorities include things this system cannot see — a school
route, a hospital approach, works already contracted — so their ordering wins.

---

## The hand-off file

**Admin Portal → Road conditions → Download hand-off file**

You get `cityflow-road-handoff-<city>-<date>.json`.

```
GET /api/admin/roads/handoff?city=bhopal            downloads and marks handed over
GET /api/admin/roads/handoff?city=bhopal&preview=1  downloads WITHOUT marking
```

Use `preview=1` the first time, to see what would go out before anything is
stamped.

### Shape

```jsonc
{
  "producedBy": "CityFlow AI",
  "producedAt": "2026-09-10T04:31:00.000Z",
  "city": "Bhopal",

  // Read this. It is inside the payload on purpose — see below.
  "notice": [ "...", "..." ],

  // How the score was calculated, so it can be checked rather than trusted.
  "scoring": { "formula": "...", "evidence": "...", "severity": "...", "exposure": "..." },

  "issueCount": 12,
  "issues": [
    {
      "reference": "CF-RD-8X42K91Q",
      "city": "Bhopal",
      "area": "MP Nagar Zone 1",
      "location": { "lat": 23.2338, "lng": 77.4343 },
      "locationPrecision": "approximate-gps",   // or "area-only"
      "issueType": "POTHOLE",
      "reportedSeverity": "HIGH",
      "evidence": {
        "confidence": "LIKELY",
        "independentReports": 4,
        "ofWhichSensorDetections": 2
      },
      "suggestedPriority": {
        "score": 78,
        "band": "high",
        "evidenceComponent": 44,
        "severityComponent": 100,
        "exposureComponent": 71,
        "tripsThroughAreaPerDay": 312,
        "explanation": "Reported as dangerous, with several reports agreeing, on one of the city's busiest corridors (312 trips a day pass through this area)."
      },
      "firstReported": "2026-09-02T03:11:00.000Z",
      "lastReported": "2026-09-09T13:47:00.000Z"
    }
  ]
}
```

### Why the caveats are a field in the file

A hand-off file outlives the conversation that produced it. Somebody will open
it months later with no memory of how the numbers were made, and the difference
between *"confirmed by reports"* and *"inspected and verified"* is exactly what
gets lost in that gap — with real consequences, because a municipal team could
reasonably act on the stronger reading.

So the caveats travel inside the payload rather than in a README somebody may
never see.

### Why a file and not an API call

CityFlow AI does not own the Municipal Dashboard, cannot deploy to it, and has
no credentials for it. Writing code that POSTs into it would be inventing an
integration contract on somebody else's behalf, and it would break the moment
their system differed from the guess.

A self-describing JSON file works today, by hand. When a real endpoint exists,
one `fetch` replaces the download and **the payload does not change**.

---

## What `handedOverAt` means

Downloading the file (without `preview=1`) stamps every included issue with
`handedOverAt`.

It means exactly one thing: **this appeared in a file we gave the municipal
team.**

It is not a repair status. CityFlow AI is never told whether anything was
inspected or fixed, so it must never display one. The commuter-facing screens
say "passed to the municipal team on <date>" and stop there.

If the Municipal Dashboard could one day send repair outcomes back, that would
be a new field and a new inbound endpoint — a deliberate change, not something
to be quietly inferred.

---

## The scoring formula

```
score = 0.30 × evidence  +  0.40 × severity  +  0.30 × exposure
```

Each component is 0–100.

| Component | How |
|---|---|
| **evidence** | Weighted independent reports. A human report counts 1, a phone detection 0.5. Saturates at 8 weighted reports. |
| **severity** | The **worst** severity anybody reported: minor 25, moderate 60, dangerous 100. |
| **exposure** | Trips through the area as a percentage of the busiest area **in the same city**. |

Three decisions worth knowing about:

**Severity is the maximum, not the average.** If nine people say a pothole is
minor and one says it broke their wheel, the road is dangerous. Under-stating a
hazard is a much worse failure than over-stating one.

**A phone detection is worth half a human report.** An accelerometer cannot tell
a pothole from a speed breaker or a kerb. Someone who stopped, chose a category
and wrote a sentence has actually looked at it.

**Exposure is relative to the same city.** An absolute trip count would make
every issue in a small city look unimportant next to one in a large city, which
is meaningless — the list is only ever ranked within one city.

The weights live in `web/src/lib/roads/priority.ts` as named constants, so they
can be argued about and changed in one place.

---

## What is deliberately absent

There is **no** inspect button, **no** assign, **no** repair status, **no** due
date and **no** crew anywhere in CityFlow AI. Building any of those would be
quietly recreating the Municipal Dashboard — and filling those fields in would
require ground truth this system does not have.
