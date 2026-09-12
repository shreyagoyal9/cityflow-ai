import { SignJWT, jwtVerify } from "jose";

import { getAuthSecret } from "@/lib/env";

/**
 * Signed session tokens.
 *
 * We use `jose` (not `jsonwebtoken`) because it works in BOTH runtimes Next.js
 * uses: the Node.js runtime for API routes and the Edge runtime for middleware.
 */

/**
 * The three portals, as they appear in a session.
 *
 * Mirrors the `UserRole` enum in the Prisma schema. It is redeclared here
 * rather than imported because this module runs in the EDGE runtime, where the
 * Prisma client cannot be loaded at all.
 */
export type SessionRole = "USER" | "ADMIN" | "MUNICIPAL";

/** Every role that is a valid session role, for runtime narrowing. */
const SESSION_ROLES: readonly SessionRole[] = ["USER", "ADMIN", "MUNICIPAL"];

/** What we store inside the login cookie. Deliberately tiny — no personal data. */
export interface SessionPayload {
  /** Internal user id (database primary key). */
  userId: string;
  /** Anonymous public ID, e.g. "CF-8X42K91". */
  cityflowId: string;
  /**
   * "USER" for commuters, "ADMIN" for the Admin Portal, "MUNICIPAL" for the
   * Municipal Dashboard. The three are mutually exclusive by design: a
   * municipal officer has no access to commuter data or demand analytics.
   */
  role: SessionRole;
}

/** How long a login lasts before the user has to sign in again. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const ALGORITHM = "HS256";

/** Creates a signed session token. */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({
    cityflowId: payload.cityflowId,
    role: payload.role,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(payload.userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .sign(getAuthSecret());
}

/**
 * Verifies a session token.
 * Returns null for anything invalid: bad signature, expired, tampered, missing.
 * Callers should treat null as "not logged in" — never as an error to show.
 */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), {
      algorithms: [ALGORITHM],
    });

    const userId = payload.sub;
    const cityflowId = payload.cityflowId;

    if (typeof userId !== "string" || typeof cityflowId !== "string") {
      return null;
    }

    // Checked against the allow-list rather than cast, so a tampered or
    // out-of-date cookie carrying an unknown role is rejected as "not logged
    // in" instead of being trusted.
    const role = SESSION_ROLES.find((candidate) => candidate === payload.role);

    if (!role) return null;

    return { userId, cityflowId, role };
  } catch {
    return null;
  }
}
