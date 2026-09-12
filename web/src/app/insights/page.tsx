import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CITY_COOKIE_NAME } from "@/components/city/city-provider";
import { DayCurve } from "@/components/insights/day-curve";
import { SmoothingComparison } from "@/components/insights/smoothing-comparison";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { appDateOnly, appLocalDate } from "@/lib/app-time";
import { getCurrentUser } from "@/lib/auth/session";
import { getCity } from "@/lib/cities";
import { getCityConfig } from "@/lib/city-config";
import { TRIP_WEIGHT, loadCityInsights } from "@/lib/demand/insights";
import { formatTime, toMinutes } from "@/lib/demand/time-slots";
import { journeysForDate } from "@/lib/journeys/journey-service";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Traffic insights",
};

/**
 * Traffic insights — the page that shows the working.
 *
 * The dashboard answers "when should I leave?". This page answers the two
 * questions a thoughtful person asks next: "why that time?" and "does any of
 * this actually work?".
 *
 * The second question is the one the product lives or dies on, so the answer is
 * a comparison built from real stored data — the departure each person's routine
 * specifies against the one they confirmed — and it reports honestly when the
 * peak was relocated rather than flattened.
 */
export default async function InsightsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/insights");

  const cookieStore = await cookies();
  const city = getCity(cookieStore.get(CITY_COOKIE_NAME)?.value ?? user.cityCode);

  const travelDate = appDateOnly();
  const localNow = appLocalDate();

  const [insights, journeys, config, recommendations] = await Promise.all([
    loadCityInsights(city.code, travelDate, localNow),
    journeysForDate(user.id, localNow),
    getCityConfig(city.code),
    prisma.recommendation.findMany({
      where: { userId: user.id, travelDate },
      include: { journey: { select: { label: true } } },
    }),
  ]);

  // Mark the person's own departures on the day curve, so they can find
  // themselves on the city's shape rather than reading it in the abstract.
  const markers = journeys
    .map((journey) => {
      const minutes = toMinutes(journey.usualDeparture);
      return minutes === null
        ? null
        : {
            minutes: Math.floor(minutes / 15) * 15,
            label: `${journey.label} (${formatTime(journey.usualDeparture)})`,
          };
    })
    .filter((marker): marker is { minutes: number; label: string } => marker !== null);

  return (
    <section className="py-8 sm:py-12">
      <Container width="wide">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            eyebrow={city.name}
            title="Traffic insights"
            description="What today looks like, why your recommendation is what it is, and whether the peak is actually flattening."
          />
          <ButtonLink href="/dashboard" variant="outline" size="sm">
            Back to my dashboard
          </ButtonLink>
        </div>

        {/* ---------------------------------------------- the day's shape */}
        <div className="mt-6">
          <DayCurve
            slots={insights.dayCurve}
            peakMinutes={insights.peakSlot?.minutes ?? null}
            cityName={city.name}
            markers={markers}
          />
        </div>

        {/* --------------------------------------- does it actually work? */}
        <div className="mt-6">
          {insights.comparison ? (
            <SmoothingComparison {...insights.comparison} cityName={city.name} />
          ) : (
            <Card>
              <CardHeader
                title="Did the peak flatten, or just move?"
                description="Nothing to compare yet."
              />
              <p className="text-sm leading-relaxed text-muted">
                Nobody has confirmed a travel plan in {city.name} today, so there is no
                before-and-after to show. This chart appears as soon as there is — it
                compares the departure times people&apos;s routines specify against the
                ones they actually confirmed.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                An empty chart with two flat lines would imply the system had been measured
                and found to do nothing, which is a very different statement.
              </p>
              <div className="mt-4">
                <ButtonLink href="/dashboard">Confirm today&apos;s plan</ButtonLink>
              </div>
            </Card>
          )}
        </div>

        {/* -------------------------------- why your recommendation, and points */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Why you were given these times"
              description="Your own recommendations today, with the numbers behind them."
            />

            {recommendations.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                No recommendations today. Either none of your journeys run on this day of
                the week, or you have not added one yet.
              </p>
            ) : (
              <ul className="space-y-4">
                {recommendations.map((recommendation) => (
                  <li
                    key={recommendation.id}
                    className="rounded-lg border border-border-base bg-surface-2 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-fg">
                        {recommendation.journey?.label ?? "Your journey"}
                      </p>
                      {recommendation.pointsOffered > 0 && (
                        <Badge tone="secondary">
                          +{recommendation.pointsOffered} points if followed
                        </Badge>
                      )}
                    </div>

                    <p className="mt-2 text-sm leading-relaxed text-fg">
                      {recommendation.reason}
                    </p>

                    <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                      <Pair
                        label="Your usual time"
                        value={`${formatTime(recommendation.usualDeparture)} · demand ${recommendation.demandAtUsual}/100`}
                      />
                      <Pair
                        label="Recommended"
                        value={`${formatTime(recommendation.recommendedDeparture)} · demand ${recommendation.demandAtRecommended}/100`}
                      />
                      {recommendation.estimatedMinutesSaved > 0 && (
                        <Pair
                          label="Estimated time saved"
                          value={`about ${recommendation.estimatedMinutesSaved} min (modelled)`}
                        />
                      )}
                      <Pair
                        label="Your decision"
                        value={
                          recommendation.status === "PENDING"
                            ? "Not decided yet"
                            : recommendation.status === "ACCEPTED"
                              ? "Using the recommended time"
                              : recommendation.status === "KEPT_USUAL"
                                ? "Keeping your usual time"
                                : `Your own time${
                                    recommendation.chosenDeparture
                                      ? ` (${formatTime(recommendation.chosenDeparture)})`
                                      : ""
                                  }`
                        }
                      />
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Where the trips start"
                description="Areas with the most confirmed departures today."
              />

              {insights.hotspots.length === 0 ? (
                <p className="text-sm text-muted">
                  No confirmed departures in {city.name} today.
                </p>
              ) : (
                <ol className="space-y-2">
                  {insights.hotspots.map((spot, index) => {
                    const share =
                      insights.totalConfirmedTrips === 0
                        ? 0
                        : (spot.trips / insights.totalConfirmedTrips) * 100;

                    return (
                      <li key={spot.zoneKey}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className="w-4 shrink-0 text-sm font-semibold text-muted">
                              {index + 1}
                            </span>
                            <span className="truncate text-sm text-fg">{spot.label}</span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-fg">
                            {spot.trips}
                          </span>
                        </div>
                        <div
                          className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-series-1"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              <p className="mt-4 text-xs leading-relaxed text-subtle">
                Areas only. CityFlow AI holds the area a trip starts in, never an address,
                and these counts cannot be traced back to a person.
              </p>
            </Card>

            <Card>
              <CardHeader title="How the numbers fit together" />
              <dl className="space-y-2.5 text-sm">
                <Pair
                  label="Modelled baseline peak"
                  value={`${insights.baselinePeakIndex}/100`}
                />
                <Pair
                  label="Peak including confirmed trips"
                  value={`${insights.peakSlot?.index ?? 0}/100`}
                />
                <Pair
                  label="Each confirmed trip adds"
                  value={`${TRIP_WEIGHT} index points`}
                />
                <Pair
                  label="Counts as a peak above"
                  value={`${config.peakDemandThreshold}/100`}
                />
              </dl>

              <p className="mt-4 text-xs leading-relaxed text-subtle">
                One confirmed trip moving the index by {TRIP_WEIGHT} points is a{" "}
                <span className="font-medium">modelling choice</span>, not a measurement:
                a real city has hundreds of thousands of trips per slot, and CityFlow AI has
                a handful of users, so each one is treated as standing for a slice of the
                travelling public — the same assumption any sampled travel survey makes.
              </p>
            </Card>
          </div>
        </div>

        {/* ---------------------------------------------------- what's next */}
        <div className="mt-8 rounded-card border border-border-base bg-surface-2 p-5">
          <Badge tone="neutral">What would make this stronger</Badge>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Everything above is built from predicted demand and confirmed intentions. What
            it cannot tell you is whether journeys actually got faster, because no real
            journey has been timed. Recording opt-in departure and arrival times would turn
            these estimates into measurements — and until that exists, this page says
            &ldquo;predicted&rdquo; and &ldquo;estimated&rdquo; everywhere it means them.
          </p>
          <p className="mt-3 text-sm text-muted">
            The simulation evidence for the core claim is separate and stronger:{" "}
            <Link href="/how-it-works" className="font-medium text-primary underline">
              see how it works
            </Link>
            .
          </p>
        </div>
      </Container>
    </section>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-base pb-1.5 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{value}</dd>
    </div>
  );
}
