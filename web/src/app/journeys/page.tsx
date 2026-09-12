import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { JourneyList } from "@/components/journeys/journey-list";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { getCurrentUser } from "@/lib/auth/session";
import {
  MAX_JOURNEYS_PER_USER,
  listJourneys,
} from "@/lib/journeys/journey-service";

export const metadata: Metadata = {
  title: "My journeys",
};

/**
 * Manage recurring journeys.
 *
 * A person's routines are the single most important thing they tell CityFlow AI
 * — everything the product does downstream is derived from them — so they get
 * their own page rather than being buried in profile settings.
 */
export default async function JourneysPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/journeys");

  const journeys = await listJourneys(user.id);
  const atLimit = journeys.length >= MAX_JOURNEYS_PER_USER;

  return (
    <section className="py-8 sm:py-12">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            eyebrow="Your routines"
            title="My journeys"
            description="The trips you make regularly. CityFlow AI suggests a departure time for each one, on the days it runs."
          />

          {!atLimit && <ButtonLink href="/journeys/new">Add a journey</ButtonLink>}
        </div>

        {atLimit && (
          <p className="mt-4 rounded-lg border border-border-base bg-surface-2 px-4 py-3 text-sm text-muted">
            You have reached the maximum of {MAX_JOURNEYS_PER_USER} saved journeys. Delete
            one you no longer use to add another.
          </p>
        )}

        <div className="mt-6">
          <JourneyList
            journeys={journeys.map((journey) => ({
              id: journey.id,
              label: journey.label,
              originArea: journey.originArea,
              destinationArea: journey.destinationArea,
              usualDeparture: journey.usualDeparture,
              requiredArrival: journey.requiredArrival,
              travelDays: journey.travelDays,
              isFlexible: journey.isFlexible,
              flexibilityMinutes: journey.flexibilityMinutes,
              isActive: journey.isActive,
              mode: journey.mode,
            }))}
          />
        </div>

        <div className="mt-8 rounded-card border border-border-base bg-surface-2 p-5">
          <h2 className="text-sm font-semibold text-fg">
            Why more than one journey matters
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Most people make at least two trips a day, and in every city we looked at the
            evening peak is the larger of the two. A system that only knew about your
            morning commute could never help with the journey home — which is usually the
            one people find worse.
          </p>
        </div>
      </Container>
    </section>
  );
}
