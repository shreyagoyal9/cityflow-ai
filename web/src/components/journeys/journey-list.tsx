"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/input";
import { formatTime } from "@/lib/demand/time-slots";

/**
 * The list of a person's recurring journeys, with reordering and deletion.
 *
 * REORDERING IS BUTTONS, NOT DRAG-AND-DROP.
 * Drag-and-drop is the obvious choice and the wrong one here. It is difficult
 * on a phone, effectively unusable with a screen reader or a keyboard, and this
 * is a civic product that should work for everybody. Up and down buttons are
 * plain, keyboard-native, and announced correctly with no extra work.
 *
 * DELETION ASKS TWICE.
 * Deleting a journey takes its recommendation history with it. The second press
 * is inline rather than a modal dialog — a browser confirm() would block the
 * page, and a modal is more machinery than this decision deserves.
 */

export interface JourneyRow {
  id: string;
  label: string;
  originArea: string;
  destinationArea: string;
  usualDeparture: string;
  requiredArrival: string;
  travelDays: string[];
  isFlexible: boolean;
  flexibilityMinutes: number;
  isActive: boolean;
  mode: string;
}

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_SHORT: Record<string, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

export function JourneyList({ journeys }: { journeys: JourneyRow[] }) {
  const router = useRouter();

  const [rows, setRows] = useState(journeys);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;

    // Reorder locally first so the list responds instantly, then persist. If
    // the save fails the list is restored from the server by `router.refresh`.
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);

    try {
      const response = await fetch("/api/journeys/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: next.map((row) => row.id) }),
      });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setError("The new order could not be saved. Please try again.");
      setRows(rows);
    }
  }

  async function togglePause(row: JourneyRow) {
    setBusyId(row.id);
    setError(null);

    try {
      const response = await fetch(`/api/journeys/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!response.ok) throw new Error();

      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, isActive: !item.isActive } : item
        )
      );
      router.refresh();
    } catch {
      setError("Could not update this journey. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);

    try {
      const response = await fetch(`/api/journeys/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();

      setRows((current) => current.filter((row) => row.id !== id));
      setConfirmingId(null);
      router.refresh();
    } catch {
      setError("Could not delete this journey. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border-strong bg-surface-2 p-8 text-center">
        <p className="text-base font-medium text-fg">No journeys yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Add a trip you make regularly and CityFlow AI will start suggesting departure
          times for it. Most people add their morning commute first, then their journey
          home.
        </p>
        <div className="mt-5">
          <Link
            href="/journeys/new"
            className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover"
          >
            Add your first journey
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}

      <ul className="space-y-3">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className={
              row.isActive
                ? "rounded-card border border-border-base bg-surface p-4 shadow-card sm:p-5"
                : "rounded-card border border-border-base bg-surface-2 p-4 sm:p-5"
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-fg">{row.label}</h3>
                  {!row.isActive && <Badge tone="neutral">Paused</Badge>}
                  {row.isActive && !row.isFlexible && (
                    <Badge tone="neutral">Fixed time</Badge>
                  )}
                </div>

                <p className="mt-1 truncate text-sm text-muted">
                  {row.originArea} → {row.destinationArea}
                </p>

                <p className="mt-2 text-sm text-fg">
                  Leaves {formatTime(row.usualDeparture)}
                  <span className="mx-2 text-border-strong" aria-hidden="true">
                    ·
                  </span>
                  arrive by {formatTime(row.requiredArrival)}
                  {row.isFlexible && row.flexibilityMinutes > 0 && (
                    <>
                      <span className="mx-2 text-border-strong" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-muted">±{row.flexibilityMinutes} min</span>
                    </>
                  )}
                </p>

                <div className="mt-2 flex flex-wrap gap-1">
                  {DAY_ORDER.filter((day) => row.travelDays.includes(day)).map((day) => (
                    <span
                      key={day}
                      className="rounded border border-border-base bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted"
                    >
                      {DAY_SHORT[day]}
                    </span>
                  ))}
                </div>
              </div>

              {/*
                Reorder controls.

                44px square and laid out side by side rather than stacked: two
                32px buttons one above the other is a miss waiting to happen on
                a phone, and stacking them made the card taller on exactly the
                screen where height is scarcest.
              */}
              <div className="flex shrink-0 gap-1.5">
                <IconButton
                  label={`Move ${row.label} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </IconButton>
                <IconButton
                  label={`Move ${row.label} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </IconButton>
              </div>
            </div>

            {/* -------------------------------------------------- actions */}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border-base pt-4">
              <Link
                href={`/journeys/${row.id}/edit`}
                className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2"
              >
                Edit
              </Link>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => togglePause(row)}
                loading={busyId === row.id && confirmingId !== row.id}
              >
                {row.isActive ? "Pause" : "Resume"}
              </Button>

              {confirmingId === row.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted">
                    Delete this journey and its history?
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => remove(row.id)}
                    loading={busyId === row.id}
                  >
                    Yes, delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                    Keep it
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setConfirmingId(row.id)}
                >
                  Delete
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border-base bg-surface text-base text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
