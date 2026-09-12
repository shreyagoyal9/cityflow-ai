import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { verifySessionToken } from "@/lib/auth/jwt";

/**
 * Route protection.
 *
 * This runs BEFORE a page renders, which makes it the cheapest place to answer
 * one question: "is this person allowed here?".
 *
 * NAMING NOTE
 * In Next.js 15 this file was called `middleware.ts` and exported `middleware`.
 * Next.js 16 renamed the convention to `proxy.ts` / `proxy` to make the network
 * boundary clearer. Same job, new name.
 *
 * It deliberately only checks the SIGNATURE of the session cookie and never
 * touches the database. Every request passes through here, so it has to stay
 * fast; the full user record is loaded later, in the page itself.
 */

/** Pages that require a signed-in commuter. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/welcome",
  "/profile",
  "/onboarding",
  "/assistant",
  "/roads",
  "/participation",
  "/journeys",
  "/plan",
  "/rewards",
  "/insights",
  "/settings",
];

/** Pages that a signed-in user should not see again (they would be confusing). */
const AUTH_ONLY_PREFIXES = ["/login", "/signup"];

/**
 * The Admin Portal. Separate from the commuter portal in every sense: its own
 * route prefix, its own layout, and its own role.
 *
 * This is the fast edge check, using the role inside the signed cookie. Every
 * admin page and API route ALSO re-checks the role against the database — see
 * lib/auth/admin.ts for why both exist.
 */
const ADMIN_PREFIXES = ["/admin"];

/**
 * The Municipal Dashboard. A third portal with a third role.
 *
 * A MUNICIPAL user sees road issues, employees and repair work — and nothing
 * else. No commuter data, no demand analytics, no recommendations. That
 * separation is the point: the people who fix roads have no business reading
 * anybody's travel patterns, and the system should make that impossible rather
 * than merely discouraged.
 *
 * ADMIN is allowed through as well, because somebody has to be able to set the
 * portal up and add the first employees before any municipal account exists.
 */
const MUNICIPAL_PREFIXES = ["/municipal"];

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);
  const isSignedIn = session !== null;

  // 1. Not signed in, opening a protected page -> go to login, remembering
  //    where they were trying to get to.
  if (!isSignedIn && startsWithAny(pathname, PROTECTED_PREFIXES)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Already signed in, opening login/signup -> send them to the dashboard.
  if (isSignedIn && startsWithAny(pathname, AUTH_ONLY_PREFIXES)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // 3. The Admin Portal. This is the fast edge check on the role carried in the
  //    signed cookie; lib/auth/admin.ts re-checks against the database inside
  //    every admin page and API route.
  if (startsWithAny(pathname, ADMIN_PREFIXES)) {
    if (!isSignedIn) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }

    if (session.role !== "ADMIN") {
      // Not an error page: a commuter who lands here has done nothing wrong and
      // should simply end up where they belong.
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  // 4. The Municipal Dashboard, same two-layer pattern as the Admin Portal.
  if (startsWithAny(pathname, MUNICIPAL_PREFIXES)) {
    if (!isSignedIn) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }

    if (session.role !== "MUNICIPAL" && session.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

/**
 * Which requests this runs on: everything except Next.js internals, the API
 * routes (they check the session themselves) and static files.
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
