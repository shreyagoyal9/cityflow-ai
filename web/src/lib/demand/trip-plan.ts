import {
  DEMAND_LEVEL_LABEL,
  estimateJourneyMinutes,
  levelForIndex,
  type DemandLevel,
} from "@/lib/demand/demand-model";
import {
  SLOT_MINUTES,
  formatSlotLabel,
  roundToSlot,
  slotRange,
  toMinutes,
  toTimeString,
} from "@/lib/demand/time-slots";

/**
 * Planning a one-off trip.
 *
 * THE CONSTRAINT RUNS THE OTHER WAY FROM A ROUTINE.
 * A recurring journey starts from a departure time the person already has, and
 * asks whether it can move a little. A one-off trip starts from a HARD ARRIVAL
 * DEADLINE — a film at 10:30, a flight, a hospital appointment — and works
 * backwards. So:
 *
 *   - the search window is much wider, because there is no routine to protect;
 *   - the binding constraint is "do not be late", not "do not disrupt";
 *   - a buffer is added, sized by what kind of trip it is, because being ten
 *     minutes late for a coffee and ten minutes late for a flight are not the
 *     same event.
 *
 * WHAT IT WILL NOT DO
 * It will not recommend the quietest slot if that slot arrives late. Quiet
 * roads are worthless to somebody who has missed their train, and a product
 * that optimises the wrong thing here loses trust permanently.
 */

export type TripType =
  | "MEETING"
  | "FLIGHT"
  | "TRAIN"
  | "MOVIE"
  | "APPOINTMENT"
  | "EVENT"
  | "OTHER";

/**
 * Safety buffer per trip type, in minutes.
 *
 * These are not tuned parameters — they are judgements about consequence. The
 * cost of arriving early at an airport is boredom; the cost of arriving late is
 * the trip. The buffer is shown to the person and explained, never applied
 * silently.
 */
const BUFFER_MINUTES: Record<TripType, number> = {
  FLIGHT: 45,
  TRAIN: 25,
  APPOINTMENT: 15,
  MEETING: 15,
  MOVIE: 10,
  EVENT: 10,
  OTHER: 10,
};

const BUFFER_REASON: Record<TripType, string> = {
  FLIGHT: "Flights are unforgiving, so a 45-minute buffer is built in on top of the journey estimate.",
  TRAIN: "Trains do not wait, so a 25-minute buffer is built in on top of the journey estimate.",
  APPOINTMENT: "A 15-minute buffer is built in, so a slow stretch of road does not cost you the appointment.",
  MEETING: "A 15-minute buffer is built in, so traffic does not make you late.",
  MOVIE: "A 10-minute buffer is built in — enough for the adverts, not enough to waste your evening.",
  EVENT: "A 10-minute buffer is built in on top of the journey estimate.",
  OTHER: "A 10-minute buffer is built in on top of the journey estimate.",
};

/** How far before the deadline the planner is willing to look. */
const MAX_SEARCH_MINUTES = 4 * 60;

export interface TripPlanRequest {
  /** Predicted demand index (0-100) for a slot. */
  demandAt: (slotMinutes: number) => number;
  /** "HH:MM" — the time they must have arrived by. */
  requiredArrival: string;
  /** Their own light-traffic journey estimate, in minutes. */
  typicalJourneyMinutes: number;
  tripType: TripType;
  /**
   * Minutes since midnight right now, when the trip is today. Slots already in
   * the past are not offered. Null when the trip is on a future date.
   */
  earliestDepartureMinutes: number | null;
}

export interface TripOption {
  minutes: number;
  time: string;
  label: string;
  demandIndex: number;
  demandLevel: DemandLevel;
  demandLabel: string;
  estimatedJourneyMinutes: number;
  estimatedArrival: string;
  /** Minutes to spare before the deadline, after the journey estimate. */
  slackMinutes: number;
  arrivesInTime: boolean;
  isRecommended: boolean;
}

export interface TripPlanResult {
  recommendedDeparture: string;
  estimatedArrival: string;
  estimatedJourneyMinutes: number;
  demandAtRecommended: number;
  demandLevel: DemandLevel;
  demandLabel: string;
  /** 0-100. See `scoreConfidence`. */
  confidenceScore: number;
  reason: string;
  bufferMinutes: number;
  bufferReason: string;
  options: TripOption[];
  /** Set when nothing in the window arrives in time. */
  warning: string | null;
}

export function planTrip(request: TripPlanRequest): TripPlanResult {
  const {
    demandAt,
    requiredArrival,
    typicalJourneyMinutes,
    tripType,
    earliestDepartureMinutes,
  } = request;

  const buffer = BUFFER_MINUTES[tripType];
  const arrivalMinutes = toMinutes(requiredArrival) ?? 9 * 60;

  // The real deadline is the stated one minus the buffer.
  const effectiveDeadline = arrivalMinutes - buffer;

  // Search from four hours before the deadline up to the last slot that could
  // possibly work in free-flowing traffic.
  const latestPossible = roundToSlot(effectiveDeadline - typicalJourneyMinutes);
  const earliestSearch = latestPossible - MAX_SEARCH_MINUTES;

  const floor =
    earliestDepartureMinutes === null
      ? earliestSearch
      : Math.max(earliestSearch, roundToSlot(earliestDepartureMinutes));

  const candidates = slotRange(floor, latestPossible);

  // Nothing at all fits: the deadline is already too close.
  if (candidates.length === 0) {
    const fallback = Math.max(0, floor);
    const demandIndex = demandAt(fallback);
    const journey = estimateJourneyMinutes(typicalJourneyMinutes, demandIndex);

    return {
      recommendedDeparture: toTimeString(fallback),
      estimatedArrival: toTimeString(fallback + journey),
      estimatedJourneyMinutes: journey,
      demandAtRecommended: demandIndex,
      demandLevel: levelForIndex(demandIndex),
      demandLabel: DEMAND_LEVEL_LABEL[levelForIndex(demandIndex)],
      confidenceScore: 20,
      reason:
        "There is not enough time left to reach this arrival comfortably. The time below is the earliest you could set off, not a comfortable plan.",
      bufferMinutes: buffer,
      bufferReason: BUFFER_REASON[tripType],
      options: [],
      warning:
        "Your required arrival is too soon for this journey. Leaving immediately may still mean arriving late.",
    };
  }

  const options: TripOption[] = candidates.map((slot) => {
    const demandIndex = demandAt(slot);
    const level = levelForIndex(demandIndex);
    const journey = estimateJourneyMinutes(typicalJourneyMinutes, demandIndex);
    const arrival = slot + journey;

    return {
      minutes: slot,
      time: toTimeString(slot),
      label: formatSlotLabel(slot),
      demandIndex,
      demandLevel: level,
      demandLabel: DEMAND_LEVEL_LABEL[level],
      estimatedJourneyMinutes: journey,
      estimatedArrival: toTimeString(arrival),
      slackMinutes: effectiveDeadline - arrival,
      arrivesInTime: arrival <= effectiveDeadline,
      isRecommended: false,
    };
  });

  const viable = options.filter((option) => option.arrivesInTime);

  let warning: string | null = null;
  let searchSpace = viable;

  if (viable.length === 0) {
    warning =
      "Every departure time we looked at is predicted to arrive later than you need, once the safety buffer is included. The time below is the best of a bad set — consider a different mode, or accept arriving close to the wire.";
    searchSpace = options;
  }

  /*
    Pick the LATEST viable slot among the quietest ones.

    Two candidates matter and the tie-break is deliberate. The quietest slot is
    the one to prefer, but among slots with effectively the same demand the
    LATEST is kinder: nobody wants to sit outside a cinema for forty minutes
    because the roads were marginally emptier then. Demand is compared in bands
    of 5 index points, because the model's precision does not justify treating
    a difference of 2 as real.
  */
  const best = searchSpace.reduce((bestSoFar, option) => {
    const band = Math.floor(option.demandIndex / 5);
    const bestBand = Math.floor(bestSoFar.demandIndex / 5);

    if (band < bestBand) return option;
    if (band === bestBand && option.minutes > bestSoFar.minutes) return option;
    return bestSoFar;
  });

  const chosen = options.find((option) => option.minutes === best.minutes)!;
  chosen.isRecommended = true;

  return {
    recommendedDeparture: chosen.time,
    estimatedArrival: chosen.estimatedArrival,
    estimatedJourneyMinutes: chosen.estimatedJourneyMinutes,
    demandAtRecommended: chosen.demandIndex,
    demandLevel: chosen.demandLevel,
    demandLabel: chosen.demandLabel,
    confidenceScore: scoreConfidence(
      chosen,
      buffer,
      typicalJourneyMinutes,
      viable.length,
      options.length
    ),
    reason: explain(chosen, arrivalMinutes, buffer),
    bufferMinutes: buffer,
    bufferReason: BUFFER_REASON[tripType],
    options,
    warning,
  };
}

/**
 * How much the model trusts this answer, 0-100.
 *
 * ===================== WHY THIS IS A RATIO, NOT A SLACK ====================
 * The obvious implementation scores on `chosen.slackMinutes` — how many spare
 * minutes the recommended departure leaves. That was the first version, and it
 * was subtly wrong in a way a test caught: it scored a comfortable plan LOWER
 * than a tight one.
 *
 * The reason is that this planner deliberately prefers the LATEST of several
 * equally quiet slots, so that nobody is told to sit outside a cinema for forty
 * minutes. That tie-break drives the chosen slot's slack to nearly zero by
 * design, whatever the journey. So the slack term was not measuring how robust
 * the plan was — it was measuring the tie-break rule, and reporting low
 * confidence for plans that were in fact perfectly safe.
 *
 * What actually determines whether a model error makes somebody late is the
 * MARGIN RELATIVE TO THE JOURNEY. The margin is the safety buffer plus any
 * spare minutes; the error scale is proportional to journey length, because the
 * congestion multiplier is a percentage. A 40% underestimate costs 8 minutes on
 * a 20-minute trip and 22 on a 55-minute one — so the same 15 minutes of margin
 * is generous in the first case and thin in the second.
 *
 * Hence `margin / journey`. It is dimensionless, it is unaffected by the
 * tie-break, and it orders plans the way a person would.
 * ============================================================================
 *
 * @param buffer          The safety buffer for this trip type, in minutes.
 * @param journeyMinutes  The person's own light-traffic journey estimate.
 */
function scoreConfidence(
  chosen: TripOption,
  buffer: number,
  journeyMinutes: number,
  viableCount: number,
  totalCount: number
): number {
  let score = 75;

  if (chosen.slackMinutes < 0) {
    // The plan does not meet the deadline at all. Nothing else matters much.
    score -= 35;
  } else {
    // The buffer IS part of the margin: it was subtracted from the deadline
    // before the search, so it is real spare time, not a display nicety.
    const margin = buffer + chosen.slackMinutes;
    const ratio = margin / Math.max(1, journeyMinutes);

    if (ratio >= 0.75) score += 12;
    else if (ratio >= 0.4) score += 4;
    else if (ratio >= 0.2) score -= 6;
    else score -= 16;
  }

  // A window where almost nothing works is a fragile plan: one slow stretch of
  // road and there is no alternative left.
  const viableShare = totalCount === 0 ? 0 : viableCount / totalCount;
  if (viableShare < 0.25) score -= 15;
  else if (viableShare > 0.75) score += 5;

  // High demand is where the journey-time model is least reliable, because the
  // congestion multiplier is coarsest exactly where traffic is worst.
  if (chosen.demandIndex >= 82) score -= 15;
  else if (chosen.demandIndex >= 62) score -= 8;

  return Math.max(10, Math.min(95, score));
}

function explain(chosen: TripOption, arrivalMinutes: number, buffer: number): string {
  const arrivalLabel = formatSlotLabel(arrivalMinutes);
  const slack = Math.max(0, chosen.slackMinutes);

  const quietness =
    chosen.demandIndex >= 62
      ? `Traffic is predicted to be ${chosen.demandLabel.toLowerCase()} whichever time you choose, so this is the least bad option rather than a quiet one.`
      : `Predicted demand around this time is ${chosen.demandLabel.toLowerCase()}.`;

  return (
    `Leaving at ${chosen.label} puts your estimated arrival at ` +
    `${formatSlotLabel(toMinutes(chosen.estimatedArrival)!)}, which is ` +
    `${slack + buffer} minutes before your ${arrivalLabel} deadline once the safety ` +
    `buffer is counted. ${quietness}`
  );
}

/** The slots a compact chart should show around the recommendation. */
export function tripStripRange(recommended: string): { from: number; to: number } {
  const slot = roundToSlot(toMinutes(recommended) ?? 9 * 60);
  return { from: slot - 4 * SLOT_MINUTES, to: slot + 4 * SLOT_MINUTES };
}
