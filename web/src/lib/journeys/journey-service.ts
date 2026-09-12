import type { Journey, TravelProfile } from "@prisma/client";

import { prisma } from "@/lib/db";
import { dayCodeFor } from "@/lib/demand/time-slots";

/**
 * Recurring journeys — a person's routines.
 *
 * WHY THIS MODULE EXISTS
 * Until Phase 6 a person had exactly one routine, stored on `TravelProfile`.
 * That quietly assumed everybody makes one trip a day. In practice almost
 * everyone makes at least two — out in the morning, back in the evening — and
 * the evening peak is the larger one in every city we looked at. A system that
 * could only model the morning could never smooth the peak that mattered most.
 *
 * `TravelProfile` still exists and still holds what is true of the PERSON
 * rather than of one trip: acceptable modes, tolerance for delay, privacy and
 * notification choices. This module owns the trips themselves.
 */

/** The most routines one person may hold. */
const MAX_JOURNEYS_PER_USER = 8;

export { MAX_JOURNEYS_PER_USER };

/* -------------------------------------------------------------------------- */
/*  Migration from the single-routine model                                    */
/* -------------------------------------------------------------------------- */

/**
 * Ensures a person's routines exist, creating the first one from their old
 * `TravelProfile` if they have not been migrated yet.
 *
 * WHY THIS IS LAZY RATHER THAN A ONE-OFF SCRIPT
 * A migration script has to be run, has to be run once, and has to be run
 * before anybody signs in. Doing it on read means a person who has not opened
 * the app for six months is migrated correctly the moment they do, and a
 * database restored from an old backup heals itself rather than showing
 * everyone an empty dashboard. `scripts/migrate-journeys.mjs` does the same
 * thing in bulk for anyone who wants the data tidy immediately, but nothing
 * depends on it having been run.
 *
 * Safe to call on every request: once a journey exists this is a single
 * indexed read.
 */
export async function ensureJourneys(userId: string): Promise<Journey[]> {
  const existing = await prisma.journey.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  if (existing.length > 0) return existing;

  const profile = await prisma.travelProfile.findUnique({ where: { userId } });

  // No profile means onboarding was never finished. That is a normal state and
  // not something to invent a routine for.
  if (!profile) return [];

  const journey = await createJourneyFromProfile(userId, profile);

  // Old recommendations and intentions were written before journeys existed and
  // carry a NULL journeyId. Attaching them here keeps a person's history intact
  // rather than appearing to start from scratch on the day they were migrated.
  await Promise.all([
    prisma.recommendation.updateMany({
      where: { userId, journeyId: null },
      data: { journeyId: journey.id },
    }),
    prisma.travelIntention.updateMany({
      where: { userId, journeyId: null },
      data: { journeyId: journey.id },
    }),
  ]);

  return [journey];
}

/** Builds the first journey from a legacy travel profile. */
async function createJourneyFromProfile(
  userId: string,
  profile: TravelProfile
): Promise<Journey> {
  return prisma.journey.create({
    data: {
      userId,
      label: defaultLabelFor(profile.destinationType, profile.usualDeparture),
      originArea: profile.homeArea,
      destinationArea: profile.destinationArea,
      destinationType: profile.destinationType,
      usualDeparture: profile.usualDeparture,
      requiredArrival: profile.requiredArrival,
      typicalJourneyMinutes: profile.typicalJourneyMinutes,
      travelDays: profile.travelDays,
      isFlexible: profile.isFlexible,
      flexibilityMinutes: profile.flexibilityMinutes,
      willingToLeaveEarlier: profile.willingToLeaveEarlier,
      willingToLeaveLater: profile.willingToLeaveLater,
      mode: profile.primaryMode,
      sortOrder: 0,
    },
  });
}

/**
 * A sensible name when the person does not supply one.
 *
 * Uses the time of day rather than the destination alone, so the two halves of
 * a commute do not both end up called "Work".
 */
export function defaultLabelFor(
  destinationType: TravelProfile["destinationType"],
  departure: string
): string {
  const hour = Number(departure.slice(0, 2));
  const partOfDay =
    hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : hour < 21 ? "Evening" : "Night";

  const destination =
    destinationType === "WORK"
      ? "commute"
      : destinationType === "COLLEGE"
        ? "college trip"
        : destinationType === "SCHOOL"
          ? "school run"
          : "trip";

  return `${partOfDay} ${destination}`;
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Every routine, in the person's chosen order. */
export async function listJourneys(userId: string): Promise<Journey[]> {
  return ensureJourneys(userId);
}

/**
 * The routines that actually run on a given date.
 *
 * A paused journey and a journey that does not run on this weekday are both
 * excluded — there is no point recommending a departure for a trip that is not
 * happening, and doing so is how a product starts to feel like it is not
 * listening.
 */
export async function journeysForDate(userId: string, date: Date): Promise<Journey[]> {
  const all = await ensureJourneys(userId);
  const dayCode = dayCodeFor(date);

  return all.filter((journey) => journey.isActive && journey.travelDays.includes(dayCode));
}

/** One routine, but only if it belongs to this person. */
export async function getOwnedJourney(
  userId: string,
  journeyId: string
): Promise<Journey | null> {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  // Checked rather than filtered in the query so that "not yours" and "does not
  // exist" are indistinguishable to the caller. A 404 that differs from a 403
  // tells an attacker which ids are real.
  if (!journey || journey.userId !== userId) return null;

  return journey;
}

/* -------------------------------------------------------------------------- */
/*  Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface JourneyInput {
  label?: string;
  originArea: string;
  originLat?: number | null;
  originLng?: number | null;
  destinationArea: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
  destinationType: TravelProfile["destinationType"];
  usualDeparture: string;
  requiredArrival: string;
  typicalJourneyMinutes: number;
  travelDays: string[];
  isFlexible: boolean;
  flexibilityMinutes: number;
  willingToLeaveEarlier: boolean;
  willingToLeaveLater: boolean;
  mode: TravelProfile["primaryMode"];
}

export class JourneyLimitError extends Error {
  constructor() {
    super(
      `You can have up to ${MAX_JOURNEYS_PER_USER} saved journeys. Delete one you no longer use to add another.`
    );
    this.name = "JourneyLimitError";
  }
}

export async function createJourney(
  userId: string,
  input: JourneyInput
): Promise<Journey> {
  const count = await prisma.journey.count({ where: { userId } });
  if (count >= MAX_JOURNEYS_PER_USER) throw new JourneyLimitError();

  return prisma.journey.create({
    data: {
      userId,
      label: input.label?.trim() || defaultLabelFor(input.destinationType, input.usualDeparture),
      originArea: input.originArea,
      originLat: input.originLat ?? null,
      originLng: input.originLng ?? null,
      destinationArea: input.destinationArea,
      destinationLat: input.destinationLat ?? null,
      destinationLng: input.destinationLng ?? null,
      destinationType: input.destinationType,
      usualDeparture: input.usualDeparture,
      requiredArrival: input.requiredArrival,
      typicalJourneyMinutes: input.typicalJourneyMinutes,
      travelDays: input.travelDays,
      isFlexible: input.isFlexible,
      // A person who is not flexible has no flexibility window. Normalising on
      // write means the engine never has to second-guess the stored data.
      flexibilityMinutes: input.isFlexible ? input.flexibilityMinutes : 0,
      willingToLeaveEarlier: input.willingToLeaveEarlier,
      willingToLeaveLater: input.willingToLeaveLater,
      mode: input.mode,
      sortOrder: count,
    },
  });
}

export async function updateJourney(
  userId: string,
  journeyId: string,
  input: JourneyInput
): Promise<Journey | null> {
  const owned = await getOwnedJourney(userId, journeyId);
  if (!owned) return null;

  return prisma.journey.update({
    where: { id: journeyId },
    data: {
      label: input.label?.trim() || owned.label,
      originArea: input.originArea,
      originLat: input.originLat ?? null,
      originLng: input.originLng ?? null,
      destinationArea: input.destinationArea,
      destinationLat: input.destinationLat ?? null,
      destinationLng: input.destinationLng ?? null,
      destinationType: input.destinationType,
      usualDeparture: input.usualDeparture,
      requiredArrival: input.requiredArrival,
      typicalJourneyMinutes: input.typicalJourneyMinutes,
      travelDays: input.travelDays,
      isFlexible: input.isFlexible,
      flexibilityMinutes: input.isFlexible ? input.flexibilityMinutes : 0,
      willingToLeaveEarlier: input.willingToLeaveEarlier,
      willingToLeaveLater: input.willingToLeaveLater,
      mode: input.mode,
    },
  });
}

/**
 * Deletes a routine and everything derived from it.
 *
 * The recommendations and intentions cascade away with it, which is the right
 * behaviour: they describe a trip that no longer exists. The reward points
 * already earned from following them do NOT, because those were earned and are
 * recorded in the ledger, which never references a journey.
 */
export async function deleteJourney(userId: string, journeyId: string): Promise<boolean> {
  const owned = await getOwnedJourney(userId, journeyId);
  if (!owned) return false;

  await prisma.journey.delete({ where: { id: journeyId } });
  return true;
}

/** Pauses or resumes a routine without losing its history. */
export async function setJourneyActive(
  userId: string,
  journeyId: string,
  isActive: boolean
): Promise<Journey | null> {
  const owned = await getOwnedJourney(userId, journeyId);
  if (!owned) return null;

  return prisma.journey.update({ where: { id: journeyId }, data: { isActive } });
}

/**
 * Applies a new display order.
 *
 * Ids the person does not own are ignored rather than rejected, and any routine
 * missing from the list keeps its place at the end. A reorder is a cosmetic
 * action and should never fail loudly because a stale tab sent an id that has
 * since been deleted.
 */
export async function reorderJourneys(
  userId: string,
  orderedIds: string[]
): Promise<Journey[]> {
  const owned = await prisma.journey.findMany({
    where: { userId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((journey) => journey.id));

  const updates = orderedIds
    .filter((id) => ownedIds.has(id))
    .map((id, index) =>
      prisma.journey.update({ where: { id }, data: { sortOrder: index } })
    );

  // One transaction: a half-applied order is worse than none at all.
  if (updates.length > 0) await prisma.$transaction(updates);

  return listJourneys(userId);
}

/* -------------------------------------------------------------------------- */
/*  Choosing which routine a request is about                                  */
/* -------------------------------------------------------------------------- */

/**
 * The routine the assistant should assume a person means.
 *
 * WHY THIS GUESS EXISTS
 * "I'll leave late tomorrow" does not say which trip. Asking "which journey?"
 * before every single sentence would make the assistant tiresome, so it picks
 * the most likely one and — importantly — the confirmation card always NAMES
 * the routine it is about, so a wrong guess is visible before anything is saved.
 * Nothing is ever written on the strength of this function alone.
 *
 * The order of preference:
 *   1. The next routine still to depart today.
 *   2. If today's are all in the past, the first one today (they are probably
 *      talking about tomorrow's version of their morning trip).
 *   3. Any routine at all, for someone whose routines do not run today.
 *
 * @param minutesNow Minutes since midnight, in the app's timezone.
 */
export async function assumedJourney(
  userId: string,
  date: Date,
  minutesNow: number
): Promise<Journey | null> {
  const today = await journeysForDate(userId, date);

  if (today.length > 0) {
    const toMinutes = (time: string) =>
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

    const upcoming = today
      .filter((journey) => toMinutes(journey.usualDeparture) >= minutesNow)
      .sort((a, b) => toMinutes(a.usualDeparture) - toMinutes(b.usualDeparture));

    if (upcoming.length > 0) return upcoming[0];

    return [...today].sort(
      (a, b) => toMinutes(a.usualDeparture) - toMinutes(b.usualDeparture)
    )[0];
  }

  const all = await ensureJourneys(userId);
  return all.find((journey) => journey.isActive) ?? all[0] ?? null;
}
