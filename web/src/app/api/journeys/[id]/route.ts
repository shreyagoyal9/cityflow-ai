import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import {
  deleteJourney,
  getOwnedJourney,
  setJourneyActive,
  updateJourney,
} from "@/lib/journeys/journey-service";
import {
  fieldErrorsFrom,
  journeyActiveSchema,
  journeySchema,
} from "@/lib/validation";

/**
 * One recurring journey.
 *
 *   GET    /api/journeys/:id  -> { journey }
 *   PUT    /api/journeys/:id  -> { journey }   full update
 *   PATCH  /api/journeys/:id  -> { journey }   pause or resume only
 *   DELETE /api/journeys/:id  -> { deleted: true }
 *
 * A journey that does not belong to the caller is reported as 404, not 403.
 * A 403 confirms the id exists, which is exactly what someone probing for other
 * people's records is trying to learn.
 */

export const runtime = "nodejs";

const NOT_FOUND = { error: "That journey was not found." };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const journey = await getOwnedJourney(session.userId, id);
    if (!journey) return NextResponse.json(NOT_FOUND, { status: 404 });

    return NextResponse.json({ journey });
  } catch (error) {
    console.error("[journey GET] failed:", error);
    return NextResponse.json({ error: "Could not load this journey." }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

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
    const journey = await updateJourney(session.userId, id, parsed.data);
    if (!journey) return NextResponse.json(NOT_FOUND, { status: 404 });

    return NextResponse.json({ journey });
  } catch (error) {
    console.error("[journey PUT] failed:", error);
    return NextResponse.json(
      { error: "We could not save your changes right now. Please try again." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = journeyActiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const journey = await setJourneyActive(session.userId, id, parsed.data.isActive);
    if (!journey) return NextResponse.json(NOT_FOUND, { status: 404 });

    return NextResponse.json({ journey });
  } catch (error) {
    console.error("[journey PATCH] failed:", error);
    return NextResponse.json({ error: "Could not update this journey." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const deleted = await deleteJourney(session.userId, id);
    if (!deleted) return NextResponse.json(NOT_FOUND, { status: 404 });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[journey DELETE] failed:", error);
    return NextResponse.json(
      { error: "We could not delete this journey right now." },
      { status: 500 }
    );
  }
}
