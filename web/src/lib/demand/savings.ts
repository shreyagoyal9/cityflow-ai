import { estimateJourneyMinutes } from "@/lib/demand/demand-model";

/**
 * Estimated time saved by departing at the recommended time.
 *
 * ======================== READ THIS BEFORE USING IT =========================
 * THIS IS A MODEL ESTIMATE. NOBODY'S JOURNEY WAS MEASURED.
 *
 * Earlier phases of CityFlow AI refused to show a "time saved" figure at all,
 * on the grounds that the system has no live traffic feed and has never timed a
 * real trip. That reasoning was sound and the risk it guarded against is real:
 * a number like "you saved 8 minutes" is remembered as a fact long after any
 * caveat next to it is forgotten.
 *
 * The figure exists now because a commuter deciding whether to reorganise their
 * morning deserves to know the expected size of the prize, and "demand index 74
 * versus 51" does not answer that question for most people. The risk is managed
 * rather than avoided:
 *
 *   1. It is derived only from values the system actually has — the person's own
 *      stated light-traffic journey time, and the demand model's congestion
 *      multiplier at each slot. Nothing is invented.
 *   2. It is returned WITH its method, so no screen can show the number without
 *      having the explanation to hand.
 *   3. It is deliberately conservative: rounded down, and reported as zero
 *      below a threshold where the model's own precision cannot support a claim.
 *   4. Every component that renders it is required to show `ESTIMATE_CAVEAT`.
 *
 * WHAT WOULD MAKE IT A MEASUREMENT
 * Recording actual departure and arrival times from people who opted in, and
 * comparing them. That is a real feature and this function is the seam where it
 * would plug in — at which point the wording changes from "estimated" to
 * "observed", and not one moment before.
 * ============================================================================
 */

/** Shown wherever an estimated saving appears. Not optional. */
export const ESTIMATE_CAVEAT =
  "Estimated from predicted demand and the journey time you gave us. No real journey was measured.";

/**
 * Below this many minutes, the difference is inside the model's own noise and
 * is reported as no meaningful saving rather than as a small one.
 */
const MIN_REPORTABLE_MINUTES = 2;

export interface SavingsEstimate {
  /** Whole minutes. Zero when the model cannot support a claim. */
  minutes: number;
  /** Journey length the model expects at the usual departure. */
  journeyAtUsual: number;
  /** Journey length the model expects at the recommended departure. */
  journeyAtRecommended: number;
  /** True when `minutes` is large enough to be worth showing. */
  isMeaningful: boolean;
  /** One sentence naming exactly where the number came from. */
  method: string;
}

/**
 * @param typicalJourneyMinutes The person's own light-traffic journey time.
 * @param demandAtUsual         Demand index (0-100) at their usual departure.
 * @param demandAtRecommended   Demand index (0-100) at the recommended departure.
 */
export function estimateSavings(
  typicalJourneyMinutes: number,
  demandAtUsual: number,
  demandAtRecommended: number
): SavingsEstimate {
  const journeyAtUsual = estimateJourneyMinutes(typicalJourneyMinutes, demandAtUsual);
  const journeyAtRecommended = estimateJourneyMinutes(
    typicalJourneyMinutes,
    demandAtRecommended
  );

  // Floored, not rounded: between overstating and understating a benefit we
  // have not measured, understating is the only honest direction to err.
  const raw = Math.floor(journeyAtUsual - journeyAtRecommended);
  const minutes = Math.max(0, raw);

  return {
    minutes,
    journeyAtUsual,
    journeyAtRecommended,
    isMeaningful: minutes >= MIN_REPORTABLE_MINUTES,
    method:
      `Your ${typicalJourneyMinutes}-minute light-traffic journey is modelled at ` +
      `${journeyAtUsual} minutes when demand is ${demandAtUsual}/100, and ` +
      `${journeyAtRecommended} minutes when demand is ${demandAtRecommended}/100.`,
  };
}

/**
 * City-wide estimated time saved, for the Admin Portal.
 *
 * Sums per-person estimates. Carries every caveat of the individual figure and
 * one more of its own: it counts only people who ACCEPTED a recommendation, so
 * it is a lower bound on modelled effect, not a claim about the city's traffic.
 */
export function aggregateSavings(
  accepted: Array<{
    typicalJourneyMinutes: number;
    demandAtUsual: number;
    demandAtRecommended: number;
  }>
): { totalMinutes: number; personHours: number; count: number } {
  const totalMinutes = accepted.reduce(
    (total, row) =>
      total +
      estimateSavings(row.typicalJourneyMinutes, row.demandAtUsual, row.demandAtRecommended)
        .minutes,
    0
  );

  return {
    totalMinutes,
    personHours: Math.round((totalMinutes / 60) * 10) / 10,
    count: accepted.length,
  };
}

/**
 * Estimated fuel not burned, in litres.
 *
 * ANOTHER ESTIMATE, AND A WEAKER ONE THAN THE TIME FIGURE.
 * It rests on two assumptions stated here rather than buried:
 *   - an idling or crawling petrol car burns roughly 0.9 litres per hour more
 *     than one moving freely, a mid-range figure from published urban driving
 *     studies;
 *   - the share of saved minutes that were vehicle minutes is supplied by the
 *     caller, because a metro passenger saves time without saving fuel.
 *
 * Neither is measured by CityFlow AI. The function returns the assumptions
 * alongside the number so the UI can show them, and the Admin Portal does.
 */
export const CONGESTION_LITRES_PER_HOUR = 0.9;

export function estimateFuelLitres(
  savedMinutes: number,
  vehicleShare: number
): { litres: number; assumptions: string[] } {
  const vehicleMinutes = savedMinutes * Math.max(0, Math.min(1, vehicleShare));
  const litres = Math.round((vehicleMinutes / 60) * CONGESTION_LITRES_PER_HOUR * 10) / 10;

  return {
    litres,
    assumptions: [
      `${CONGESTION_LITRES_PER_HOUR} litres per hour of congested running, a mid-range published figure for a petrol car.`,
      `${Math.round(vehicleShare * 100)}% of saved minutes assumed to be private-vehicle minutes, from the modes people selected.`,
      "No fuel consumption was measured. This is arithmetic on two assumptions, not an observation.",
    ],
  };
}
