import { NextResponse } from "next/server";

import { getMunicipalOrNull } from "@/lib/auth/municipal";
import { getCity } from "@/lib/cities";
import {
  DuplicateStaffCodeError,
  deactivateEmployee,
  updateEmployee,
} from "@/lib/municipal/municipal-service";
import { employeeSchema, fieldErrorsFrom } from "@/lib/validation";

/**
 * One employee.
 *
 *   PUT    /api/municipal/employees/:id  -> { employee }
 *   DELETE /api/municipal/employees/:id  -> { deactivated: true }
 *
 * DELETE DEACTIVATES, IT DOES NOT DELETE.
 * An employee's name appears in the audit trail of every issue they touched.
 * Removing the row would leave those records pointing at nobody, which is
 * exactly what an audit trail exists to prevent.
 */

export const runtime = "nodejs";

export async function PUT(
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

  const parsed = employeeSchema.safeParse(body);
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
    const employee = await updateEmployee(
      getCity(user.cityCode).code,
      id,
      parsed.data
    );

    if (!employee) {
      return NextResponse.json({ error: "That employee was not found." }, { status: 404 });
    }

    return NextResponse.json({ employee });
  } catch (error) {
    if (error instanceof DuplicateStaffCodeError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: { staffCode: error.message } },
        { status: 409 }
      );
    }

    console.error("[municipal employee PUT] failed:", error);
    return NextResponse.json({ error: "Could not save this employee." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getMunicipalOrNull();
  if (!user) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await deactivateEmployee(getCity(user.cityCode).code, id);

    if (!result.ok) {
      // Open work is a rule the officer can act on — reassign, then retry — so
      // it comes back as 409 with a sentence, not a generic failure.
      return NextResponse.json(
        { error: result.error, openIssues: result.openIssues },
        { status: result.openIssues ? 409 : 404 }
      );
    }

    return NextResponse.json({ deactivated: true });
  } catch (error) {
    console.error("[municipal employee DELETE] failed:", error);
    return NextResponse.json(
      { error: "Could not deactivate this employee." },
      { status: 500 }
    );
  }
}
