import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getCity } from "@/lib/cities";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { redeem } from "@/lib/rewards/catalogue";
import { redeemSchema } from "@/lib/validation";

/**
 * POST /api/rewards/redeem
 *
 * Exchanges points for a catalogue item and returns the voucher reference.
 *
 * Rate limited hard. This endpoint moves a balance, and anything that moves a
 * balance is worth making tedious to hammer — a double-submit is handled by the
 * transaction, but a script firing a hundred times a second is not something to
 * leave to the database.
 */

export const runtime = "nodejs";

const REDEMPTIONS_PER_MINUTE = 5;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rate = rateLimit(`redeem:${session.userId}`, REDEMPTIONS_PER_MINUTE, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: `Please wait ${rate.retryAfterSeconds} seconds before redeeming again.`,
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = redeemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please choose a reward." }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { cityCode: true },
    });

    const result = await redeem(session.userId, parsed.data.itemId, getCity(user?.cityCode).code);

    if (!result.ok) {
      // "Not enough points" is the person's situation, not a server failure, so
      // it comes back as 400 with a message they can act on.
      return NextResponse.json({ error: result.error, balance: result.balance }, { status: 400 });
    }

    return NextResponse.json({
      voucherCode: result.voucherCode,
      expiresAt: result.expiresAt,
      balance: result.balance,
    });
  } catch (error) {
    console.error("[rewards redeem route] failed:", error);
    return NextResponse.json(
      { error: "We could not complete this redemption right now." },
      { status: 500 }
    );
  }
}
