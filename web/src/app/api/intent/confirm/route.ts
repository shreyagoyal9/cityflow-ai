import { NextResponse } from "next/server";

import {
  appDateOnly,
  appLocalDate,
  appMinutesSinceMidnight,
} from "@/lib/app-time";
import { getSession } from "@/lib/auth/session";
import { getCity } from "@/lib/cities";
import { prisma } from "@/lib/db";
import {
  assumedJourney,
  getOwnedJourney,
} from "@/lib/journeys/journey-service";
import {
  recordAssistantMessage,
  resolveMessage,
} from "@/lib/chat/history-service";
import { applyIntention } from "@/lib/intent-service";
import { formatTime } from "@/lib/demand/time-slots";
import { fieldErrorsFrom, intentConfirmSchema } from "@/lib/validation";

/**
 * POST /api/intent/confirm
 *
 * The ONLY endpoint that turns a conversation into stored travel data.
 *
 * It is reached exclusively by the person pressing Confirm on a proposal card,
 * which means:
 *   - nothing uncertain is ever written;
 *   - the exact structured values were on screen when they agreed;
 *   - the chat text itself is never the source of truth.
 *
 * Writing here also updates the city's aggregated demand and re-runs the
 * city-wide optimiser, so the effect of this one decision is visible to
 * everybody else's recommendation immediately.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = intentConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "There is nothing to confirm.", fieldErrors: fieldErrorsFrom(parsed.error) },
      { status: 400 }
    );
  }

  try {
    const [journey, user] = await Promise.all([
      // The routine the proposal was about. The client echoes back the id it
      // was shown, so the plan is written against the routine the person
      // actually saw named on the card — not whichever one we would guess now.
      parsed.data.journeyId
        ? getOwnedJourney(session.userId, parsed.data.journeyId)
        : assumedJourney(session.userId, appLocalDate(), appMinutesSinceMidnight()),
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { cityCode: true },
      }),
    ]);

    if (!journey) {
      return NextResponse.json(
        { error: "Please set up your travel routine before confirming a plan." },
        { status: 400 }
      );
    }

    const city = getCity(user?.cityCode);

    const { messageId, journeyId: _journeyId, ...change } = parsed.data;

    const result = await applyIntention({
      userId: session.userId,
      cityCode: city.code,
      travelDate: appDateOnly(),
      localDate: appLocalDate(),
      journey,
      change,
    });

    // A short, honest sentence about what this changed for the city. It reports
    // how many OTHER recommendations moved — never who they are.
    const othersMoved = Math.max(0, result.reoptimisation.updated);

    const cityEffect =
      othersMoved > 0
        ? `Your confirmed plan changed the demand picture for ${city.name}, and ${othersMoved} other recommendation${
            othersMoved === 1 ? " was" : "s were"
          } adjusted to keep trips spread out.`
        : `Your plan is saved. It did not push any time slot over capacity, so no other recommendations needed adjusting.`;

    const confirmationText =
      result.intention.status === "CANCELLED"
        ? "Your trip has been removed from today's plan and from today's demand figures."
        : `Saved — you are planned to leave at ${formatTime(
            result.intention.updatedDeparture
          )} today.`;

    // Mark the card in the transcript as dealt with, so the history shows the
    // outcome rather than a button that no longer applies.
    if (messageId) {
      await resolveMessage(session.userId, messageId, confirmationText);
    }

    // Record what happened as its own message, so scrolling back through the
    // conversation later tells the whole story.
    const followUp = await recordAssistantMessage({
      userId: session.userId,
      text: `${confirmationText}\n\n${cityEffect}${
        result.ownRecommendationChanged
          ? "\n\nYour own recommendation was also updated — the notice is on your dashboard."
          : ""
      }`,
      proposal: null,
      requiresConfirmation: false,
    });

    return NextResponse.json({
      saved: true,
      followUp,
      intention: {
        updatedDeparture: result.intention.updatedDeparture,
        transportMode: result.intention.transportMode,
        status: result.intention.status,
      },
      confirmationText,
      cityEffect,
      ownRecommendationChanged: result.ownRecommendationChanged,
    });
  } catch (error) {
    console.error("[intent confirm] failed:", error);
    return NextResponse.json(
      { error: "We could not save your plan right now. Please try again." },
      { status: 500 }
    );
  }
}
