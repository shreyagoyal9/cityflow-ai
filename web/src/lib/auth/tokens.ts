import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthTokenKind } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Single-use tokens for email verification and password reset.
 *
 * ============================== THE SECURITY ================================
 * 1. ONLY A HASH IS STORED. The token goes out in an email; the database keeps
 *    SHA-256 of it. A leaked database therefore does not hand an attacker a
 *    working password-reset link, for exactly the reason a password hash does
 *    not hand them a password.
 *
 * 2. TOKENS EXPIRE, and `usedAt` makes them single-use. A reset link forwarded
 *    to somebody, or left sitting in a mailbox for a month, cannot be replayed.
 *
 * 3. A NEW TOKEN INVALIDATES THE OLD ONES of the same kind. Otherwise every
 *    "resend" would leave another live key to the account lying around.
 *
 * 4. COMPARISON IS CONSTANT-TIME. Token lookup is by hash, so this matters less
 *    than it would for a naive scan, but the habit is worth keeping.
 *
 * 5. SHA-256 rather than bcrypt is correct HERE and would be wrong for a
 *    password. These tokens are 256 bits of cryptographic randomness, so there
 *    is no dictionary to attack and nothing for a slow hash to buy; the cost of
 *    bcrypt would only be paid by the legitimate user.
 * ============================================================================
 */

/** How long each kind of token stays valid. */
const LIFETIME_MS: Record<AuthTokenKind, number> = {
  // Long enough to survive a mailbox somebody checks in the evening.
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  // Short: a live password-reset link is the most dangerous object in the system.
  PASSWORD_RESET: 60 * 60 * 1000,
};

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a token, stores its hash and returns the PLAINTEXT for emailing.
 *
 * The plaintext is returned exactly once and is never persisted, logged by this
 * function, or recoverable afterwards.
 */
export async function issueToken(
  userId: string,
  kind: AuthTokenKind
): Promise<string> {
  // 32 bytes of CSPRNG output. base64url so it survives being pasted into a URL.
  const token = randomBytes(32).toString("base64url");

  // Any earlier token of this kind stops working the moment a new one is issued.
  await prisma.authToken.deleteMany({ where: { userId, kind, usedAt: null } });

  await prisma.authToken.create({
    data: {
      userId,
      kind,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + LIFETIME_MS[kind]),
    },
  });

  return token;
}

export type TokenCheck =
  | { ok: true; userId: string; tokenId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * Checks a token without consuming it.
 *
 * Used to decide whether a reset page should render a form at all, so somebody
 * with a stale link is told so before they type a new password twice.
 */
export async function checkToken(
  token: string,
  kind: AuthTokenKind
): Promise<TokenCheck> {
  if (!token || token.length < 20) return { ok: false, reason: "invalid" };

  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hash(token) },
  });

  if (!record || record.kind !== kind) return { ok: false, reason: "invalid" };

  // Constant-time even though the lookup was by hash — cheap, and the habit
  // stops a future refactor to a scan from quietly introducing a timing leak.
  const expected = Buffer.from(record.tokenHash);
  const actual = Buffer.from(hash(token));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "invalid" };
  }

  if (record.usedAt) return { ok: false, reason: "used" };
  if (record.expiresAt < new Date()) return { ok: false, reason: "expired" };

  return { ok: true, userId: record.userId, tokenId: record.id };
}

/**
 * Checks a token AND marks it used, atomically.
 *
 * The update is conditional on `usedAt` still being null, so two requests
 * arriving at the same moment cannot both succeed — the second one updates zero
 * rows and is rejected. Checking and then updating in two steps would leave
 * exactly that race open on the most security-sensitive path in the product.
 */
export async function consumeToken(
  token: string,
  kind: AuthTokenKind
): Promise<TokenCheck> {
  const check = await checkToken(token, kind);
  if (!check.ok) return check;

  const consumed = await prisma.authToken.updateMany({
    where: { id: check.tokenId, usedAt: null },
    data: { usedAt: new Date() },
  });

  if (consumed.count === 0) return { ok: false, reason: "used" };

  return check;
}

/** Plain-language explanation for each failure. */
export function explainTokenFailure(
  reason: "invalid" | "expired" | "used",
  kind: AuthTokenKind
): string {
  const thing = kind === "PASSWORD_RESET" ? "reset link" : "confirmation link";

  switch (reason) {
    case "expired":
      return `That ${thing} has expired. Request a new one — they are deliberately short-lived.`;
    case "used":
      return `That ${thing} has already been used. Request a new one if you still need it.`;
    case "invalid":
      return `That ${thing} is not valid. It may have been copied incompletely — check the whole link came across.`;
  }
}

/**
 * Removes expired and used tokens.
 *
 * Nothing calls this automatically: the table is tiny and correctness never
 * depends on it, because every check tests expiry and `usedAt` directly. It
 * exists so a long-running deployment can tidy up on a schedule.
 */
export async function pruneTokens(): Promise<number> {
  const result = await prisma.authToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }],
    },
  });

  return result.count;
}
