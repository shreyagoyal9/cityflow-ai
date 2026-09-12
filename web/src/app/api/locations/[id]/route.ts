import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/locations/:id
 *
 * Removes one saved place. Deleting a place never touches the journeys that
 * were created from it — a journey stores its own area text, so removing the
 * shortcut cannot silently change where somebody travels.
 */

export const runtime = "nodejs";

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
    // Scoped by userId in the WHERE clause, so another person's id simply
    // deletes nothing rather than needing a separate ownership check.
    const result = await prisma.savedLocation.deleteMany({
      where: { id, userId: session.userId },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "That place was not found." }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[location DELETE] failed:", error);
    return NextResponse.json({ error: "Could not delete this place." }, { status: 500 });
  }
}
