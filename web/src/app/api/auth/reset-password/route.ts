import { NextResponse } from "next/server";

import { consumeToken, explainTokenFailure } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { endSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { fieldErrorsFrom, resetPasswordSchema } from "@/lib/validation";

/**
 * POST /api/auth/reset-password
 *
 * Sets a new password using a token from the reset email.
 *
 * THREE THINGS HAPPEN, IN THIS ORDER, AND THE ORDER MATTERS
 *  1. The token is CONSUMED atomically — checked and marked used in one
 *     conditional update, so two simultaneous requests cannot both succeed.
 *  2. The password is replaced.
 *  3. Every outstanding token for this account is destroyed, and the current
 *     session cookie is cleared.
 *
 * Step 3 is the one people leave out. If somebody is resetting their password
 * because an attacker had access, leaving that attacker's other reset links
 * alive would defeat the entire exercise.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please check the highlighted fields.",
        fieldErrors: fieldErrorsFrom(parsed.error),
      },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;

  try {
    const check = await consumeToken(token, "PASSWORD_RESET");

    if (!check.ok) {
      return NextResponse.json(
        { error: explainTokenFailure(check.reason, "PASSWORD_RESET") },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: check.userId },
        data: { passwordHash: await hashPassword(password) },
      }),
      // Every other live token for this account dies with the reset.
      prisma.authToken.deleteMany({
        where: { userId: check.userId, usedAt: null },
      }),
    ]);

    // Clear any session in this browser, so the next step is a deliberate
    // sign-in with the new password rather than an ambiguous half-state.
    await endSession();

    return NextResponse.json({
      message: "Your password has been changed. You can now sign in with it.",
    });
  } catch (error) {
    console.error("[reset-password] failed:", error);
    return NextResponse.json(
      { error: "We could not reset your password right now. Please try again." },
      { status: 500 }
    );
  }
}
