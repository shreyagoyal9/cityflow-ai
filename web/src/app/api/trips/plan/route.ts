import { NextResponse } from "next/server";

import {
  appDateOnly,
  appLocalDate,
  appMinutesSinceMidnight,
} from "@/lib/app-time";
import { getSession } from "@/lib/auth/session";
import { getCity } from "@/lib/cities";
import { prisma } from "@/lib/db";
import { demandAtFor, loadDemandContext } from "@/lib/demand/aggregate";
import { planTrip, tripStripRange } from "@/lib/demand/trip-plan";
import { buildAdjustedCurve } from "@/lib/demand/aggregate";
import { rateLimit } from "@/lib/rate-limit";
import { fieldErrorsFrom, tripPlanSchema } from "@/lib/validation";

/**
 * POST /api/trips/plan
 *
 * Works out when to leave for a one-off trip, and stores the answer.
 *
 * WHY IT IS STORED
 * The same reason recommendations are: so "why did it tell me that?" remains
 * answerable with the actual numbers the person saw, rather than a sentence
 * re-derived from a curve that has since moved.
 *
 * WHY IT IS RATE LIMITED
 * This endpoint runs the demand engine across a four-hour window on every call
 * and writes a row each time. That is cheap once and expensive in a loop.
 */

export const runtime = "nodejs";

/** Generous for a person, tight enough that a script gets nowhere. */
const RATE_LIMIT_PER_MINUTE = 20;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rate = rateLimit(`trip-plan:${session.userId}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "You are planning trips very quickly. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = tripPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please check the highlighted fields.",
        fieldErrors: fieldErrorsFrom(parsed.error),
      },
      { status: 400 }
    );
  }

  const data = parsed.data;

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { cityCode: true },
    });
    const city = getCity(user?.cityCode);

    // The date the person chose, as a date-only value and as a local Date the
    // demand model can read a weekday from.
    const travelDate = new Date(`${data.travelDate}T00:00:00.000Z`);
    const localDate = new Date(
      Number(data.travelDate.slice(0, 4)),
      Number(data.travelDate.slice(5, 7)) - 1,
      Number(data.travelDate.slice(8, 10))
    );

    const isToday = data.travelDate === toDateKey(appDateOnly());

    const context = await loadDemandContext(city.code, travelDate, localDate);

    const plan = planTrip({
      demandAt: demandAtFor(context),
      requiredArrival: data.requiredArrival,
      typicalJourneyMinutes: data.typicalJourneyMinutes,
      tripType: data.tripType,
      // A departure time in the past is not a plan. On a future date every slot
      // is still open.
      earliestDepartureMinutes: isToday ? appMinutesSinceMidnight() : null,
    });

    const stored = await prisma.tripPlan.create({
      data: {
        userId: session.userId,
        cityCode: city.code,
        originArea: data.originArea,
        destinationArea: data.destinationArea,
        travelDate,
        requiredArrival: data.requiredArrival,
        typicalJourneyMinutes: data.typicalJourneyMinutes,
        mode: data.mode,
        tripType: data.tripType,
        recommendedDeparture: plan.recommendedDeparture,
        estimatedArrival: plan.estimatedArrival,
        demandAtRecommended: plan.demandAtRecommended,
        estimatedJourneyMinutes: plan.estimatedJourneyMinutes,
        confidenceScore: plan.confidenceScore,
        reason: plan.reason,
      },
    });

    const strip = tripStripRange(plan.recommendedDeparture);

    return NextResponse.json({
      tripPlan: stored,
      plan,
      cityName: city.name,
      strip: buildAdjustedCurve(context, strip.from, strip.to),
    });
  } catch (error) {
    console.error("[trip plan] failed:", error);
    return NextResponse.json(
      { error: "We could not plan this trip right now. Please try again." },
      { status: 500 }
    );
  }
}

/** YYYY-MM-DD from a date-only value stored in UTC. */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
