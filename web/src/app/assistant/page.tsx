import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SaarthiMark } from "@/components/brand/saarthi-mark";
import { AssistantConsole } from "@/components/chat/assistant-console";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import {
  appDateOnly,
  appLocalDate,
  appMinutesSinceMidnight,
  formatAppDate,
} from "@/lib/app-time";
import { getCurrentUser } from "@/lib/auth/session";
import { ASSISTANT_NAME, ASSISTANT_TAGLINE } from "@/lib/chat/branding";
import { loadHistory } from "@/lib/chat/history-service";
import { getCity } from "@/lib/cities";
import { prisma } from "@/lib/db";
import { assumedJourney } from "@/lib/journeys/journey-service";
import { formatTime } from "@/lib/demand/time-slots";
import { getTransportMode } from "@/lib/travel";

export const metadata: Metadata = {
  title: `${ASSISTANT_NAME} — your travel assistant`,
  description:
    "Tell CityFlow AI when your travel plans change, and keep your departure recommendation up to date.",
};

/**
 * The assistant, as a page of its own rather than a floating box.
 *
 * WHY A FULL PAGE
 * The conversation is where a commuter negotiates their day with the system —
 * that deserves room, and it deserves history. A 24rem popup could show about
 * three messages and forgot everything on close.
 *
 * The right-hand column shows today's plan alongside the conversation, so the
 * person can see the effect of what they just said without navigating away.
 */
export default async function AssistantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // The routine the assistant will assume this conversation is about. It is
  // named on screen and on every confirmation card, so the person can see which
  // trip they are changing before anything is saved.
  const journey = await assumedJourney(
    user.id,
    appLocalDate(),
    appMinutesSinceMidnight()
  );

  // There is nothing useful to discuss before a routine exists.
  if (!journey) redirect("/onboarding");

  const travelDate = appDateOnly();

  const [messages, recommendation, intention] = await Promise.all([
    loadHistory(user.id),
    prisma.recommendation.findUnique({
      where: { journeyId_travelDate: { journeyId: journey.id, travelDate } },
    }),
    prisma.travelIntention.findUnique({
      where: { journeyId_travelDate: { journeyId: journey.id, travelDate } },
    }),
  ]);

  const city = getCity(user.cityCode);
  const mode = getTransportMode(intention?.transportMode ?? journey.mode);

  const confirmedPlan =
    intention && intention.status === "CONFIRMED" ? intention.updatedDeparture : null;
  const cancelled = intention?.status === "CANCELLED";

  return (
    <section className="py-8 sm:py-10">
      <Container width="wide">
        {/* --------------------------------------------------------- header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary">
              CityFlow AI Assistant
            </p>
            <h1 className="mt-2 flex items-center gap-2.5 text-3xl font-semibold tracking-tight text-fg">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">
                <SaarthiMark className="h-5 w-5" />
              </span>
              {ASSISTANT_NAME}{" "}
              <span className="text-lg font-normal text-muted">· {ASSISTANT_TAGLINE}</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              A <span className="font-medium text-fg">saarthi</span> is the charioteer — the
              one who guides the journey while the traveller decides where to go. Tell it when
              your plans change and your recommendation stays honest.
            </p>
          </div>

          <p className="text-sm text-muted">
            {formatAppDate()} · {city.name}
          </p>
        </div>

        {/* ------------------------------------------- console + today's plan */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <AssistantConsole
            initialMessages={messages}
            displayName={user.displayName ?? "there"}
          />

          <aside className="space-y-4">
            {/* today's plan */}
            <div className="rounded-card border border-border-base bg-surface p-5">
              <h2 className="text-sm font-semibold text-fg">Today&apos;s plan</h2>

              <dl className="mt-4 space-y-2.5 text-sm">
                <Row label="Journey" value={journey.label} strong />
                <Row
                  label="Your plan"
                  value={
                    cancelled
                      ? "Not travelling"
                      : confirmedPlan
                        ? formatTime(confirmedPlan)
                        : `${formatTime(journey.usualDeparture)} (usual)`
                  }
                  strong
                />
                <Row
                  label="Recommended"
                  value={
                    recommendation
                      ? formatTime(recommendation.recommendedDeparture)
                      : "Not calculated yet"
                  }
                />
                <Row label="Arrive by" value={formatTime(journey.requiredArrival)} />
                <Row label="Transport" value={mode.label} />
              </dl>

              <div className="mt-4 border-t border-border-base pt-3">
                {confirmedPlan || cancelled ? (
                  <Badge tone="primary">Confirmed for today</Badge>
                ) : (
                  <Badge tone="neutral">Nothing confirmed yet</Badge>
                )}
              </div>

              <p className="mt-4 text-xs leading-relaxed text-subtle">
                Only a plan you confirm is counted in city demand. Until then your usual
                routine is what the system assumes.
              </p>

              <Link
                href="/dashboard"
                className="mt-4 inline-block text-sm font-medium text-primary underline"
              >
                Open my dashboard
              </Link>
            </div>

            {/* what it can and cannot do */}
            <div className="rounded-card border border-border-base bg-surface-2 p-5">
              <h2 className="text-sm font-semibold text-fg">
                What {ASSISTANT_NAME} can do
              </h2>

              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-subtle">
                Change today&apos;s travel
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
                <li>Change today&apos;s departure time</li>
                <li>Work backwards from an arrival time</li>
                <li>Shift your plan earlier or later</li>
                <li>Set a limit — &ldquo;not before 8&rdquo;</li>
                <li>Change today&apos;s transport mode</li>
                <li>Cancel today&apos;s trip</li>
              </ul>

              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-subtle">
                Explain CityFlow AI
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
                <li>Where to find any part of the app</li>
                <li>How to report a pothole, and who repairs it</li>
                <li>What the 0&ndash;100 demand number means</li>
                <li>Who can see your data, and what stays private</li>
                <li>Why you were given a particular time</li>
                <li>What is not built yet, honestly</li>
              </ul>

              <h3 className="mt-4 text-xs font-semibold text-fg">What it cannot do</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                It cannot change <span className="font-medium text-fg">where</span> you travel
                — that belongs to your routine. Edit your home area or destination on{" "}
                <Link href="/profile" className="font-medium text-primary underline">
                  My profile
                </Link>
                .
              </p>

              <p className="mt-4 text-xs leading-relaxed text-subtle">
                {ASSISTANT_NAME} recognises sentences using fixed rules, not a language model.
                That makes it free to run, predictable, and able to show you exactly what it
                understood — but it is not a general chatbot, and it will say so rather than
                inventing an answer.
              </p>
            </div>
          </aside>
        </div>
      </Container>
    </section>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-semibold text-fg" : "text-fg"}>{value}</dd>
    </div>
  );
}
