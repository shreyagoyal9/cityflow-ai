import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { reorderJourneys } from "@/lib/journeys/journey-service";
import { journeyReorderSchema } from "@/lib/validation";

/**
 * POST /api/journeys/reorder
 *
 * Applies a new display order for the person's journeys.
 *
 * Deliberately forgiving: ids the person does not own are ignored rather than
 * rejected, and any journey missing from the list keeps its place at the end. A
 * reorder is a cosmetic action, and failing it loudly because a stale browser
 * tab sent an id that has since been deleted would be worse than useless.
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

  const parsed = journeyReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const journeys = await reorderJourneys(session.userId, parsed.data.orderedIds);
    return NextResponse.json({ journeys });
  } catch (error) {
    console.error("[journeys reorder] failed:", error);
    return NextResponse.json({ error: "Could not save the new order." }, { status: 500 });
  }
}
