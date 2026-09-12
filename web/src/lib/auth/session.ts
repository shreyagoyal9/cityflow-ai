import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import {
  SESSION_MAX_AGE_SECONDS,
  type SessionPayload,
  type SessionRole,
  createSessionToken,
  verifySessionToken,
} from "@/lib/auth/jwt";

/**
 * Server-side session helpers.
 *
 * The session lives in an httpOnly cookie, which means JavaScript running in
 * the browser cannot read it. That protects the token from XSS-style theft.
 */

// Re-exported so callers can `import { SESSION_COOKIE_NAME } from "@/lib/auth/session"`.
export { SESSION_COOKIE_NAME };

/** Writes the login cookie. Called after a successful sign-up or login. */
export async function startSession(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true, // not readable by browser JavaScript
    sameSite: "lax", // sent on normal navigation, blocked on cross-site POSTs
    secure: process.env.NODE_ENV === "production", // HTTPS-only in production
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Clears the login cookie. Called on logout. */
export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

/**
 * Reads and verifies the session from the incoming request cookies.
 * Returns null when nobody is logged in. Does NOT hit the database.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

/** Shape of the logged-in user as the UI needs it. Never includes the password hash. */
export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  cityflowId: string;
  cityCode: string | null;
  onboardingCompleted: boolean;
  role: SessionRole;
}

/**
 * Loads the full user record for the current session.
 *
 * Returns null when there is no valid session, or when the session points at a
 * user that no longer exists (for example after the account was deleted).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      cityflowId: true,
      cityCode: true,
      onboardingCompleted: true,
      role: true,
    },
  });

  return user;
}
