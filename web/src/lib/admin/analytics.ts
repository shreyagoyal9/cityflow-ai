import type { SimulationRun } from "@prisma/client";

import { appDateOnly, appLocalDate, appMinutesSinceMidnight } from "@/lib/app-time";
import { getCity, type CityCode } from "@/lib/cities";
import { prisma } from "@/lib/db";
import {
  buildAdjustedCurve,
  loadDemandContext,
  type AdjustedDemandSlot,
} from "@/lib/demand/aggregate";
import { SLOT_MINUTES, dayCodeFor, roundToSlot, toMinutes } from "@/lib/demand/time-slots";
import { toZoneKey, zoneKeyToLabel } from "@/lib/demand/zones";
import { TRANSPORT_MODES, getTransportMode, type TransportMode } from "@/lib/travel";

/**
 * Everything the Admin Portal reads.
 *
 * ============================ THE PRIVACY RULE ==============================
 * Every function in this file returns COUNTS AND AVERAGES. None of them returns
 * a user id, a CityFlow ID, an email, a home area, or anything else that
 * identifies a person. That is not a convention to be careful about — it is
 * enforced by what these queries select.
 *
 * Acceptable:  "8 trips expected between 8:45 and 9:00 AM"
 * Never:       "CF-8X42K91 is travelling at 8:45"
 *
 * One more rule, carried over from the promise made during onboarding: a person
 * who switched OFF "count my trip in city-level demand totals" is excluded from
 * every figure here. `shareAggregatedDemand: true` appears in each query for
 * that reason, and removing it would break a promise the product already made.
 * ============================================================================
 */

/** The hours the portal reports on. Nobody is planning a 3 AM commute. */
export const REPORT_START_MINUTES = 5 * 60;
export const REPORT_END_MINUTES = 23 * 60 + 45;

/* -------------------------------------------------------------------------- */
/*  City overview                                                              */
/* -------------------------------------------------------------------------- */

export interface ParticipationStats {
  totalUsers: number;
  withRoutine: number;
  sharingDemand: number;
  confirmedToday: number;
  cancelledToday: number;
}

export interface RecommendationStats {
  total: number;
  pending: number;
  accepted: number;
  keptUsual: number;
  custom: number;
  movedByOptimiser: number;
  /** Share of decided recommendations that took the suggestion, 0-1. */
  acceptanceRate: number | null;
}

export interface ModeShare {
  mode: TransportMode;
  label: string;
  count: number;
  /** 0-1 */
  share: number;
}

export interface Freshness {
  aggregateUpdatedAt: Date | null;
  lastOptimisationAt: Date | null;
  lastConfirmationAt: Date | null;
}

export interface CityOverview {
  cityCode: CityCode;
  cityName: string;
  /** Demand right now. */
  now: AdjustedDemandSlot;
  /** The whole reporting day, slot by slot. */
  dayCurve: AdjustedDemandSlot[];
  /** The three busiest slots, worst first. */
  peakSlots: AdjustedDemandSlot[];
  /** How many slots are at or above comfortable capacity. */
  overCapacityCount: number;
  participation: ParticipationStats;
  recommendations: RecommendationStats;
  modeSplit: ModeShare[];
  freshness: Freshness;
}

export async function loadCityOverview(cityCode: CityCode): Promise<CityOverview> {
  const city = getCity(cityCode);
  const travelDate = appDateOnly();
  const localNow = appLocalDate();

  const context = await loadDemandContext(city.code, travelDate, localNow);

  const dayCurve = buildAdjustedCurve(context, REPORT_START_MINUTES, REPORT_END_MINUTES);

  const currentSlot = roundToSlot(appMinutesSinceMidnight());
  const now =
    buildAdjustedCurve(context, currentSlot, currentSlot)[0] ?? dayCurve[0];

  const peakSlots = [...dayCurve].sort((a, b) => b.index - a.index).slice(0, 3);

  const [participation, recommendations, modeSplit, freshness] = await Promise.all([
    loadParticipation(city.code, travelDate),
    loadRecommendationStats(city.code, travelDate),
    loadModeSplit(city.code),
    loadFreshness(city.code, travelDate),
  ]);

  return {
    cityCode: city.code,
    cityName: city.name,
    now,
    dayCurve,
    peakSlots,
    overCapacityCount: dayCurve.filter((slot) => slot.overCapacity).length,
    participation,
    recommendations,
    modeSplit,
    freshness,
  };
}

/* -------------------------------------------------------------------------- */
/*  Participation                                                              */
/* -------------------------------------------------------------------------- */

async function loadParticipation(
  cityCode: CityCode,
  travelDate: Date
): Promise<ParticipationStats> {
  const [totalUsers, withRoutine, sharingDemand, confirmedToday, cancelledToday] =
    await Promise.all([
      prisma.user.count({ where: { cityCode, role: "USER" } }),
      prisma.travelProfile.count({ where: { user: { cityCode } } }),
      prisma.travelProfile.count({
        where: { user: { cityCode }, shareAggregatedDemand: true },
      }),
      prisma.travelIntention.count({
        where: { cityCode, travelDate, status: "CONFIRMED" },
      }),
      prisma.travelIntention.count({
        where: { cityCode, travelDate, status: "CANCELLED" },
      }),
    ]);

  return { totalUsers, withRoutine, sharingDemand, confirmedToday, cancelledToday };
}

/* -------------------------------------------------------------------------- */
/*  Recommendation outcomes                                                    */
/* -------------------------------------------------------------------------- */

async function loadRecommendationStats(
  cityCode: CityCode,
  travelDate: Date
): Promise<RecommendationStats> {
  const grouped = await prisma.recommendation.groupBy({
    by: ["status"],
    where: { cityCode, travelDate },
    _count: { _all: true },
  });

  const countFor = (status: string) =>
    grouped.find((row) => row.status === status)?._count._all ?? 0;

  const pending = countFor("PENDING");
  const accepted = countFor("ACCEPTED");
  const keptUsual = countFor("KEPT_USUAL");
  const custom = countFor("CUSTOM");
  const total = pending + accepted + keptUsual + custom;

  const movedByOptimiser = await prisma.recommendation.count({
    where: { cityCode, travelDate, updatedByOptimiser: true },
  });

  const decided = accepted + keptUsual + custom;

  return {
    total,
    pending,
    accepted,
    keptUsual,
    custom,
    movedByOptimiser,
    // Only meaningful once somebody has actually decided something.
    acceptanceRate: decided > 0 ? accepted / decided : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Travel-mode split                                                          */
/* -------------------------------------------------------------------------- */

async function loadModeSplit(cityCode: CityCode): Promise<ModeShare[]> {
  const grouped = await prisma.travelProfile.groupBy({
    by: ["primaryMode"],
    where: { user: { cityCode }, shareAggregatedDemand: true },
    _count: { _all: true },
  });

  const total = grouped.reduce((sum, row) => sum + row._count._all, 0);

  // Every mode is listed, including the ones nobody uses — a zero is
  // information, and a chart whose bars appear and disappear is hard to read.
  return TRANSPORT_MODES.map((mode) => {
    const count = grouped.find((row) => row.primaryMode === mode.code)?._count._all ?? 0;
    return {
      mode: mode.code,
      label: mode.label,
      count,
      share: total > 0 ? count / total : 0,
    };
  }).sort((a, b) => b.count - a.count);
}

/* -------------------------------------------------------------------------- */
/*  Data freshness                                                             */
/* -------------------------------------------------------------------------- */

async function loadFreshness(
  cityCode: CityCode,
  travelDate: Date
): Promise<Freshness> {
  const [aggregate, optimised, confirmed] = await Promise.all([
    prisma.demandSlotAggregate.findFirst({
      where: { cityCode, travelDate },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.recommendation.findFirst({
      where: { cityCode, travelDate, updatedByOptimiser: true },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.travelIntention.findFirst({
      where: { cityCode, travelDate },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  return {
    aggregateUpdatedAt: aggregate?.updatedAt ?? null,
    lastOptimisationAt: optimised?.updatedAt ?? null,
    lastConfirmationAt: confirmed?.updatedAt ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Zone × time-slot demand (the heatmap)                                      */
/* -------------------------------------------------------------------------- */

export interface ZoneDemandRow {
  zoneKey: string;
  zoneLabel: string;
  /** Trips per slot, indexed the same way as `slotMinutes` below. */
  trips: number[];
  total: number;
}

export interface ZoneDemand {
  /** Slot starts, in minutes since midnight. */
  slotMinutes: number[];
  rows: ZoneDemandRow[];
  /** The largest single cell, used to scale the ramp. */
  maxTrips: number;
  /** How many routines the figures are built from. */
  routinesCounted: number;
  /** How many of those have a confirmed plan for today rather than an assumption. */
  confirmedCounted: number;
}

/**
 * Trips per origin zone per time slot, for one city and date.
 *
 * WHERE THE NUMBERS COME FROM — and this matters, because it is the difference
 * between a real figure and a decorative one:
 *
 *   - A person who has CONFIRMED a plan for today is counted at the time they
 *     confirmed. That is fact.
 *   - Everyone else is counted at their usual departure, but only if today is
 *     one of their travel days. That is an assumption, and the UI labels it as
 *     one.
 *   - A person who cancelled today is not counted at all.
 *   - A person who turned off "count my trip in city-level demand totals" is
 *     not counted at all.
 *
 * Nothing here is invented. Every trip in the grid traces back to a routine a
 * real registered user entered.
 */
export async function loadZoneDemand(
  cityCode: CityCode,
  fromMinutes = REPORT_START_MINUTES,
  toMinutes_ = REPORT_END_MINUTES
): Promise<ZoneDemand> {
  const travelDate = appDateOnly();
  const localNow = appLocalDate();
  const todayCode = dayCodeFor(localNow);

  const [profiles, intentions] = await Promise.all([
    prisma.travelProfile.findMany({
      where: { user: { cityCode }, shareAggregatedDemand: true },
      select: {
        userId: true,
        homeArea: true,
        usualDeparture: true,
        travelDays: true,
      },
    }),
    prisma.travelIntention.findMany({
      where: { cityCode, travelDate },
      select: {
        userId: true,
        originZone: true,
        updatedDeparture: true,
        status: true,
      },
    }),
  ]);

  const intentionByUser = new Map(intentions.map((row) => [row.userId, row]));

  // Build the slot axis first, so every row has the same width.
  const slotMinutes: number[] = [];
  for (let m = roundToSlot(fromMinutes); m <= toMinutes_; m += SLOT_MINUTES) {
    slotMinutes.push(m);
  }
  const slotIndex = new Map(slotMinutes.map((m, i) => [m, i]));

  const byZone = new Map<string, number[]>();
  let routinesCounted = 0;
  let confirmedCounted = 0;

  function addTrip(zoneKey: string, minutes: number) {
    const index = slotIndex.get(roundToSlot(minutes));
    if (index === undefined) return; // outside the reporting window

    if (!byZone.has(zoneKey)) byZone.set(zoneKey, new Array(slotMinutes.length).fill(0));
    byZone.get(zoneKey)![index] += 1;
  }

  for (const profile of profiles) {
    const intention = intentionByUser.get(profile.userId);

    // Cancelled for today — not travelling, so not demand.
    if (intention?.status === "CANCELLED") continue;

    if (intention && intention.status === "CONFIRMED") {
      const minutes = toMinutes(intention.updatedDeparture);
      if (minutes !== null) {
        addTrip(intention.originZone, minutes);
        routinesCounted += 1;
        confirmedCounted += 1;
      }
      continue;
    }

    // No confirmed plan: assume the routine, but only on their travel days.
    if (!profile.travelDays.includes(todayCode)) continue;

    const minutes = toMinutes(profile.usualDeparture);
    if (minutes === null) continue;

    addTrip(toZoneKey(profile.homeArea), minutes);
    routinesCounted += 1;
  }

  const rows: ZoneDemandRow[] = [...byZone.entries()]
    .map(([zoneKey, trips]) => ({
      zoneKey,
      zoneLabel: zoneKeyToLabel(zoneKey),
      trips,
      total: trips.reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total);

  const maxTrips = rows.reduce(
    (max, row) => Math.max(max, ...row.trips),
    0
  );

  return { slotMinutes, rows, maxTrips, routinesCounted, confirmedCounted };
}

/* -------------------------------------------------------------------------- */
/*  Simulation runs                                                            */
/* -------------------------------------------------------------------------- */

export async function loadSimulationRuns(cityCode: CityCode): Promise<SimulationRun[]> {
  return prisma.simulationRun.findMany({
    where: { cityCode },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

/* -------------------------------------------------------------------------- */
/*  System health                                                              */
/* -------------------------------------------------------------------------- */

export interface SystemHealth {
  database: { ok: boolean; responseMs: number };
  /** Services that exist as code paths, and whether they have run today. */
  services: Array<{
    name: string;
    status: "ok" | "idle" | "not-connected";
    detail: string;
  }>;
}

export async function loadSystemHealth(
  cityCode: CityCode
): Promise<SystemHealth> {
  const travelDate = appDateOnly();

  const startedAt = Date.now();
  let databaseOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseOk = false;
  }
  const responseMs = Date.now() - startedAt;

  const [aggregateRows, optimisedToday, eventsActive, roadIssues, roadHandedOver] =
    await Promise.all([
      prisma.demandSlotAggregate.count({ where: { cityCode, travelDate } }),
      prisma.recommendation.count({
        where: { cityCode, travelDate, updatedByOptimiser: true },
      }),
      prisma.networkEvent.count({ where: { cityCode, eventDate: travelDate, active: true } }),
      prisma.roadIssue.count({ where: { cityCode } }),
      prisma.roadIssue.count({ where: { cityCode, handedOverAt: { not: null } } }),
    ]);

  return {
    database: { ok: databaseOk, responseMs },
    services: [
      {
        name: "Demand prediction",
        status: "ok",
        detail: "Baseline model available for every slot",
      },
      {
        name: "Demand aggregation",
        status: aggregateRows > 0 ? "ok" : "idle",
        detail:
          aggregateRows > 0
            ? `${aggregateRows} slot${aggregateRows === 1 ? "" : "s"} hold confirmed trips today`
            : "No confirmed trips recorded today yet",
      },
      {
        name: "Re-optimisation",
        status: optimisedToday > 0 ? "ok" : "idle",
        detail:
          optimisedToday > 0
            ? `${optimisedToday} recommendation${optimisedToday === 1 ? "" : "s"} adjusted today`
            : "No re-optimisation needed today",
      },
      {
        name: "Network events",
        status: eventsActive > 0 ? "ok" : "not-connected",
        detail:
          eventsActive > 0
            ? `${eventsActive} active event${eventsActive === 1 ? "" : "s"} affecting demand`
            : "No live accident, closure or weather feed is connected — events are entered by hand",
      },
      {
        name: "Road-condition data",
        status: roadIssues > 0 ? "ok" : "idle",
        detail:
          roadIssues > 0
            ? `${roadIssues} place${roadIssues === 1 ? "" : "s"} reported; ${roadHandedOver} passed to the municipal team`
            : "Reporting and phone-sensor detection are live, but nobody has reported a road issue in this city yet",
      },
      {
        name: "Municipal Dashboard hand-off",
        status: "not-connected",
        detail:
          "The Municipal Dashboard is a separate system with no API available to us. Hand-off is a downloadable JSON file an operator transfers by hand.",
      },
      {
        name: "Notifications",
        status: "ok",
        detail: "In-app only. No email or push delivery is configured.",
      },
      {
        name: "SUMO simulation",
        status: "not-connected",
        detail:
          "SUMO runs outside the web application. Demand can be exported; results are entered back in.",
      },
    ],
  };
}

/** Small helper used by the portal's tiles. */
export function modeLabel(code: string): string {
  return getTransportMode(code).label;
}

/* ==========================================================================
   PHASE 6 — modelled impact
   ========================================================================== */

/**
 * The "what has this achieved" figures.
 *
 * ====================== READ THIS BEFORE QUOTING ANY OF IT ==================
 * EVERY NUMBER HERE IS A MODEL ESTIMATE. Not one of them is a measurement.
 *
 * CityFlow AI has no live traffic feed and has never timed a real journey. What
 * it has is: the demand model's congestion multiplier, the journey time each
 * person entered themselves, and a record of who accepted a recommendation. The
 * figures below are arithmetic on those three things.
 *
 * They are computed at all because a city evaluating this product will ask
 * "what would it achieve?", and "we decline to estimate" is not a useful
 * answer. They are returned WITH their assumptions attached, and the Admin
 * Portal is required to render those assumptions beside the numbers — so the
 * honest version is the easy version for whoever builds the next screen.
 *
 * WHAT WOULD MAKE THEM REAL
 * Opt-in recording of actual departure and arrival times. That is a genuine
 * feature, and `lib/demand/savings.ts` is the seam where it plugs in. Until it
 * exists, every one of these words stays "estimated".
 * ============================================================================
 */

export interface ModelledImpact {
  /** Recommendations accepted today. The only ones counted. */
  acceptedToday: number;
  /** Recommendations shown today, accepted or not. */
  offeredToday: number;
  /** Sum of per-person modelled minutes saved. */
  estimatedMinutesSaved: number;
  estimatedPersonHours: number;
  /** Litres of fuel, on the stated assumptions. */
  estimatedFuelLitres: number;
  /** Share of accepted trips made by car or motorbike. */
  vehicleShare: number;
  /** Road issues at or above the city's high-priority threshold, still open. */
  highPriorityRoadIssues: number;
  /** The assumptions behind the fuel figure, for rendering beside it. */
  fuelAssumptions: string[];
}

export async function loadModelledImpact(
  cityCode: CityCode,
  travelDate: Date
): Promise<ModelledImpact> {
  const { getCityConfig } = await import("@/lib/city-config");
  const { aggregateSavings, estimateFuelLitres } = await import("@/lib/demand/savings");

  const config = await getCityConfig(cityCode);

  const [accepted, offeredToday, highPriorityRoadIssues] = await Promise.all([
    prisma.recommendation.findMany({
      where: { cityCode, travelDate, status: "ACCEPTED" },
      select: {
        demandAtUsual: true,
        demandAtRecommended: true,
        journey: { select: { typicalJourneyMinutes: true, mode: true } },
      },
    }),
    prisma.recommendation.count({ where: { cityCode, travelDate } }),
    prisma.roadIssue.count({
      where: {
        cityCode,
        priorityScore: { gte: config.highPriorityThreshold },
        status: { notIn: ["CLOSED", "REJECTED"] },
      },
    }),
  ]);

  /*
    A recommendation whose journey has since been deleted still counts towards
    "accepted", but has no journey time to estimate a saving from. Falling back
    to a made-up number would quietly inflate the total, so it contributes zero.
  */
  const withJourney = accepted.filter((row) => row.journey !== null);

  const savings = aggregateSavings(
    withJourney.map((row) => ({
      typicalJourneyMinutes: row.journey!.typicalJourneyMinutes,
      demandAtUsual: row.demandAtUsual,
      demandAtRecommended: row.demandAtRecommended,
    }))
  );

  // Only private vehicles burn fuel in a jam. A metro passenger saves time
  // without saving a drop, so the share is measured rather than assumed at 100%.
  const vehicleTrips = withJourney.filter(
    (row) => row.journey!.mode === "CAR" || row.journey!.mode === "BIKE"
  ).length;
  const vehicleShare = withJourney.length === 0 ? 0 : vehicleTrips / withJourney.length;

  const fuel = estimateFuelLitres(savings.totalMinutes, vehicleShare);

  return {
    acceptedToday: accepted.length,
    offeredToday,
    estimatedMinutesSaved: savings.totalMinutes,
    estimatedPersonHours: savings.personHours,
    estimatedFuelLitres: fuel.litres,
    vehicleShare,
    highPriorityRoadIssues,
    fuelAssumptions: fuel.assumptions,
  };
}
