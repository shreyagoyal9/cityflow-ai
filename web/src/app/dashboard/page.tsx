import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CITY_COOKIE_NAME } from "@/components/city/city-provider";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { HistoryCard } from "@/components/dashboard/history-card";
import { PeakStrip } from "@/components/dashboard/peak-strip";
import { RecommendationCard } from "@/components/dashboard/recommendation-card";
import { UpdateNotice } from "@/components/dashboard/update-notice";
import {
  RoadConditionsCard,
  TrafficStatusCard,
  TravelOptionsCard,
} from "@/components/dashboard/status-cards";
import { MapPanel } from "@/components/map/map-panel";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Notice } from "@/components/ui/input";
import { appHour, formatAppDate } from "@/lib/app-time";
import { getCurrentUser } from "@/lib/auth/session";
import { getCity } from "@/lib/cities";
import { DEMAND_LEVEL_LABEL } from "@/lib/demand/demand-model";
import { loadIssuesForUser } from "@/lib/roads/road-service";
import { confidenceMeta, issueTypeLabel } from "@/lib/roads/types";
import {
  loadRecommendationHistory,
  loadTodayForUser,
  type JourneyToday,
} from "@/lib/recommendation-service";
import { greetingForHour } from "@/lib/utils";

export const metadata: Metadata = {
  title: "My dashboard",
};

/**
 * The commuter dashboard.
 *
 * It is built to answer one question above all others, in the first screenful:
 * WHEN SHOULD I LEAVE TODAY? Everything else — the demand strip, the map, the
 * routines, travel options, history — exists to support or explain that answer.
 *
 * PHASE 6: a person may now have several routines, so the page shows ONE
 * RECOMMENDATION CARD PER ROUTINE running today, in the order they depart. The
 * morning commute and the evening return are separate decisions and are
 * presented as such.
 *
 * This is a server component. It loads the data, runs the recommendation engine
 * and hands finished values to the display components, so the browser never has
 * to fetch anything before showing the answer.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  // The city shown must match the city the demand numbers were computed for.
  // The selector writes a cookie; the profile stores a fallback.
  const cookieStore = await cookies();
  const cityCode = cookieStore.get(CITY_COOKIE_NAME)?.value ?? user.cityCode;
  const city = getCity(cityCode);

  const today = await loadTodayForUser(user.id, city.code);

  // No preferences record at all means onboarding was never finished.
  if (!today.profile) redirect("/onboarding");

  // Road issues on the areas this person actually travels between. Uses the
  // first routine's areas, which is the one they travel most often.
  const primary = today.journeys[0] ?? null;

  const [history, roadIssues] = await Promise.all([
    loadRecommendationHistory(user.id),
    loadIssuesForUser({
      userId: user.id,
      cityCode: city.code,
      homeArea: primary?.journey.originArea ?? today.profile.homeArea,
      destinationArea: primary?.journey.destinationArea ?? today.profile.destinationArea,
    }),
  ]);

  const greeting = greetingForHour(appHour());
  const name = user.displayName ?? "there";

  return (
    <section className="py-8 sm:py-12">
      <Container width="wide">
        <DashboardHero
          greeting={greeting}
          name={name}
          dateLabel={formatAppDate()}
          cityName={city.name}
          cityflowId={user.cityflowId}
          weather={today.weather}
          weatherNote={today.weatherNote}
          pointsToday={today.pointsToday}
          pointsBalance={today.pointsBalance}
          journeyCount={today.journeys.length}
        />

        {params.welcome === "1" && (
          <div className="mt-6">
            <Notice tone="success">
              Your CityFlow profile is ready. Here is your first departure recommendation.
            </Notice>
          </div>
        )}

        {/* ------------------------------------- one card per routine today */}
        {today.journeys.length === 0 ? (
          <div className="mt-6">
            <NoJourneysToday hasJourneys={today.hasJourneysButNoneToday} />
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {today.journeys.map((entry) => (
              <JourneyBlock key={entry.journey.id} entry={entry} cityName={city.name} />
            ))}
          </div>
        )}

        {/* --------------------------------------------- city-wide context */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <MapPanel
              demandLevel={today.now.level}
              demandLabel={today.now.label}
              /*
                Only issues with real coordinates go on the map. An area-only
                report has no spot to pin, and dropping it at the area's centre
                would invent a precision the report does not have.
              */
              markers={roadIssues
                .filter((issue) => issue.lat !== null && issue.lng !== null)
                .map((issue) => ({
                  id: issue.id,
                  lat: issue.lat!,
                  lon: issue.lng!,
                  title: issueTypeLabel(issue.issueType),
                  description: `${confidenceMeta(issue.confidence).label} · ${issue.reportCount} report${
                    issue.reportCount === 1 ? "" : "s"
                  }`,
                  kind: "road-issue" as const,
                }))}
            />
          </div>

          <TrafficStatusCard now={today.now} cityName={city.name} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <TravelOptionsCard profile={today.profile} />
          <RoadConditionsCard
            area={primary?.journey.originArea ?? today.profile.homeArea}
            issues={roadIssues}
          />
        </div>

        <div className="mt-6">
          <HistoryCard recommendations={history} />
        </div>

        {/* ------------------------------------------------- honesty footer */}
        <div className="mt-8 rounded-card border border-border-base bg-surface-2 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="neutral">How to read this page</Badge>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Every demand figure here is a <span className="font-medium text-fg">prediction</span>{" "}
            from CityFlow AI&apos;s demand model, not a live measurement of traffic. Journey,
            arrival and time-saved estimates are arithmetic on that prediction and on the normal
            journey time you entered — CityFlow AI has never timed one of your journeys.
            Recommendations are suggestions: you always decide when to leave, and choosing your
            usual time is never wrong.
          </p>
        </div>
      </Container>
    </section>
  );
}

/**
 * One routine: its recommendation, the notice if the optimiser moved it, and
 * the demand strip that explains the suggestion.
 */
function JourneyBlock({ entry, cityName }: { entry: JourneyToday; cityName: string }) {
  const { journey, engine, recommendation, savings, pointsOffered } = entry;

  return (
    <div>
      {/*
        Shown when the city-wide optimiser moved this person's time because
        other people's confirmed plans changed the demand picture.
      */}
      {recommendation.updatedByOptimiser &&
        !recommendation.updateAcknowledged &&
        recommendation.updateReason && (
          <div className="mb-4">
            <UpdateNotice reason={recommendation.updateReason} />
          </div>
        )}

      <RecommendationCard
        journeyId={journey.id}
        journeyLabel={journey.label}
        journeyRoute={`${journey.originArea} → ${journey.destinationArea}`}
        recommendedDeparture={engine.recommendedDeparture}
        usualDeparture={engine.usualDeparture}
        requiredArrival={journey.requiredArrival}
        estimatedArrival={engine.estimatedArrival}
        estimatedJourneyMinutes={engine.estimatedJourneyMinutes}
        demandAtUsual={engine.demandAtUsual}
        demandAtRecommended={engine.demandAtRecommended}
        levelAtUsual={engine.levelAtUsual}
        levelAtRecommended={engine.levelAtRecommended}
        levelLabelAtUsual={DEMAND_LEVEL_LABEL[engine.levelAtUsual]}
        levelLabelAtRecommended={DEMAND_LEVEL_LABEL[engine.levelAtRecommended]}
        suggestsChange={engine.suggestsChange}
        reason={engine.reason}
        benefit={engine.benefit}
        warning={engine.warning}
        initialStatus={recommendation.status}
        initialChosenDeparture={recommendation.chosenDeparture}
        estimatedMinutesSaved={savings.minutes}
        savingIsMeaningful={savings.isMeaningful}
        savingMethod={savings.method}
        pointsOffered={pointsOffered}
      />

      <div className="mt-4">
        <PeakStrip
          slots={entry.peakStrip}
          usualDeparture={engine.usualDeparture}
          recommendedDeparture={engine.recommendedDeparture}
        />
      </div>

      <p className="mt-2 text-xs text-subtle">
        Predicted demand around this departure in {cityName}.
      </p>
    </div>
  );
}

/**
 * Two different empty states, deliberately.
 *
 * "You have not added a journey" and "none of your journeys run today" need
 * completely different things said to the person. Collapsing them into one
 * message is how a product starts telling people things that are not true.
 */
function NoJourneysToday({ hasJourneys }: { hasJourneys: boolean }) {
  if (hasJourneys) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-fg">No journeys scheduled today</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          None of your saved routines run on this day of the week, so there is nothing to
          recommend. If you are travelling anyway, plan it as a one-off trip — that still
          counts towards the city&apos;s demand picture.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href="/plan">Plan a one-off trip</ButtonLink>
          <ButtonLink href="/journeys" variant="outline">
            Edit my journeys
          </ButtonLink>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-fg">Add your first journey</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        CityFlow AI needs to know a trip you make regularly before it can suggest anything.
        It takes about a minute, and you can add more later — most people add their morning
        commute and their journey home.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <ButtonLink href="/journeys/new">Add a journey</ButtonLink>
        <Link
          href="/how-it-works"
          className="inline-flex items-center text-sm font-medium text-primary underline"
        >
          How does this work?
        </Link>
      </div>
    </Card>
  );
}
