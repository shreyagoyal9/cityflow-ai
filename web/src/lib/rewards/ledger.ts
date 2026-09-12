import type { Prisma, RewardKind, UserRewards } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * The points ledger.
 *
 * ============================== THE RULES ===================================
 * 1. `reward_transactions` is the SOURCE OF TRUTH. `user_rewards` is a cached
 *    total. Any disputed balance can be recomputed from the ledger, which is
 *    the minimum standard for anything that behaves like currency.
 *
 * 2. Both are written inside ONE database transaction, so they cannot drift.
 *
 * 3. Entries are APPEND-ONLY. A mistake is corrected by writing a compensating
 *    ADJUSTMENT entry with a reason, never by editing or deleting history.
 *
 * 4. Awards are IDEMPOTENT where they relate to a specific recommendation. A
 *    double-click, a retry, or two browser tabs cannot pay twice — the
 *    `pointsAwarded` flag on the recommendation is checked and set inside the
 *    same transaction as the credit.
 * ============================================================================
 *
 * WHAT POINTS ARE, AND WHAT THEY ARE NOT
 * Points recognise a contribution to smoothing the city's peak. They are not
 * money, they are not redeemable for cash, and CityFlow AI has no payment or
 * partner integration — redeeming produces a voucher reference and nothing
 * else. The rewards screens say so plainly rather than implying a commercial
 * arrangement that does not exist.
 */

/** Plain-language description of how each kind of points is earned. */
export const REWARD_KIND_LABEL: Record<RewardKind, string> = {
  FOLLOWED_RECOMMENDATION: "Followed a departure recommendation",
  CARPOOL: "Shared a vehicle",
  MODE_SWITCH: "Switched to public transport, cycling or walking",
  ROAD_REPORT: "Reported a road issue that others confirmed",
  ADJUSTMENT: "Adjustment by an administrator",
  REDEMPTION: "Redeemed a reward",
};

/** Ensures the balance row exists. New accounts start at zero. */
export async function ensureRewards(userId: string): Promise<UserRewards> {
  return prisma.userRewards.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export interface AwardArgs {
  userId: string;
  kind: RewardKind;
  points: number;
  description: string;
  /** Set for recommendation-linked awards, which makes them idempotent. */
  recommendationId?: string;
}

export interface AwardResult {
  awarded: boolean;
  points: number;
  balance: number;
  /** Set when nothing was awarded, saying why. */
  reason?: string;
}

/**
 * Credits points.
 *
 * Returns `awarded: false` rather than throwing when the award was already
 * made — a repeat is a normal event (a retry, a second tab), not an error, and
 * making the caller handle an exception for it invites someone to swallow it.
 */
export async function awardPoints(args: AwardArgs): Promise<AwardResult> {
  const { userId, kind, points, description, recommendationId } = args;

  if (points <= 0) {
    return { awarded: false, points: 0, balance: 0, reason: "Nothing to award." };
  }

  return prisma.$transaction(async (tx) => {
    // ------------------------------------------------- idempotency check
    if (recommendationId) {
      const recommendation = await tx.recommendation.findUnique({
        where: { id: recommendationId },
        select: { id: true, userId: true, pointsAwarded: true },
      });

      if (!recommendation || recommendation.userId !== userId) {
        const current = await tx.userRewards.findUnique({ where: { userId } });
        return {
          awarded: false,
          points: 0,
          balance: current?.pointsBalance ?? 0,
          reason: "That recommendation does not belong to this account.",
        };
      }

      if (recommendation.pointsAwarded) {
        const current = await tx.userRewards.findUnique({ where: { userId } });
        return {
          awarded: false,
          points: 0,
          balance: current?.pointsBalance ?? 0,
          reason: "Points for this recommendation have already been credited.",
        };
      }

      // Set INSIDE the transaction, so two concurrent requests cannot both
      // observe `false` and both credit.
      await tx.recommendation.update({
        where: { id: recommendationId },
        data: { pointsAwarded: true },
      });
    }

    const rewards = await tx.userRewards.upsert({
      where: { userId },
      create: {
        userId,
        pointsBalance: points,
        lifetimePoints: points,
      },
      update: {
        pointsBalance: { increment: points },
        lifetimePoints: { increment: points },
      },
    });

    await tx.rewardTransaction.create({
      data: {
        userId,
        kind,
        points,
        description,
        recommendationId: recommendationId ?? null,
        balanceAfter: rewards.pointsBalance,
      },
    });

    return { awarded: true, points, balance: rewards.pointsBalance };
  });
}

export interface SpendResult {
  ok: boolean;
  balance: number;
  error?: string;
}

/**
 * Debits points for a redemption.
 *
 * The balance check and the debit happen in the same transaction, so two tabs
 * cannot both pass the check and take the balance negative.
 */
export async function spendPoints(
  tx: Prisma.TransactionClient,
  userId: string,
  points: number,
  description: string
): Promise<SpendResult> {
  const rewards = await tx.userRewards.findUnique({ where: { userId } });

  if (!rewards || rewards.pointsBalance < points) {
    return {
      ok: false,
      balance: rewards?.pointsBalance ?? 0,
      error: `You need ${points} points for this and have ${rewards?.pointsBalance ?? 0}.`,
    };
  }

  const updated = await tx.userRewards.update({
    where: { userId },
    data: {
      pointsBalance: { decrement: points },
      pointsSpent: { increment: points },
    },
  });

  await tx.rewardTransaction.create({
    data: {
      userId,
      kind: "REDEMPTION",
      // Negative, always. A ledger where spending is positive is a ledger that
      // will eventually be summed wrongly.
      points: -points,
      description,
      balanceAfter: updated.pointsBalance,
    },
  });

  return { ok: true, balance: updated.pointsBalance };
}

/** Points earned today. Used by the dashboard's "today" tile. */
export async function pointsEarnedToday(userId: string, startOfDay: Date): Promise<number> {
  const result = await prisma.rewardTransaction.aggregate({
    where: {
      userId,
      createdAt: { gte: startOfDay },
      // Spending is not earning.
      points: { gt: 0 },
    },
    _sum: { points: true },
  });

  return result._sum.points ?? 0;
}

/**
 * Recomputes the cached balance from the ledger.
 *
 * Nothing calls this in normal operation. It exists because a cached total that
 * cannot be rebuilt from its ledger is not really a ledger, and because "the
 * numbers disagree" is a question that eventually gets asked.
 */
export async function recomputeBalance(userId: string): Promise<UserRewards> {
  const entries = await prisma.rewardTransaction.findMany({
    where: { userId },
    select: { points: true },
  });

  const earned = entries.filter((e) => e.points > 0).reduce((t, e) => t + e.points, 0);
  const spent = entries.filter((e) => e.points < 0).reduce((t, e) => t - e.points, 0);

  return prisma.userRewards.upsert({
    where: { userId },
    create: {
      userId,
      pointsBalance: earned - spent,
      lifetimePoints: earned,
      pointsSpent: spent,
    },
    update: {
      pointsBalance: earned - spent,
      lifetimePoints: earned,
      pointsSpent: spent,
    },
  });
}

/**
 * The leaderboard.
 *
 * PRIVACY: ranks anonymous CityFlow IDs, never names or email addresses. A
 * person can recognise their own row because they know their own ID; nobody can
 * identify anybody else's. Only people who have opted into aggregated sharing
 * appear at all.
 */
export async function leaderboard(cityCode: string, take = 10) {
  const rows = await prisma.userRewards.findMany({
    where: {
      lifetimePoints: { gt: 0 },
      user: {
        cityCode,
        privacyLevel: { not: "ANONYMOUS" },
        travelProfile: { shareAggregatedDemand: true },
      },
    },
    orderBy: { lifetimePoints: "desc" },
    take,
    select: {
      lifetimePoints: true,
      user: { select: { cityflowId: true } },
    },
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    cityflowId: row.user.cityflowId,
    lifetimePoints: row.lifetimePoints,
  }));
}
