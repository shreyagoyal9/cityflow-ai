import type {
  Journey,
  Recommendation,
  TravelIntention,
  TravelProfile,
} from "@prisma/client";

import { appDateOnly, appLocalDate, appMinutesSinceMidnight } from "@/lib/app-time";
import { getCity, type CityCode } from "@/lib/cities";
import { getCityConfig } from "@/lib/city-config";
import { prisma } from "@/lib/db";
import {
  buildAdjustedCurve,
  demandAtFor,
  loadDemandContext,
  type AdjustedDemandSlot,
  type DemandContext,
} from "@/lib/demand/aggregate";
import { DEMAND_LEVEL_LABEL, levelForIndex } from "@/lib/demand/demand-model";
import {
  peakStripRange,
  recommendDeparture,
  type RecommendationResult,
} from "@/lib/demand/recommend";
import { estimateSavings, type SavingsEstimate } from "@/lib/demand/savings";
import { SLOT_MINUTES, toTimeString } from "@/lib/demand/time-slots";
import { journeysForDate } from "@/lib/journeys/journey-service";
import { pointsEarnedToday } from "@/lib/rewards/ledger";
import { fetchWeather, weatherTravelNote, type WeatherToday } from "@/lib/weather";

/**
 * Ties the demand engine to the database.
 *
 * The dashboard (a server component) and the API routes both call in here, so
 * there is exactly one definition of "today's recommendations" in the product.
 *
 * WHAT CHANGED IN PHASE 6
 * A person used to have one routine and therefore one recommendation a day.
 * They now have several, so this module returns a LIST. The engine itself did
 * not change — it is called once per routine — but everything around it did:
 * each journey gets its own stored recommendation, its own demand strip, and
 * its own points offer.
 *
 * WHY EACH RECOMMENDATION IS STORED
 * Two reasons, both about honesty:
 *  1. The reason text shown to the person is saved with it, so "why am I seeing
 *     this?" can be answered later with the actual wording they saw — not a
 *     sentence re-derived from numbers that have since moved.
 *  2. It gives a real history: what was suggested, what they chose, day by day.
 */

/** One routine's full picture for today. */
export interface JourneyToday {
  journey: Journey;
  /** The stored recommendation for this routine today. */
  recommendation: Recommendation;
  /** Freshly computed engine output — includes every option considered. */
  engine: RecommendationResult;
  /** Modelled time saved. Always shown with its caveat. See lib/demand/savings.ts. */
  savings: SavingsEstimate;
  /** Short demand strip around the usual departure, for the peak chart. */
  peakStrip: AdjustedDemandSlot[];
  /** The person's confirmed plan for this routine today, if they have made one. */
  intention: TravelIntention | null;
  /** Points on offer if they follow this recommendation. */
  pointsOffered: number;
}

export interface TodayView {
  /** Preferences and privacy choices. Null until onboarding is finished. */
  profile: TravelProfile | null;
  /** Every routine that runs today, in the person's chosen order. */
  journeys: JourneyToday[];
  /** True when the person has routines, but none of them run today. */
  hasJourneysButNoneToday: boolean;
  /** Demand right now, for the "traffic status" tile. */
  now: AdjustedDemandSlot;
  cityCode: CityCode;
  weather: WeatherToday | null;
  /** One sentence when weather is likely to affect travel, otherwise null. */
  weatherNote: string | null;
  pointsToday: number;
  pointsBalance: number;
}

/**
 * Loads everything the dashboard needs for today.
 *
 * @param userId    The signed-in user.
 * @param cityCode  City to compute demand for. Falls back to the default city.
 */
export async function loadTodayForUser(
  userId: string,
  cityCode: string | null | undefined
): Promise<TodayView> {
  const city = getCity(cityCode);
  const localNow = appLocalDate();
  const travelDate = appDateOnly();

  // One database round trip for confirmed trips and network events, reused for
  // every slot every routine asks about.
  const context = await loadDemandContext(city.code, travelDate, localNow);

  const nowSlot = currentSlotFrom(context);

  // These four are independent of each other, so they go out together rather
  // than in sequence. On a dashboard load that is the difference between one
  // round trip and four.
  const [profile, allJourneysToday, config, weather] = await Promise.all([
    prisma.travelProfile.findUnique({ where: { userId } }),
    journeysForDate(userId, localNow),
    getCityConfig(city.code),
    fetchWeather(city),
  ]);

  const [pointsToday, rewards, journeyCount] = await Promise.all([
    pointsEarnedToday(userId, startOfDayFrom(localNow)),
    prisma.userRewards.findUnique({ where: { userId } }),
    prisma.journey.count({ where: { userId } }),
  ]);

  const base = {
    profile,
    now: nowSlot,
    cityCode: city.code,
    weather,
    weatherNote: weatherTravelNote(weather),
    pointsToday,
    pointsBalance: rewards?.pointsBalance ?? 0,
  };

  if (allJourneysToday.length === 0) {
    return {
      ...base,
      journeys: [],
      // Distinguishing these two matters: "you have not set up a routine yet"
      // and "none of your routines run on a Sunday" need completely different
      // things said to the person.
      hasJourneysButNoneToday: journeyCount > 0,
    };
  }

  const journeys = await Promise.all(
    allJourneysToday.map((journey) =>
      buildJourneyToday({
        userId,
        journey,
        context,
        cityCode: city.code,
        travelDate,
        pointsOnOffer: config.pointsForFollowingRecommendation,
      })
    )
  );

  return { ...base, journeys, hasJourneysButNoneToday: false };
}

/** Runs the engine for one routine and stores the result. */
async function buildJourneyToday(args: {
  userId: string;
  journey: Journey;
  context: DemandContext;
  cityCode: CityCode;
  travelDate: Date;
  pointsOnOffer: number;
}): Promise<JourneyToday> {
  const { userId, journey, context, cityCode, travelDate, pointsOnOffer } = args;

  const engine = recommendDeparture({
    demandAt: demandAtFor(context),
    usualDeparture: journey.usualDeparture,
    requiredArrival: journey.requiredArrival,
    typicalJourneyMinutes: journey.typicalJourneyMinutes,
    isFlexible: journey.isFlexible,
    flexibilityMinutes: journey.flexibilityMinutes,
    willingToLeaveEarlier: journey.willingToLeaveEarlier,
    willingToLeaveLater: journey.willingToLeaveLater,
  });

  const savings = estimateSavings(
    journey.typicalJourneyMinutes,
    engine.demandAtUsual,
    engine.demandAtRecommended
  );

  // Points are only on offer when there is actually something to follow. Paying
  // someone for keeping the time they were always going to keep would make the
  // whole scheme meaningless.
  const pointsOffered = engine.suggestsChange ? pointsOnOffer : 0;

  const [recommendation, intention] = await Promise.all([
    persistRecommendation({
      userId,
      journeyId: journey.id,
      cityCode,
      travelDate,
      engine,
      savings,
      pointsOffered,
    }),
    prisma.travelIntention.findUnique({
      where: { journeyId_travelDate: { journeyId: journey.id, travelDate } },
    }),
  ]);

  const strip = peakStripRange(journey.usualDeparture);

  return {
    journey,
    recommendation,
    engine,
    savings,
    peakStrip: buildAdjustedCurve(context, strip.from, strip.to),
    intention,
    pointsOffered,
  };
}

/**
 * Writes a routine's recommendation for today, or returns the stored one.
 *
 * A stored recommendation is REPLACED only when it no longer describes the
 * person's situation — they changed the routine, switched city, or the
 * city-wide optimiser moved them. Otherwise it is left exactly as it was,
 * including whether they already accepted it.
 */
async function persistRecommendation(args: {
  userId: string;
  journeyId: string;
  cityCode: CityCode;
  travelDate: Date;
  engine: RecommendationResult;
  savings: SavingsEstimate;
  pointsOffered: number;
}): Promise<Recommendation> {
  const { userId, journeyId, cityCode, travelDate, engine, savings, pointsOffered } = args;

  const key = { journeyId_travelDate: { journeyId, travelDate } };

  const existing = await prisma.recommendation.findUnique({ where: key });

  // A recommendation the person has already acted on is never silently
  // rewritten underneath them — only the optimiser may change it, and when it
  // does it says so.
  if (existing && existing.status !== "PENDING") return existing;

  const stillAccurate =
    existing !== null &&
    existing.cityCode === cityCode &&
    existing.usualDeparture === engine.usualDeparture &&
    existing.recommendedDeparture === engine.recommendedDeparture;

  if (stillAccurate) return existing;

  const values = {
    cityCode,
    usualDeparture: engine.usualDeparture,
    recommendedDeparture: engine.recommendedDeparture,
    demandAtUsual: engine.demandAtUsual,
    demandAtRecommended: engine.demandAtRecommended,
    reason: engine.reason,
    estimatedMinutesSaved: savings.minutes,
    pointsOffered,
  };

  return prisma.recommendation.upsert({
    where: key,
    create: { userId, journeyId, travelDate, ...values },
    update: {
      ...values,
      // The situation changed, so any earlier decision no longer applies.
      status: "PENDING",
      chosenDeparture: null,
      // `pointsAwarded` is deliberately NOT reset. Points already credited stay
      // credited — a routine change must never claw back something earned.
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Demand in the slot containing the current moment. */
function currentSlotFrom(context: DemandContext): AdjustedDemandSlot {
  const currentSlot =
    Math.floor(appMinutesSinceMidnight() / SLOT_MINUTES) * SLOT_MINUTES;

  return (
    buildAdjustedCurve(context, currentSlot, currentSlot)[0] ?? {
      minutes: currentSlot,
      time: toTimeString(currentSlot),
      index: 0,
      level: levelForIndex(0),
      label: DEMAND_LEVEL_LABEL[levelForIndex(0)],
      baselineIndex: 0,
      confirmedTrips: 0,
      overCapacity: false,
    }
  );
}

/** Midnight at the start of the app's local day. */
function startOfDayFrom(localNow: Date): Date {
  const start = new Date(localNow);
  start.setHours(0, 0, 0, 0);
  return start;
}

/* -------------------------------------------------------------------------- */
/*  History                                                                    */
/* -------------------------------------------------------------------------- */

/** A recommendation with the routine it belonged to, for the history card. */
export type RecommendationWithJourney = Recommendation & {
  journey: Pick<Journey, "id" | "label" | "originArea" | "destinationArea"> | null;
};

/**
 * The last N days of recommendations, newest first.
 *
 * Includes the routine so history can say "Morning commute" rather than listing
 * times with no context — which is unreadable once a person has three routines.
 */
export async function loadRecommendationHistory(
  userId: string,
  take = 12
): Promise<RecommendationWithJourney[]> {
  return prisma.recommendation.findMany({
    where: { userId },
    orderBy: [{ travelDate: "desc" }, { createdAt: "desc" }],
    take,
    include: {
      journey: {
        select: { id: true, label: true, originArea: true, destinationArea: true },
      },
    },
  });
}

/** History for one routine only. Shown on a journey's own detail card. */
export async function loadJourneyHistory(
  userId: string,
  journeyId: string,
  take = 10
): Promise<Recommendation[]> {
  return prisma.recommendation.findMany({
    where: { userId, journeyId },
    orderBy: { travelDate: "desc" },
    take,
  });
}
