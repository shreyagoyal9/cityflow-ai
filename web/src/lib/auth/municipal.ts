import { redirect } from "next/navigation";

import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";

/**
 * Municipal Dashboard access.
 *
 * TWO LAYERS, the same pattern the Admin Portal uses and for the same reason:
 *  1. `proxy.ts` blocks /municipal at the edge using the role inside the signed
 *     session cookie. Fast, and keeps everyone else off the route entirely.
 *  2. This helper re-checks against the DATABASE inside every municipal page
 *     and API route, because the role in a cookie is a snapshot from sign-in
 *     time. If somebody's municipal access was withdrawn an hour ago, their
 *     cookie still claims otherwise until it expires.
 *
 * WHY ADMIN IS ALLOWED THROUGH
 * Someone has to create the first employee records and configure thresholds
 * before any MUNICIPAL account exists. An admin can therefore open this portal.
 * The reverse is NOT true: a municipal officer cannot open the Admin Portal,
 * and cannot reach commuter data anywhere in the product.
 */

/** Returns the signed-in municipal user or admin, or redirects away. */
export async function requireMunicipal(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) redirect("/login?next=/municipal");

  if (user.role !== "MUNICIPAL" && user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  return user;
}

/**
 * The API-route version: returns the user, or null.
 * Callers turn null into a 403 themselves, since API routes must not redirect.
 */
export async function getMunicipalOrNull(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "MUNICIPAL" && user.role !== "ADMIN") return null;
  return user;
}
