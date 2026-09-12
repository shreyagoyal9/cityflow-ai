import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { fieldErrorsFrom, savedLocationSchema } from "@/lib/validation";

/**
 * The person's saved places.
 *
 *   GET  /api/locations  -> { locations }
 *   POST /api/locations  -> { location }
 *
 * PRIVACY: this is the one table in CityFlow AI that could hold something close
 * to a home address, so it is deliberately the person's own private list.
 * Nothing here is read by demand aggregation, the Admin Portal, the Municipal
 * Dashboard or any export. It exists purely so they do not retype "Salt Lake
 * Sector 5" every time they add a journey.
 */

export const runtime = "nodejs";

/** Enough for home, work, a gym, a couple of relatives. */
const MAX_LOCATIONS = 12;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const locations = await prisma.savedLocation.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ locations });
  } catch (error) {
    console.error("[locations GET] failed:", error);
    return NextResponse.json({ error: "Could not load your places." }, { status: 500 });
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

  const parsed = savedLocationSchema.safeParse(body);
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
    const count = await prisma.savedLocation.count({ where: { userId: session.userId } });
    if (count >= MAX_LOCATIONS) {
      return NextResponse.json(
        {
          error: `You can save up to ${MAX_LOCATIONS} places. Delete one you no longer use.`,
        },
        { status: 409 }
      );
    }

    const location = await prisma.savedLocation.create({
      data: {
        userId: session.userId,
        label: parsed.data.label,
        kind: parsed.data.kind,
        area: parsed.data.area,
        lat: parsed.data.lat ?? null,
        lng: parsed.data.lng ?? null,
      },
    });

    return NextResponse.json({ location }, { status: 201 });
  } catch (error) {
    // The unique constraint is (userId, label): a second "Home" is a rename,
    // not a new place, so it gets a sentence rather than a database error.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: `You already have a place called "${parsed.data.label}". Give this one a different name.`,
          fieldErrors: { label: "You already have a place with this name." },
        },
        { status: 409 }
      );
    }

    console.error("[locations POST] failed:", error);
    return NextResponse.json({ error: "Could not save this place." }, { status: 500 });
  }
}
