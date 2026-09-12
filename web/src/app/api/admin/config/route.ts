import { NextResponse } from "next/server";

import { getAdminOrNull } from "@/lib/auth/admin";
import { isCityCode } from "@/lib/cities";
import { getCityConfig, saveCityConfig } from "@/lib/city-config";
import { cityConfigSchema, fieldErrorsFrom } from "@/lib/validation";

/**
 * Per-city configuration.
 *
 *   GET /api/admin/config?city=delhi  -> { config }
 *   PUT /api/admin/config?city=delhi  -> { config }
 *
 * WHY THE CITY IS A QUERY PARAMETER HERE
 * Unlike the Municipal Dashboard — where an officer works for exactly one
 * council — the Admin Portal is operated by the CityFlow AI team across every
 * supported city, and the city switcher at the top of every admin page already
 * carries the choice in the URL. Taking it from the signed-in user instead
 * would make it impossible to configure a city you are not personally
 * commuting in.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await getAdminOrNull();
  if (!admin) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const cityCode = new URL(request.url).searchParams.get("city");
  if (!cityCode || !isCityCode(cityCode)) {
    return NextResponse.json({ error: "Unknown city." }, { status: 400 });
  }

  try {
    return NextResponse.json({ config: await getCityConfig(cityCode) });
  } catch (error) {
    console.error("[admin config GET] failed:", error);
    return NextResponse.json({ error: "Could not load configuration." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const admin = await getAdminOrNull();
  if (!admin) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const cityCode = new URL(request.url).searchParams.get("city");
  if (!cityCode || !isCityCode(cityCode)) {
    return NextResponse.json({ error: "Unknown city." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = cityConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please check the highlighted values.",
        fieldErrors: fieldErrorsFrom(parsed.error),
      },
      { status: 400 }
    );
  }

  try {
    await saveCityConfig(cityCode, parsed.data);

    // Returned through `getCityConfig` rather than echoing the write, so the
    // response is exactly what the rest of the product will now read.
    return NextResponse.json({ config: await getCityConfig(cityCode) });
  } catch (error) {
    console.error("[admin config PUT] failed:", error);
    return NextResponse.json(
      { error: "We could not save this configuration right now." },
      { status: 500 }
    );
  }
}
