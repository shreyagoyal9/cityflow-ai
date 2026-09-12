import { NextResponse } from "next/server";

import { getMunicipalOrNull } from "@/lib/auth/municipal";
import { getCity } from "@/lib/cities";
import { changeStatus } from "@/lib/municipal/municipal-service";
import { fieldErrorsFrom, roadIssueStatusSchema } from "@/lib/validation";

/**
 * POST /api/municipal/issues/:id/status
 *
 * Moves one road issue through the repair workflow.
 *
 * The transition is validated against the state machine in
 * lib/municipal/workflow.ts, and a refusal comes back as a sentence explaining
 * what to do instead — "an issue has to be verified before work is assigned" —
 * rather than a bare error. A system that only says no teaches people to work
 * around it.
 *
 * Every successful change writes an audit row naming the officer and the
 * account that made it.
 */

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getMunicipalOrNull();
  if (!user) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = roadIssueStatusSchema.safeParse(body);
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
    const result = await changeStatus({
      cityCode: getCity(user.cityCode).code,
      issueId: id,
      toStatus: data.status,
      employeeId: data.employeeId || undefined,
      dueAt: data.dueAt || undefined,
      note: data.note || undefined,
      actorUserId: user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ issue: result.issue });
  } catch (error) {
    console.error("[municipal issue status] failed:", error);
    return NextResponse.json({ error: "Could not update this issue." }, { status: 500 });
  }
}
