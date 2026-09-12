"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceGroup, MultiChoiceGroup, Toggle } from "@/components/ui/choice-group";
import { Notice, TextField } from "@/components/ui/input";
import { WEEKDAYS, type DayCode } from "@/lib/demand/time-slots";

/**
 * Add or edit one recurring journey.
 *
 * Used by both `/journeys/new` and `/journeys/[id]/edit`, so the two can never
 * drift apart and accept different things. The server validates the same shape
 * with the same Zod schema (`journeySchema`), so a field that passes here and
 * fails there is a bug, not a normal outcome.
 *
 * WHY THE FLEXIBILITY SECTION IS WORDED SO CAREFULLY
 * Everything CityFlow AI is allowed to suggest comes from these four controls.
 * If someone says they cannot leave earlier, the engine will never propose it —
 * not as a nudge, not "just this once". The copy here has to make that bargain
 * clear, because a person who does not believe it will simply not answer
 * honestly, and an engine fed dishonest constraints produces advice nobody takes.
 */

const DESTINATION_TYPES = [
  { value: "WORK" as const, label: "Work", hint: "Office, site or workplace" },
  { value: "COLLEGE" as const, label: "College", hint: "University or college" },
  { value: "SCHOOL" as const, label: "School", hint: "School run or your own school" },
  { value: "OTHER" as const, label: "Somewhere else", hint: "Gym, family, anywhere" },
];

const MODES = [
  { value: "CAR" as const, label: "Car" },
  { value: "BIKE" as const, label: "Motorbike or scooter" },
  { value: "BUS" as const, label: "Bus" },
  { value: "METRO" as const, label: "Metro or train" },
  { value: "CYCLE" as const, label: "Cycle" },
  { value: "WALK" as const, label: "Walk" },
  { value: "OTHER" as const, label: "Something else" },
];

const FLEXIBILITY_OPTIONS = [
  { value: "0" as const, label: "Not at all", hint: "Fixed departure" },
  { value: "15" as const, label: "15 minutes", hint: "A small nudge" },
  { value: "30" as const, label: "30 minutes", hint: "Fairly flexible" },
  { value: "60" as const, label: "An hour", hint: "Very flexible" },
];

export interface JourneyFormValues {
  label: string;
  originArea: string;
  destinationArea: string;
  destinationType: (typeof DESTINATION_TYPES)[number]["value"];
  usualDeparture: string;
  requiredArrival: string;
  typicalJourneyMinutes: number;
  travelDays: DayCode[];
  isFlexible: boolean;
  flexibilityMinutes: number;
  willingToLeaveEarlier: boolean;
  willingToLeaveLater: boolean;
  mode: (typeof MODES)[number]["value"];
}

export const EMPTY_JOURNEY: JourneyFormValues = {
  label: "",
  originArea: "",
  destinationArea: "",
  destinationType: "WORK",
  usualDeparture: "09:00",
  requiredArrival: "09:45",
  typicalJourneyMinutes: 25,
  travelDays: ["MON", "TUE", "WED", "THU", "FRI"],
  isFlexible: true,
  flexibilityMinutes: 15,
  willingToLeaveEarlier: true,
  willingToLeaveLater: false,
  mode: "CAR",
};

interface JourneyFormProps {
  initial: JourneyFormValues;
  /** Present when editing; absent when creating. */
  journeyId?: string;
  /** Places the person has saved, offered as one-tap fills. */
  savedLocations?: Array<{ id: string; label: string; area: string }>;
}

export function JourneyForm({ initial, journeyId, savedLocations = [] }: JourneyFormProps) {
  const router = useRouter();

  const [values, setValues] = useState<JourneyFormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof JourneyFormValues>(key: K, value: JourneyFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    // Clear the error the moment the person starts fixing the field. Leaving it
    // visible while they type reads as the form arguing with them.
    setFieldErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch(
        journeyId ? `/api/journeys/${journeyId}` : "/api/journeys",
        {
          method: journeyId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "We could not save this journey.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }

      router.push("/journeys");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {error && <Notice tone="error">{error}</Notice>}

      {/* ------------------------------------------------------ 1. the trip */}
      <Card>
        <h2 className="text-base font-semibold text-fg">Where do you travel?</h2>
        <p className="mt-1 text-sm text-muted">
          An area name is enough — CityFlow AI does not need your street address, and does
          not ask for it.
        </p>

        <div className="mt-5 space-y-5">
          <TextField
            label="Name this journey"
            hint="Optional. We'll name it for you if you leave this blank."
            placeholder="Morning commute"
            value={values.label}
            onChange={(event) => set("label", event.target.value)}
            error={fieldErrors.label}
            maxLength={48}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <TextField
                label="Starting area"
                hint="e.g. Salt Lake Sector 5"
                value={values.originArea}
                onChange={(event) => set("originArea", event.target.value)}
                error={fieldErrors.originArea}
                required
              />
              <SavedPlaces
                places={savedLocations}
                onPick={(area) => set("originArea", area)}
              />
            </div>

            <div>
              <TextField
                label="Destination area"
                hint="e.g. Park Street"
                value={values.destinationArea}
                onChange={(event) => set("destinationArea", event.target.value)}
                error={fieldErrors.destinationArea}
                required
              />
              <SavedPlaces
                places={savedLocations}
                onPick={(area) => set("destinationArea", area)}
              />
            </div>
          </div>

          <ChoiceGroup
            legend="What is at the destination?"
            choices={DESTINATION_TYPES}
            value={values.destinationType}
            onChange={(value) => set("destinationType", value)}
            error={fieldErrors.destinationType}
          />

          <ChoiceGroup
            legend="How do you usually travel?"
            choices={MODES}
            value={values.mode}
            onChange={(value) => set("mode", value)}
            columns={3}
            error={fieldErrors.mode}
          />
        </div>
      </Card>

      {/* --------------------------------------------------- 2. the schedule */}
      <Card>
        <h2 className="text-base font-semibold text-fg">When do you travel?</h2>

        <div className="mt-5 space-y-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField
              label="Usual departure"
              type="time"
              value={values.usualDeparture}
              onChange={(event) => set("usualDeparture", event.target.value)}
              error={fieldErrors.usualDeparture}
              required
            />
            <TextField
              label="Must arrive by"
              type="time"
              value={values.requiredArrival}
              onChange={(event) => set("requiredArrival", event.target.value)}
              error={fieldErrors.requiredArrival}
              required
            />
            <TextField
              label="Normal journey time"
              type="number"
              min={1}
              max={300}
              hint="In minutes, in light traffic"
              value={values.typicalJourneyMinutes}
              onChange={(event) =>
                set("typicalJourneyMinutes", Number(event.target.value) || 0)
              }
              error={fieldErrors.typicalJourneyMinutes}
              required
            />
          </div>

          <MultiChoiceGroup
            legend="Which days?"
            values={values.travelDays}
            onChange={(days) => set("travelDays", days)}
            choices={WEEKDAYS.map((day) => ({ value: day.code, label: day.full }))}
            columns={3}
            error={fieldErrors.travelDays}
          />
        </div>
      </Card>

      {/* ------------------------------------------------ 3. the flexibility */}
      <Card>
        <h2 className="text-base font-semibold text-fg">How much can this move?</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          This is the only thing that decides what CityFlow AI may suggest. If you say you
          cannot leave earlier, it will never propose an earlier time — not as a nudge, not
          just this once.
        </p>

        <div className="mt-5 space-y-5">
          <Toggle
            label="My departure time can move"
            description="Turn this off for a journey with a fixed start, like a shift or a class."
            checked={values.isFlexible}
            onChange={(checked) => set("isFlexible", checked)}
          />

          {values.isFlexible && (
            <>
              <ChoiceGroup
                legend="How far can it move?"
                choices={FLEXIBILITY_OPTIONS}
                value={String(values.flexibilityMinutes) as "0" | "15" | "30" | "60"}
                onChange={(value) => set("flexibilityMinutes", Number(value))}
                error={fieldErrors.flexibilityMinutes}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="I can leave earlier"
                  checked={values.willingToLeaveEarlier}
                  onChange={(checked) => set("willingToLeaveEarlier", checked)}
                />
                <Toggle
                  label="I can leave later"
                  checked={values.willingToLeaveLater}
                  onChange={(checked) => set("willingToLeaveLater", checked)}
                />
              </div>

              {fieldErrors.willingToLeaveEarlier && (
                <Notice tone="error">{fieldErrors.willingToLeaveEarlier}</Notice>
              )}
            </>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" size="lg" loading={saving}>
          {journeyId ? "Save changes" : "Add this journey"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => router.push("/journeys")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One-tap fills from the person's saved places. */
function SavedPlaces({
  places,
  onPick,
}: {
  places: Array<{ id: string; label: string; area: string }>;
  onPick: (area: string) => void;
}) {
  if (places.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {places.map((place) => (
        <button
          key={place.id}
          type="button"
          onClick={() => onPick(place.area)}
          className="rounded-full border border-border-base bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-3 hover:text-fg"
        >
          {place.label}
        </button>
      ))}
    </div>
  );
}
