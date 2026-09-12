import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  accountSettingsSchema,
  fieldErrorsFrom,
  notificationSettingsSchema,
} from "@/lib/validation";

/**
 * Account and notification settings.
 *
 *   PUT /api/settings?section=account        -> { user }
 *   PUT /api/settings?section=notifications  -> { profile }
 *
 * TWO SECTIONS, ONE ROUTE, SEPARATE SCHEMAS.
 * They are saved independently because they live on different tables and fail
 * for different reasons — a rejected phone number should not discard somebody's
 * notification choices, and a form that saves everything or nothing does
 * exactly that.
 */

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const section = new URL(request.url).searchParams.get("section");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  /* ------------------------------------------------------------- account */
  if (section === "account") {
    const parsed = accountSettingsSchema.safeParse(body);
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
      const user = await prisma.user.update({
        where: { id: session.userId },
        data: {
          displayName: parsed.data.displayName || null,
          phone: parsed.data.phone || null,
          profilePictureUrl: parsed.data.profilePictureUrl || null,
          privacyLevel: parsed.data.privacyLevel,
        },
        // The password hash is never selected, here or anywhere.
        select: {
          displayName: true,
          phone: true,
          profilePictureUrl: true,
          privacyLevel: true,
        },
      });

      return NextResponse.json({ user });
    } catch (error) {
      console.error("[settings account] failed:", error);
      return NextResponse.json(
        { error: "We could not save your details right now." },
        { status: 500 }
      );
    }
  }

  /* ------------------------------------------------------- notifications */
  if (section === "notifications") {
    const parsed = notificationSettingsSchema.safeParse(body);
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
      const profile = await prisma.travelProfile.update({
        where: { userId: session.userId },
        data: parsed.data,
      });

      return NextResponse.json({ profile });
    } catch (error) {
      console.error("[settings notifications] failed:", error);
      return NextResponse.json(
        { error: "We could not save your notification choices right now." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: 'Unknown settings section. Use "account" or "notifications".' },
    { status: 400 }
  );
}
