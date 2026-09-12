import type { RewardCatalogItem } from "@prisma/client";
import { randomBytes } from "node:crypto";

import type { CityCode } from "@/lib/cities";
import { getCityConfig } from "@/lib/city-config";
import { prisma } from "@/lib/db";
import { spendPoints } from "@/lib/rewards/ledger";

/**
 * The rewards catalogue.
 *
 * ========================= WHAT A REWARD ACTUALLY IS ========================
 * CityFlow AI HAS NO PAYMENT OR PARTNER INTEGRATION. Redeeming produces a
 * voucher reference and a database row. No money moves, no partner is notified,
 * and no discount is guaranteed by anybody.
 *
 * That is stated on the rewards screen, in plain words, above the catalogue —
 * not in a footnote. An academic project that implied it had commercial
 * arrangements with fuel stations would be lying to its users, and the fact
 * that the lie is convenient is exactly why it has to be refused.
 *
 * What the mechanism DOES demonstrate honestly is the part that is real: a
 * working points ledger, a redemption flow that cannot go negative or double
 * spend, and the incentive design a city would plug its own partners into.
 * ============================================================================
 */

/**
 * The starting catalogue for a city.
 *
 * Seeded lazily on first view, for the same reason journeys are migrated
 * lazily: a catalogue that only exists if somebody remembered to run a script
 * is a catalogue that will be empty during a demonstration. An administrator
 * can edit, deactivate or replace any of these afterwards.
 */
const STARTER_CATALOGUE: Array<
  Pick<
    RewardCatalogItem,
    "title" | "description" | "category" | "pointsCost" | "partnerName"
  >
> = [
  {
    title: "Two hours of free public parking",
    description:
      "A reference code for two hours in a municipal parking facility. Sample reward — no parking operator is connected to this system.",
    category: "PARKING",
    pointsCost: 300,
    partnerName: "Municipal Parking Authority",
  },
  {
    title: "₹100 off fuel",
    description:
      "A reference code for a fuel discount. Sample reward — no fuel retailer is connected to this system.",
    category: "FUEL",
    pointsCost: 500,
    partnerName: "City Fuel Partners",
  },
  {
    title: "One week of metro travel credit",
    description:
      "A reference code for transit credit. Sample reward — no transit operator is connected to this system.",
    category: "TRANSIT",
    pointsCost: 800,
    partnerName: "City Metro",
  },
  {
    title: "Free coffee at a partner café",
    description:
      "A reference code for a hot drink. Sample reward — no café is connected to this system.",
    category: "FOOD",
    pointsCost: 150,
    partnerName: "Local cafés",
  },
  {
    title: "Plant a tree in your name",
    description:
      "The city's urban greening programme plants a sapling and records your CityFlow ID against it. Sample reward — no greening programme is connected to this system.",
    category: "CIVIC",
    pointsCost: 400,
    partnerName: "Urban Greening Programme",
  },
  {
    title: "Priority pothole reporting badge",
    description:
      "Marks your road reports for earlier municipal review for 30 days. Sample reward — this does not currently change how reports are prioritised.",
    category: "CIVIC",
    pointsCost: 250,
    partnerName: null,
  },
];

/** Every active reward for a city, seeding the starter set on first use. */
export async function listCatalogue(cityCode: CityCode): Promise<RewardCatalogItem[]> {
  const existing = await prisma.rewardCatalogItem.findMany({
    where: { isActive: true, OR: [{ cityCode }, { cityCode: null }] },
    orderBy: { pointsCost: "asc" },
  });

  if (existing.length > 0) return existing;

  // `createMany` with skipDuplicates so two people opening the page at the same
  // moment cannot produce two catalogues.
  await prisma.rewardCatalogItem.createMany({
    data: STARTER_CATALOGUE.map((item) => ({ ...item, cityCode })),
    skipDuplicates: true,
  });

  return prisma.rewardCatalogItem.findMany({
    where: { isActive: true, OR: [{ cityCode }, { cityCode: null }] },
    orderBy: { pointsCost: "asc" },
  });
}

export interface RedeemResult {
  ok: boolean;
  error?: string;
  voucherCode?: string;
  expiresAt?: Date;
  balance?: number;
}

/**
 * Exchanges points for a catalogue item.
 *
 * EVERYTHING HAPPENS IN ONE TRANSACTION.
 * The balance check, the debit, the ledger entry, the stock decrement and the
 * redemption row either all succeed or none of them do. Without that, a failure
 * halfway through produces a person who has paid for a voucher that does not
 * exist — or, worse, holds one they did not pay for.
 */
export async function redeem(
  userId: string,
  itemId: string,
  cityCode: CityCode
): Promise<RedeemResult> {
  const config = await getCityConfig(cityCode);

  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.rewardCatalogItem.findUnique({ where: { id: itemId } });

      if (!item || !item.isActive) {
        return { ok: false, error: "That reward is no longer available." };
      }

      if (item.stock !== null && item.stock <= 0) {
        return { ok: false, error: "That reward has run out." };
      }

      const spend = await spendPoints(
        tx,
        userId,
        item.pointsCost,
        `Redeemed: ${item.title}`
      );

      if (!spend.ok) {
        return { ok: false, error: spend.error, balance: spend.balance };
      }

      if (item.stock !== null) {
        await tx.rewardCatalogItem.update({
          where: { id: item.id },
          data: { stock: { decrement: 1 } },
        });
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + config.voucherValidityDays);

      const redemption = await tx.rewardRedemption.create({
        data: {
          userId,
          itemId: item.id,
          pointsSpent: item.pointsCost,
          voucherCode: generateVoucherCode(),
          expiresAt,
        },
      });

      return {
        ok: true,
        voucherCode: redemption.voucherCode,
        expiresAt: redemption.expiresAt,
        balance: spend.balance,
      };
    });
  } catch (error) {
    console.error("[rewards redeem] failed:", error);
    return { ok: false, error: "We could not complete this redemption. Please try again." };
  }
}

/**
 * A voucher reference, e.g. "CF-4K7P-2XQA".
 *
 * Uses crypto randomness rather than `Math.random()` or a counter. The code is
 * the only thing distinguishing one redemption from another, so a guessable one
 * would let somebody present a voucher they never earned. Ambiguous characters
 * (0/O, 1/I) are excluded because people read these aloud and type them in.
 */
function generateVoucherCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);

  const block = (start: number) =>
    Array.from(bytes.subarray(start, start + 4))
      .map((byte) => alphabet[byte % alphabet.length])
      .join("");

  return `CF-${block(0)}-${block(4)}`;
}

/** A person's redemption history, newest first. */
export async function listRedemptions(userId: string, take = 20) {
  return prisma.rewardRedemption.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    include: { item: { select: { title: true, category: true, partnerName: true } } },
  });
}

/** Points history, newest first. */
export async function listTransactions(userId: string, take = 30) {
  return prisma.rewardTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
