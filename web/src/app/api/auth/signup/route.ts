import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { issueToken } from "@/lib/auth/tokens";
import { sendEmail, verificationEmail } from "@/lib/email";
import { hashPassword } from "@/lib/auth/password";
import { generateUniqueCityflowId } from "@/lib/auth/cityflow-id";
import { startSession } from "@/lib/auth/session";
import { fieldErrorsFrom, signupSchema } from "@/lib/validation";
import { isCityCode } from "@/lib/cities";

/**
 * POST /api/auth/signup
 *
 * Creates a new commuter account and logs the person in straight away.
 *
 * Request body:  { email, password, displayName?, cityCode? }
 * Success (201): { cityflowId, displayName, email }
 * Failure (400): { error, fieldErrors? }
 * Failure (409): { error } — email already registered
 */

// bcrypt and Prisma both need the full Node.js runtime (not Edge).
export const runtime = "nodejs";

export async function POST(request: Request) {
  // ---------------------------------------------------------------- 1. Parse
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // ------------------------------------------------------------- 2. Validate
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please check the highlighted fields.",
        fieldErrors: fieldErrorsFrom(parsed.error),
      },
      { status: 400 }
    );
  }

  const { email, password, displayName, cityCode } = parsed.data;

  try {
    // ------------------------------------------------ 3. Reject duplicates
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: "An account with this email already exists. Try signing in instead.",
          fieldErrors: { email: "This email is already registered" },
        },
        { status: 409 }
      );
    }

    // -------------------------------------- 4. Hash password + build identity
    const passwordHash = await hashPassword(password);

    const cityflowId = await generateUniqueCityflowId(async (candidate) => {
      const clash = await prisma.user.findUnique({
        where: { cityflowId: candidate },
        select: { id: true },
      });
      return clash !== null;
    });

    // ------------------------------------------------------- 5. Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        // An empty string from the form is stored as "no name given".
        displayName: displayName && displayName.length > 0 ? displayName : null,
        cityflowId,
        cityCode: cityCode && isCityCode(cityCode) ? cityCode.toLowerCase() : null,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        cityflowId: true,
        role: true,
      },
    });

    // --------------------------------------------------- 6. Log the user in
    await startSession({
      userId: user.id,
      cityflowId: user.cityflowId,
      role: user.role,
    });

    /*
      7. Send the confirmation email.

      AWAITED BUT NEVER ALLOWED TO FAIL THE SIGN-UP.
      Creating the account has already succeeded and the person is already
      signed in. If the mail provider is down — or, by default, not configured
      at all — throwing here would show them "we could not create your account"
      about an account that exists, and they would try again and hit the
      duplicate-email check. So the failure is logged and swallowed.

      Verification is not a gate on using CityFlow AI; it only establishes that
      we can reach somebody, which is what makes password reset trustworthy.
    */
    try {
      const token = await issueToken(user.id, "EMAIL_VERIFICATION");
      await sendEmail(verificationEmail(user.email, token));
    } catch (error) {
      console.error("[signup] confirmation email failed (account was created):", error);
    }

    return NextResponse.json(
      {
        cityflowId: user.cityflowId,
        displayName: user.displayName,
        email: user.email,
      },
      { status: 201 }
    );
  } catch (error) {
    // Never leak internal details to the browser; log them on the server instead.
    console.error("[signup] failed:", error);
    return NextResponse.json(
      {
        error:
          "We could not create your account right now. Please check your database connection and try again.",
      },
      { status: 500 }
    );
  }
}
