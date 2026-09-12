import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import {
  JourneyLimitError,
  createJourney,
  listJourneys,
} from "@/lib/journeys/journey-service";
import { fieldErrorsFrom, journeySchema } from "@/lib/validation";

/**
 * The signed-in person's recurring journeys.
 *
 *   GET  /api/journeys  -> { journeys }
 *   POST /api/journeys  -> { journey }    creates a new one
 *
 * Every route in this folder resolves the journey through the service layer,
 * which checks ownership. No route here ever queries a journey by id alone.
 */

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    return NextResponse.json({ journeys: await listJourneys(session.userId) });
  } catch (error) {
    console.error("[journeys GET] failed:", error);
    return NextResponse.json(
      { error: "Could not load your journeys." },
      { status: 500 }
    );
  }
}

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

  const parsed = journeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please check the highlighted fields.",
        fieldErrors: fieldErrorsFrom(parsed.error),
      },
      { status: 400 }
    );
  }

  try {
    const journey = await createJourney(session.userId, parsed.data);
    return NextResponse.json({ journey }, { status: 201 });
  } catch (error) {
    // A limit is a rule the person can act on, not a server fault, so it gets
    // its own status and its own message rather than a generic 500.
    if (error instanceof JourneyLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    console.error("[journeys POST] failed:", error);
    return NextResponse.json(
      { error: "We could not save this journey right now. Please try again." },
      { status: 500 }
    );
  }
}
