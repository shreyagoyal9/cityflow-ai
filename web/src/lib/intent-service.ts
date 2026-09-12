import type { Journey, TravelIntention } from "@prisma/client";

import type { CityCode } from "@/lib/cities";
import { prisma } from "@/lib/db";
import { moveTripInAggregate } from "@/lib/demand/aggregate";
import { reoptimiseCity, type ReoptimisationSummary } from "@/lib/demand/optimizer";
import { roundToSlot, toMinutes, toTimeString } from "@/lib/demand/time-slots";
import { toZoneKey } from "@/lib/demand/zones";
import type { TransportMode } from "@/lib/travel";

/**
 * Writing a confirmed travel intention, and everything that has to happen next.
 *
 * THE SEQUENCE MATTERS
 *   1. Store the structured intention (never the chat text).
 *   2. Move this trip between slots in the aggregated demand table.
 *   3. Record the person's own decision on today's recommendation.
 *   4. Re-optimise the whole city, because step 2 just changed the demand curve
 *      that everyone else's recommendation was based on.
 *
 * Step 4 is the one that matters most. Without it, ten people being told
 * "8:45 is quieter" would all move to 8:45 and nobody would notice until the
 * next morning. With it, the tenth person is already being offered 8:30.
 */

export interface ApplyIntentionArgs {
  userId: string;
  cityCode: CityCode;
  /** Date-only value matching the stored `travelDate` column. */
  travelDate: Date;
  /** A Date whose local fields are that date in the app timezone. */
  localDate: Date;
  /**
   * The routine this change applies to.
   *
   * Was `profile` until Phase 6. Passing the JOURNEY rather than the person is
   * what stops "I'm leaving late tomorrow" from silently rewriting the plan for
   * someone's other trip that day.
   */
  journey: Journey;
  /** The change the person confirmed. */
  change: {
    updatedDeparture?: string;
    transportMode?: TransportMode;
    cancel?: boolean;
  };
}

export interface ApplyIntentionResult {
  intention: TravelIntention;
  /** What the city-wide pass did afterwards. */
  reoptimisation: ReoptimisationSummary;
  /** True when this user's own recommendation was one of the ones changed. */
  ownRecommendationChanged: boolean;
}

export async function applyIntention(
  args: ApplyIntentionArgs
): Promise<ApplyIntentionResult> {
  const { userId, cityCode, travelDate, localDate, journey, change } = args;

  const key = { journeyId_travelDate: { journeyId: journey.id, travelDate } };

  const existing = await prisma.travelIntention.findUnique({ where: key });

  // Which slot is this person currently counted in, if any?
  const previousSlot =
    existing && existing.status === "CONFIRMED" && existing.countedInDemand
      ? roundToSlot(toMinutes(existing.updatedDeparture) ?? 0)
      : null;

  // ------------------------------------------------- work out the new state
  const cancelling = change.cancel === true;

  const newDeparture = cancelling
    ? (existing?.updatedDeparture ?? journey.usualDeparture)
    : (change.updatedDeparture ??
      existing?.updatedDeparture ??
      journey.usualDeparture);

  const newSlot = cancelling ? null : roundToSlot(toMinutes(newDeparture) ?? 0);

  const transportMode =
    change.transportMode ?? existing?.transportMode ?? journey.mode;

  // ------------------------------------------------- 1. store the intention
  const intention = await prisma.travelIntention.upsert({
    where: key,
    create: {
      userId,
      journeyId: journey.id,
      travelDate,
      cityCode,
      originZone: toZoneKey(journey.originArea),
      destinationZone: toZoneKey(journey.destinationArea),
      plannedDeparture: journey.usualDeparture,
      updatedDeparture: newSlot === null ? newDeparture : toTimeString(newSlot),
      transportMode,
      status: cancelling ? "CANCELLED" : "CONFIRMED",
      source: "CHAT",
      // Only a confirmed, non-cancelled trip counts towards demand.
      countedInDemand: !cancelling,
    },
    update: {
      cityCode,
      originZone: toZoneKey(journey.originArea),
      destinationZone: toZoneKey(journey.destinationArea),
      plannedDeparture: journey.usualDeparture,
      updatedDeparture: newSlot === null ? newDeparture : toTimeString(newSlot),
      transportMode,
      status: cancelling ? "CANCELLED" : "CONFIRMED",
      countedInDemand: !cancelling,
    },
  });

  // ------------------------------------------ 2. move the trip in the totals
  // `countedInDemand` on the row above is what stops a double submit from
  // adding the same person to a slot twice.
  await moveTripInAggregate({ cityCode, travelDate, fromSlot: previousSlot, toSlot: newSlot });

  // -------------------------------- 3. record the decision on today's advice
  const recommendation = await prisma.recommendation.findUnique({
    where: { journeyId_travelDate: { journeyId: journey.id, travelDate } },
  });

  if (recommendation && !cancelling && newSlot !== null) {
    const chosen = toTimeString(newSlot);

    await prisma.recommendation.update({
      where: { id: recommendation.id },
      data: {
        chosenDeparture: chosen,
        status:
          chosen === recommendation.recommendedDeparture
            ? "ACCEPTED"
            : chosen === recommendation.usualDeparture
              ? "KEPT_USUAL"
              : "CUSTOM",
        // The person has just made an explicit choice, so any earlier
        // "we changed this for you" notice no longer needs answering.
        updateAcknowledged: true,
      },
    });
  }

  // ------------------------------------------------ 4. re-optimise the city
  const reoptimisation = await reoptimiseCity(cityCode, travelDate, localDate);

  const own = await prisma.recommendation.findUnique({
    where: { journeyId_travelDate: { journeyId: journey.id, travelDate } },
    select: { updatedByOptimiser: true, updateAcknowledged: true },
  });

  return {
    intention,
    reoptimisation,
    ownRecommendationChanged: Boolean(own?.updatedByOptimiser && !own.updateAcknowledged),
  };
}

/** The confirmed plan for one routine on a date, if there is one. */
export async function loadIntention(
  journeyId: string,
  travelDate: Date
): Promise<TravelIntention | null> {
  return prisma.travelIntention.findUnique({
    where: { journeyId_travelDate: { journeyId, travelDate } },
  });
}
