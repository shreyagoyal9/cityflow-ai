import type { CityCode } from "@/lib/cities";
import { prisma } from "@/lib/db";
import {
  TRIP_WEIGHT,
  buildAdjustedCurve,
  loadDemandContext,
  type AdjustedDemandSlot,
} from "@/lib/demand/aggregate";
import { predictDemandIndex } from "@/lib/demand/demand-model";
import {
  SLOT_MINUTES,
  formatSlotLabel,
  roundToSlot,
  toMinutes,
} from "@/lib/demand/time-slots";
import { zoneKeyToLabel } from "@/lib/demand/zones";

/**
 * City-wide insight: what the day looks like, and what CityFlow AI changed.
 *
 * ============== THE COUNTERFACTUAL, AND WHY IT IS HONEST HERE ===============
 * The central claim of this product — "we smooth demand rather than moving the
 * jam" — is only believable if it can be shown. The comparison on this page is
 * built from a real pair of numbers that the system already stores for every
 * confirmed plan:
 *
 *   plannedDeparture  — the time the person's routine says they would leave
 *   updatedDeparture  — the time they actually confirmed
 *
 * So the "if nobody moved" curve is not a simulation or an invention. It is the
 * same set of real people, counted at the times they would have left. The only
 * assumption is that they would have kept their routine, which is precisely
 * what a routine is.
 *
 * WHAT IT IS STILL NOT
 * It is not a measurement of traffic. It counts CityFlow AI users' confirmed
 * departures, which are a small sample of a city's trips, scaled by TRIP_WEIGHT
 * to be visible against the modelled baseline. It says "the departures we know
 * about are more spread out than they would have been". It does not say
 * "congestion in this city fell", and the page must not either.
 * ============================================================================
 */

export interface CounterfactualSlot {
  minutes: number;
  time: string;
  label: string;
  /** Confirmed trips counted at the time people actually chose. */
  withCityflow: number;
  /** The same trips counted at the time their routine would have had them leave. */
  ifNobodyMoved: number;
}

export interface SmoothingComparison {
  slots: CounterfactualSlot[];
  /** Busiest slot's trip count in each case. */
  peakWithCityflow: number;
  peakIfNobodyMoved: number;
  peakReductionPercent: number;
  /** How many confirmed plans this is based on. */
  confirmedPlans: number;
  /** How many of those actually moved. */
  movedPlans: number;
  /** True when no new peak appeared anywhere — the claim that matters. */
  noNewPeakCreated: boolean;
  /** The window the chart covers, so the caption can name it. */
  fromLabel: string;
  toLabel: string;
}

export interface ZoneHotspot {
  zoneKey: string;
  label: string;
  trips: number;
}

export interface CityInsights {
  /** The whole day, 96 slots, as the product's adjusted demand index. */
  dayCurve: AdjustedDemandSlot[];
  /** The busiest slot of the day. */
  peakSlot: AdjustedDemandSlot | null;
  /** Modelled baseline peak, for "how much of this is us". */
  baselinePeakIndex: number;
  comparison: SmoothingComparison | null;
  hotspots: ZoneHotspot[];
  totalConfirmedTrips: number;
}

/**
 * Everything the insights page needs, in one pass.
 *
 * @param cityCode  Which city.
 * @param travelDate Date-only value matching the stored `travelDate` column.
 * @param localDate  A Date whose local fields are that date in the app timezone.
 */
export async function loadCityInsights(
  cityCode: CityCode,
  travelDate: Date,
  localDate: Date
): Promise<CityInsights> {
  const [context, intentions, zoneRows] = await Promise.all([
    loadDemandContext(cityCode, travelDate, localDate),
    prisma.travelIntention.findMany({
      where: {
        cityCode,
        travelDate,
        status: "CONFIRMED",
        countedInDemand: true,
      },
      select: { plannedDeparture: true, updatedDeparture: true },
    }),
    prisma.travelIntention.groupBy({
      by: ["originZone"],
      where: { cityCode, travelDate, status: "CONFIRMED" },
      _count: { _all: true },
      orderBy: { _count: { originZone: "desc" } },
      take: 6,
    }),
  ]);

  // The full day at 15-minute resolution.
  const dayCurve = buildAdjustedCurve(context, 0, 24 * 60 - SLOT_MINUTES);

  const peakSlot =
    dayCurve.length === 0
      ? null
      : dayCurve.reduce((worst, slot) => (slot.index > worst.index ? slot : worst));

  const baselinePeakIndex = dayCurve.reduce(
    (worst, slot) =>
      Math.max(worst, predictDemandIndex(cityCode, localDate, slot.minutes)),
    0
  );

  return {
    dayCurve,
    peakSlot,
    baselinePeakIndex,
    comparison: buildComparison(intentions),
    hotspots: zoneRows.map((row) => ({
      zoneKey: row.originZone,
      label: zoneKeyToLabel(row.originZone),
      trips: row._count._all,
    })),
    totalConfirmedTrips: intentions.length,
  };
}

/**
 * Builds the "with CityFlow AI" against "if nobody moved" comparison.
 *
 * Returns null when there is nothing to compare. An empty chart with two flat
 * lines would imply the system had been measured and found to do nothing, which
 * is a very different statement from "nobody has confirmed a plan yet".
 */
function buildComparison(
  intentions: Array<{ plannedDeparture: string; updatedDeparture: string }>
): SmoothingComparison | null {
  if (intentions.length === 0) return null;

  const withCityflow = new Map<number, number>();
  const ifNobodyMoved = new Map<number, number>();
  let movedPlans = 0;

  for (const intention of intentions) {
    const planned = roundToSlot(toMinutes(intention.plannedDeparture) ?? 0);
    const actual = roundToSlot(toMinutes(intention.updatedDeparture) ?? 0);

    ifNobodyMoved.set(planned, (ifNobodyMoved.get(planned) ?? 0) + 1);
    withCityflow.set(actual, (withCityflow.get(actual) ?? 0) + 1);

    if (planned !== actual) movedPlans += 1;
  }

  /*
    Show only the window that actually contains trips, plus a slot of margin.
    A 96-slot chart of which 8 slots are non-zero is unreadable, and padding it
    out to a full day makes the peak look smaller than it is.
  */
  const touched = [...new Set([...withCityflow.keys(), ...ifNobodyMoved.keys()])].sort(
    (a, b) => a - b
  );
  const from = Math.max(0, touched[0] - SLOT_MINUTES);
  const to = Math.min(24 * 60 - SLOT_MINUTES, touched[touched.length - 1] + SLOT_MINUTES);

  const slots: CounterfactualSlot[] = [];
  for (let minutes = from; minutes <= to; minutes += SLOT_MINUTES) {
    slots.push({
      minutes,
      time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
        minutes % 60
      ).padStart(2, "0")}`,
      label: formatSlotLabel(minutes),
      withCityflow: withCityflow.get(minutes) ?? 0,
      ifNobodyMoved: ifNobodyMoved.get(minutes) ?? 0,
    });
  }

  const peakWith = Math.max(...slots.map((slot) => slot.withCityflow));
  const peakWithout = Math.max(...slots.map((slot) => slot.ifNobodyMoved));

  return {
    slots,
    peakWithCityflow: peakWith,
    peakIfNobodyMoved: peakWithout,
    peakReductionPercent:
      peakWithout === 0 ? 0 : Math.round(((peakWithout - peakWith) / peakWithout) * 100),
    confirmedPlans: intentions.length,
    movedPlans,
    /*
      THE CLAIM THAT MATTERS.
      Demand smoothing is only smoothing if no slot ended up busier than the
      original worst slot. If one did, the peak was RELOCATED, and the page says
      so rather than reporting the headline reduction and staying quiet.
    */
    noNewPeakCreated: peakWith <= peakWithout,
    fromLabel: formatSlotLabel(from),
    toLabel: formatSlotLabel(to),
  };
}

/**
 * One confirmed trip's contribution to the demand index.
 *
 * Re-exported here so the insights page can explain the scaling to the reader
 * rather than showing a number whose units nobody can work out.
 */
export { TRIP_WEIGHT };
