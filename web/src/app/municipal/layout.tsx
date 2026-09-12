import type { Metadata } from "next";
import type { ReactNode } from "react";

import { requireMunicipal } from "@/lib/auth/municipal";

export const metadata: Metadata = {
  title: {
    default: "Municipal Dashboard · CityFlow AI",
    template: "%s · Municipal Dashboard",
  },
  description:
    "CityFlow AI Municipal Dashboard — road condition prioritisation, inspection, work assignment and repair tracking.",
  // An internal operations tool has no business in search results.
  robots: { index: false, follow: false },
};

/**
 * Municipal Dashboard layout.
 *
 * Its only job is the guard. `proxy.ts` already blocked everyone else at the
 * edge using the role in their session cookie; this re-checks against the
 * database, because a cookie is a snapshot and access can be withdrawn after it
 * was issued.
 *
 * Because this runs for every page under /municipal, no individual page has to
 * remember to check.
 */
export default async function MunicipalLayout({ children }: { children: ReactNode }) {
  await requireMunicipal();

  return <>{children}</>;
}
