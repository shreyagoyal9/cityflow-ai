import { NextResponse } from "next/server";

import { issueToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { passwordResetEmail, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/validation";

/**
 * POST /api/auth/forgot-password
 *
 * ================= THE MOST IMPORTANT THING ABOUT THIS ROUTE ================
 * IT ALWAYS RETURNS THE SAME RESPONSE, whether or not the address has an
 * account.
 *
 * An endpoint that says "no account found" is an account-enumeration oracle:
 * anybody can post a list of email addresses and learn which of them are
 * registered. For an ordinary product that is a privacy leak. For a product
 * that knows people's daily travel patterns, it is considerably worse — it
 * tells an attacker which of their targets can be looked up here at all.
 *
 * So the response is identical either way, and the difference is only in
 * whether an email is actually sent.
 * ============================================================================
 */

export const runtime = "nodejs";

/** Per address, not per IP: the abuse worth stopping is mailbox flooding. */
const REQUESTS_PER_WINDOW = 3;
const WINDOW_MS = 15 * 60 * 1000;

const IDENTICAL_RESPONSE = {
  message:
    "If there is an account for that address, a password reset link is on its way. Check your inbox, and your spam folder.",
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  const email = parsed.data.email;

  const rate = rateLimit(`forgot:${email}`, REQUESTS_PER_WINDOW, WINDOW_MS);
  if (!rate.allowed) {
    // Even this is the same shape as success. A distinguishable 429 would leak
    // that somebody has been requesting resets for this address.
    return NextResponse.json(IDENTICAL_RESPONSE);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (user) {
      const token = await issueToken(user.id, "PASSWORD_RESET");
      await sendEmail(passwordResetEmail(user.email, token));
    }

    return NextResponse.json(IDENTICAL_RESPONSE);
  } catch (error) {
    // Even a genuine failure returns the neutral message. A 500 that only
    // happens for real accounts would be an enumeration oracle of its own.
    console.error("[forgot-password] failed:", error);
    return NextResponse.json(IDENTICAL_RESPONSE);
  }
}
