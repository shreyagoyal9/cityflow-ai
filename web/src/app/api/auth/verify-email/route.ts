import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { consumeToken, explainTokenFailure, issueToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { sendEmail, verificationEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Email verification.
 *
 *   POST /api/auth/verify-email            with { token }  — confirm
 *   POST /api/auth/verify-email?resend=1                   — send a new link
 *
 * WHY SIGN-IN IS NOT BLOCKED ON THIS
 * CityFlow AI has no email provider configured by default, and a person who
 * signs up on a deployment without one would be locked out of an account they
 * just created through no fault of their own. Verification therefore confirms
 * that we can REACH somebody — which is what makes password reset trustworthy —
 * rather than acting as a gate on using the product.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = new URL(request.url);

  /* ------------------------------------------------------------- resend */
  if (url.searchParams.get("resend") === "1") {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const rate = rateLimit(`verify-resend:${session.userId}`, 3, 15 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: `Please wait ${Math.ceil(rate.retryAfterSeconds / 60)} minutes before requesting another link.`,
        },
        { status: 429 }
      );
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, emailVerifiedAt: true },
      });

      if (!user) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }

      if (user.emailVerifiedAt) {
        return NextResponse.json({ message: "Your email is already confirmed." });
      }

      const token = await issueToken(user.id, "EMAIL_VERIFICATION");
      await sendEmail(verificationEmail(user.email, token));

      return NextResponse.json({
        message: "A new confirmation link is on its way. Check your inbox and spam folder.",
      });
    } catch (error) {
      console.error("[verify-email resend] failed:", error);
      return NextResponse.json(
        { error: "We could not send that link right now. Please try again." },
        { status: 500 }
      );
    }
  }

  /* ------------------------------------------------------------ confirm */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const token = (body as { token?: unknown })?.token;
  if (typeof token !== "string" || token.length < 20) {
    return NextResponse.json(
      { error: "That confirmation link is not valid." },
      { status: 400 }
    );
  }

  try {
    const check = await consumeToken(token, "EMAIL_VERIFICATION");

    if (!check.ok) {
      return NextResponse.json(
        { error: explainTokenFailure(check.reason, "EMAIL_VERIFICATION") },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: check.userId },
      data: { emailVerifiedAt: new Date() },
    });

    return NextResponse.json({ message: "Your email address is confirmed. Thank you." });
  } catch (error) {
    console.error("[verify-email] failed:", error);
    return NextResponse.json(
      { error: "We could not confirm your email right now. Please try again." },
      { status: 500 }
    );
  }
}
