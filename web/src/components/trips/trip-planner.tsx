"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Notice, TextField } from "@/components/ui/input";
import { formatTime } from "@/lib/demand/time-slots";
import { demandBadgeTone, demandBarClass } from "@/lib/demand/ui";
import type { DemandLevel } from "@/lib/demand/demand-model";

/**
 * Plan a one-off trip.
 *
 * "I have a film at 10:30 — when should I leave?"
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 * A person planning a flight or a hospital appointment is asking a question
 * with a real cost attached to getting it wrong. So the answer always shows:
 *   - the safety buffer that was applied, and why it is that size;
 *   - a confidence score, with what drives it;
 *   - the estimated arrival, not just the departure.
 * A single bare time would look more confident and be far less useful.
 */

const TRIP_TYPES = [
  { value: "MEETING" as const, label: "Meeting", hint: "15 min buffer" },
  { value: "FLIGHT" as const, label: "Flight", hint: "45 min buffer" },
  { value: "TRAIN" as const, label: "Train", hint: "25 min buffer" },
  { value: "APPOINTMENT" as const, label: "Appointment", hint: "15 min buffer" },
  { value: "MOVIE" as const, label: "Film or show", hint: "10 min buffer" },
  { value: "EVENT" as const, label: "Event", hint: "10 min buffer" },
  { value: "OTHER" as const, label: "Something else", hint: "10 min buffer" },
];

const MODES = [
  { value: "CAR" as const, label: "Car" },
  { value: "BIKE" as const, label: "Motorbike" },
  { value: "BUS" as const, label: "Bus" },
  { value: "METRO" as const, label: "Metro" },
  { value: "CYCLE" as const, label: "Cycle" },
  { value: "WALK" as const, label: "Walk" },
  { value: "OTHER" as const, label: "Other" },
];

interface StripSlot {
  minutes: number;
  time: string;
  index: number;
  level: DemandLevel;
  label: string;
}

interface PlanResponse {
  plan: {
    recommendedDeparture: string;
    estimatedArrival: string;
    estimatedJourneyMinutes: number;
    demandAtRecommended: number;
    demandLevel: DemandLevel;
    demandLabel: string;
    confidenceScore: number;
    reason: string;
    bufferMinutes: number;
    bufferReason: string;
    warning: string | null;
  };
  cityName: string;
  strip: StripSlot[];
}

export function TripPlanner({
  today,
  defaultOrigin,
  defaultDestination,
}: {
  /** YYYY-MM-DD in the app's timezone, used as the minimum selectable date. */
  today: string;
  defaultOrigin: string;
  defaultDestination: string;
}) {
  const [originArea, setOriginArea] = useState(defaultOrigin);
  const [destinationArea, setDestinationArea] = useState(defaultDestination);
  const [travelDate, setTravelDate] = useState(today);
  const [requiredArrival, setRequiredArrival] = useState("10:30");
  const [typicalJourneyMinutes, setTypicalJourneyMinutes] = useState(30);
  const [tripType, setTripType] = useState<(typeof TRIP_TYPES)[number]["value"]>("MEETING");
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("CAR");

  const [result, setResult] = useState<PlanResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/trips/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originArea,
          destinationArea,
          travelDate,
          requiredArrival,
          typicalJourneyMinutes,
          mode,
          tripType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "We could not plan this trip.");
        setFieldErrors(data.fieldErrors ?? {});
        setResult(null);
        return;
      }

      setResult(data);
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ------------------------------------------------------------ form */}
      <form onSubmit={handleSubmit} className="space-y-6 lg:col-span-3" noValidate>
        {error && <Notice tone="error">{error}</Notice>}

        <Card>
          <h2 className="text-base font-semibold text-fg">Where and when?</h2>

          <div className="mt-5 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Starting area"
                value={originArea}
                onChange={(event) => setOriginArea(event.target.value)}
                error={fieldErrors.originArea}
                required
              />
              <TextField
                label="Destination area"
                value={destinationArea}
                onChange={(event) => setDestinationArea(event.target.value)}
                error={fieldErrors.destinationArea}
                required
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <TextField
                label="Date"
                type="date"
                min={today}
                value={travelDate}
                onChange={(event) => setTravelDate(event.target.value)}
                error={fieldErrors.travelDate}
                required
              />
              <TextField
                label="Must arrive by"
                type="time"
                value={requiredArrival}
                onChange={(event) => setRequiredArrival(event.target.value)}
                error={fieldErrors.requiredArrival}
                required
              />
              <TextField
                label="Normal journey"
                type="number"
                min={1}
                max={300}
                hint="Minutes, light traffic"
                value={typicalJourneyMinutes}
                onChange={(event) =>
                  setTypicalJourneyMinutes(Number(event.target.value) || 0)
                }
                error={fieldErrors.typicalJourneyMinutes}
                required
              />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-fg">What kind of trip?</h2>
          <p className="mt-1 text-sm text-muted">
            This sets the safety buffer. Missing a flight costs more than missing the
            adverts before a film, so the two are not planned the same way.
          </p>

          <div className="mt-5 space-y-5">
            <ChoiceGroup
              legend="Trip type"
              choices={TRIP_TYPES}
              value={tripType}
              onChange={setTripType}
              columns={2}
            />
            <ChoiceGroup
              legend="How will you travel?"
              choices={MODES}
              value={mode}
              onChange={setMode}
              columns={3}
            />
          </div>
        </Card>

        <Button type="submit" size="lg" loading={loading} fullWidth>
          Work out when to leave
        </Button>
      </form>

      {/* ---------------------------------------------------------- answer */}
      <div className="lg:col-span-2">
        {result ? (
          <TripAnswer result={result} onSaveAsRoutine={{ originArea, destinationArea }} />
        ) : (
          <Card className="h-full">
            <h2 className="text-base font-semibold text-fg">Your answer appears here</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              CityFlow AI works backwards from your arrival deadline, checks predicted
              demand across every departure time that would still get you there, and picks
              the quietest one that leaves enough slack.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              It will never suggest a quieter time that arrives late. Empty roads are no
              use to someone who has missed their train.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function TripAnswer({
  result,
  onSaveAsRoutine,
}: {
  result: PlanResponse;
  onSaveAsRoutine: { originArea: string; destinationArea: string };
}) {
  const { plan, strip, cityName } = result;

  return (
    <div className="space-y-4">
      <Card raised>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary">
          Leave at
        </p>
        <p className="mt-1 text-4xl font-semibold tracking-tight text-primary">
          {formatTime(plan.recommendedDeparture)}
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Estimated arrival" value={formatTime(plan.estimatedArrival)} />
          <Row
            label="Estimated journey"
            value={`about ${plan.estimatedJourneyMinutes} min`}
          />
          <Row
            label="Predicted traffic"
            value={`${plan.demandLabel} (${plan.demandAtRecommended}/100)`}
          />
          <Row label="Safety buffer" value={`${plan.bufferMinutes} min`} />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={demandBadgeTone(plan.demandLevel)}>{plan.demandLabel} traffic</Badge>
          <Badge tone={plan.confidenceScore >= 60 ? "primary" : "moderate"}>
            Confidence {plan.confidenceScore}/100
          </Badge>
        </div>

        {plan.warning && (
          <div className="mt-4">
            <Notice tone="error">{plan.warning}</Notice>
          </div>
        )}

        <p className="mt-4 rounded-lg bg-surface-2 p-3 text-sm leading-relaxed text-fg">
          {plan.reason}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-subtle">{plan.bufferReason}</p>
      </Card>

      {/* --------------------------------------------------- demand around it */}
      {strip.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-fg">
            Predicted demand around this time
          </h3>
          <p className="mt-1 text-xs text-muted">{cityName}</p>

          <ul className="mt-4 flex items-end gap-1.5">
            {strip.map((slot) => {
              const isChosen = slot.time === plan.recommendedDeparture;
              return (
                <li key={slot.minutes} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-t ${demandBarClass(slot.level)} ${
                      isChosen ? "ring-2 ring-primary" : ""
                    }`}
                    style={{ height: `${Math.max(6, slot.index)}px` }}
                    aria-hidden="true"
                  />
                  <span
                    className={
                      isChosen
                        ? "text-[0.6rem] font-semibold text-primary"
                        : "text-[0.6rem] text-subtle"
                    }
                  >
                    {slot.time}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* The bars are decorative; this is the same data as text. */}
          <p className="sr-only-cf">
            {strip
              .map((slot) => `${slot.time}: ${slot.label} (${slot.index} out of 100)`)
              .join(". ")}
          </p>
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-semibold text-fg">Do you make this trip often?</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Saving it as a routine means CityFlow AI suggests a time for it every week,
          without you having to ask.
        </p>
        <Link
          href={`/journeys/new?origin=${encodeURIComponent(
            onSaveAsRoutine.originArea
          )}&destination=${encodeURIComponent(onSaveAsRoutine.destinationArea)}`}
          className="mt-3 inline-flex h-10 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2"
        >
          Save as a regular journey
        </Link>
      </Card>

      <p className="text-xs leading-relaxed text-subtle">
        Every figure here is a model prediction, not measured traffic. The journey estimate
        is based on the normal journey time you entered.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-base pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{value}</dd>
    </div>
  );
}
