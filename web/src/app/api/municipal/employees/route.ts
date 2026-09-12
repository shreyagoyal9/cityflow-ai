import { NextResponse } from "next/server";

import { getMunicipalOrNull } from "@/lib/auth/municipal";
import { getCity } from "@/lib/cities";
import {
  DuplicateStaffCodeError,
  createEmployee,
  listEmployeesWithWorkload,
} from "@/lib/municipal/municipal-service";
import { employeeSchema, fieldErrorsFrom } from "@/lib/validation";

/**
 * The municipal workforce.
 *
 *   GET  /api/municipal/employees  -> { employees }  with open workload
 *   POST /api/municipal/employees  -> { employee }
 *
 * Every route here is scoped to the signed-in user's city. There is no
 * parameter for choosing a city, on purpose: an officer works for one council.
 */

export const runtime = "nodejs";

export async function GET() {
  const user = await getMunicipalOrNull();
  if (!user) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  try {
    const employees = await listEmployeesWithWorkload(getCity(user.cityCode).code);
    return NextResponse.json({ employees });
  } catch (error) {
    console.error("[municipal employees GET] failed:", error);
    return NextResponse.json({ error: "Could not load employees." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getMunicipalOrNull();
  if (!user) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

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
    const employee = await createEmployee(getCity(user.cityCode).code, parsed.data);
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateStaffCodeError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: { staffCode: error.message } },
        { status: 409 }
      );
    }

    console.error("[municipal employees POST] failed:", error);
    return NextResponse.json({ error: "Could not add this employee." }, { status: 500 });
  }
}
