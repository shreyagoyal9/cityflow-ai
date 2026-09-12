import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { JourneyForm } from "@/components/journeys/journey-form";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOwnedJourney } from "@/lib/journeys/journey-service";
import type { DayCode } from "@/lib/demand/time-slots";

export const metadata: Metadata = {
  title: "Edit journey",
};

export default async function EditJourneyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/journeys");

  const { id } = await params;

  const journey = await getOwnedJourney(user.id, id);
  // `getOwnedJourney` returns null for both "not yours" and "does not exist",
  // so a person probing ids cannot tell which one they hit.
  if (!journey) notFound();

  const savedLocations = await prisma.savedLocation.findMany({
    where: { userId: user.id },
    select: { id: true, label: true, area: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <section className="py-8 sm:py-12">
      <Container>
        <SectionHeading
          eyebrow="Edit routine"
          title={journey.label}
          description="Changes apply from your next recommendation onwards. Your history is kept."
        />

        <div className="mt-6">
          <JourneyForm
            journeyId={journey.id}
            savedLocations={savedLocations}
            initial={{
              label: journey.label,
              originArea: journey.originArea,
              destinationArea: journey.destinationArea,
              destinationType: journey.destinationType,
              usualDeparture: journey.usualDeparture,
              requiredArrival: journey.requiredArrival,
              typicalJourneyMinutes: journey.typicalJourneyMinutes,
              travelDays: journey.travelDays as DayCode[],
              isFlexible: journey.isFlexible,
              flexibilityMinutes: journey.flexibilityMinutes,
              willingToLeaveEarlier: journey.willingToLeaveEarlier,
              willingToLeaveLater: journey.willingToLeaveLater,
              mode: journey.mode,
            }}
          />
        </div>
      </Container>
    </section>
  );
}
