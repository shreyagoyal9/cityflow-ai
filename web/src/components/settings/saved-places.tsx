"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Notice, TextField } from "@/components/ui/input";

/**
 * Saved places.
 *
 * A convenience only: these appear as one-tap fills when adding a journey.
 * Deleting a place never changes a journey that was created from it, because a
 * journey stores its own area text — removing a shortcut must not silently
 * alter where somebody travels.
 */

const KINDS = [
  { value: "HOME" as const, label: "Home" },
  { value: "WORK" as const, label: "Work" },
  { value: "EDUCATION" as const, label: "College or school" },
  { value: "GYM" as const, label: "Gym" },
  { value: "FAMILY" as const, label: "Family" },
  { value: "OTHER" as const, label: "Somewhere else" },
];

export interface PlaceRow {
  id: string;
  label: string;
  kind: string;
  area: string;
}

export function SavedPlaces({ places }: { places: PlaceRow[] }) {
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [area, setArea] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("HOME");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, kind, area }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not save this place.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }

      setLabel("");
      setArea("");
      setAdding(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);

    try {
      const response = await fetch(`/api/locations/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setError("Could not delete this place. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Saved places"
        description="Shortcuts for adding journeys. Private to you — never used in any city-level figure."
        action={
          !adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              Add a place
            </Button>
          )
        }
      />

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {adding && (
        <form
          onSubmit={add}
          className="mb-5 space-y-4 rounded-lg border border-border-base bg-surface-2 p-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Name"
              placeholder="Home"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              error={fieldErrors.label}
              required
            />
            <TextField
              label="Area"
              placeholder="Salt Lake Sector 5"
              hint="An area, not a street address"
              value={area}
              onChange={(event) => setArea(event.target.value)}
              error={fieldErrors.area}
              required
            />
          </div>

          <ChoiceGroup
            legend="What kind of place?"
            choices={KINDS}
            value={kind}
            onChange={setKind}
            columns={3}
          />

          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>
              Save place
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {places.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          No saved places yet. Adding your home and workplace makes setting up a new
          journey a couple of taps instead of typing an area name again.
        </p>
      ) : (
        <ul className="space-y-2">
          {places.map((place) => (
            <li
              key={place.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-base bg-surface px-3 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Badge tone="neutral">
                  {KINDS.find((entry) => entry.value === place.kind)?.label ?? place.kind}
                </Badge>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">
                    {place.label}
                  </span>
                  <span className="block truncate text-xs text-muted">{place.area}</span>
                </span>
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(place.id)}
                loading={busyId === place.id}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
