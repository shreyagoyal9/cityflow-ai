import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TripPlanner } from "@/components/trips/trip-planner";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { appDateOnly } from "@/lib/app-time";
import { getCurrentUser } from "@/lib/auth/session";
import { listJourneys } from "@/lib/journeys/journey-service";

export const metadata: Metadata = {
  title: "Plan a trip",
};

/**
 * One-off trip planning.
 *
 * Separate from journeys on purpose. A routine is a standing arrangement the
 * engine may nudge; a one-off trip is a deadline the engine must meet. Putting
 * them on the same screen would blur two quite different promises.
 */
export default async function PlanTripPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/plan");

  // Pre-fill from the person's first routine, because most one-off trips start
  // from home. It is only a starting value — every field stays editable.
  const journeys = await listJourneys(user.id);
  const first = journeys[0];

  return (
    <section className="py-8 sm:py-12">
      <Container width="wide">
        <SectionHeading
          eyebrow="One-off trip"
          title="Plan a trip"
          description="Tell CityFlow AI when you need to arrive, and it will work backwards to the best time to set off."
        />

        <div className="mt-6">
          <TripPlanner
            today={appDateOnly().toISOString().slice(0, 10)}
            defaultOrigin={first?.originArea ?? ""}
            defaultDestination=""
          />
        </div>
      </Container>
    </section>
  );
}
