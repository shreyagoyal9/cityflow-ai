import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EMPTY_JOURNEY, JourneyForm } from "@/components/journeys/journey-form";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { getCurrentUser } from "@/lib/auth/session";
import { getCityConfig } from "@/lib/city-config";
import { getCity } from "@/lib/cities";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Add a journey",
};

export default async function NewJourneyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/journeys/new");

  const city = getCity(user.cityCode);

  const [savedLocations, config] = await Promise.all([
    prisma.savedLocation.findMany({
      where: { userId: user.id },
      select: { id: true, label: true, area: true },
      orderBy: { createdAt: "asc" },
    }),
    getCityConfig(city.code),
  ]);

  return (
    <section className="py-8 sm:py-12">
      <Container>
        <SectionHeading
          eyebrow="New routine"
          title="Add a journey"
          description="Tell CityFlow AI about a trip you make regularly. You can change any of this later."
        />

        <div className="mt-6">
          <JourneyForm
            initial={{
              ...EMPTY_JOURNEY,
              // The city's own default, rather than a constant baked into the
              // form, so a council can tune what it asks of people.
              flexibilityMinutes: config.defaultFlexibilityMinutes,
            }}
            savedLocations={savedLocations}
          />
        </div>
      </Container>
    </section>
  );
}
