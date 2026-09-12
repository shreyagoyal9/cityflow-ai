"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { AdjustedDemandSlot } from "@/lib/demand/aggregate";
import { formatSlotLabel } from "@/lib/demand/time-slots";
import { demandBarClass, demandMarker } from "@/lib/demand/ui";

/**
 * Predicted demand across the whole day.
 *
 * ONE SERIES, SO NO LEGEND BOX — the title names it. What the colour carries is
 * not identity but STATUS: low / moderate / high / very high. That is a
 * reserved four-step palette in this design system, and it always ships with a
 * text label and a shape marker, so a reader who cannot distinguish the hues
 * still gets the level. The hover title and the table view carry the exact
 * index for every slot.
 *
 * The scale is fixed to 0-100, never the day's local maximum. A quiet Sunday
 * should LOOK quiet; stretching it to fill the chart would make every day look
 * equally bad, which is the opposite of useful.
 */

interface DayCurveProps {
  slots: AdjustedDemandSlot[];
  peakMinutes: number | null;
  cityName: string;
  /** Marked on the chart, so a person can find their own departure. */
  markers?: Array<{ minutes: number; label: string }>;
}

export function DayCurve({ slots, peakMinutes, cityName, markers = [] }: DayCurveProps) {
  const [showTable, setShowTable] = useState(false);

  const markerByMinute = new Map(markers.map((marker) => [marker.minutes, marker.label]));

  return (
    <Card>
      <CardHeader
        title="Predicted demand today"
        description={`${cityName}, in 15-minute slots. Higher means closer to comfortable road capacity.`}
        action={
          <button
            type="button"
            onClick={() => setShowTable((open) => !open)}
            aria-expanded={showTable}
            className="text-sm font-medium text-primary underline"
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        }
      />

      {showTable ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only-cf">
              Predicted demand index per 15-minute slot for {cityName}
            </caption>
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border-base text-left">
                <th scope="col" className="pb-2 font-medium text-muted">
                  Time
                </th>
                <th scope="col" className="pb-2 text-right font-medium text-muted">
                  Index
                </th>
                <th scope="col" className="pb-2 text-right font-medium text-muted">
                  Level
                </th>
              </tr>
            </thead>
            <tbody>
              {slots
                // Every fourth slot: one row an hour keeps the table readable.
                .filter((slot) => slot.minutes % 60 === 0)
                .map((slot) => (
                  <tr key={slot.minutes} className="border-b border-border-base last:border-0">
                    <th scope="row" className="py-1.5 text-left font-normal text-fg">
                      {formatSlotLabel(slot.minutes)}
                    </th>
                    <td className="py-1.5 text-right text-fg">{slot.index}</td>
                    <td className="py-1.5 text-right text-muted">{slot.label}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <ul
              className="flex min-w-[36rem] items-end gap-[2px]"
              style={{ height: "8rem" }}
            >
              {slots.map((slot) => {
                const isPeak = slot.minutes === peakMinutes;
                const marker = markerByMinute.get(slot.minutes);

                return (
                  <li
                    key={slot.minutes}
                    className="relative flex h-full flex-1 cursor-default items-end"
                    title={`${formatSlotLabel(slot.minutes)} — ${slot.label} (${slot.index}/100)${
                      slot.confirmedTrips > 0
                        ? `, ${slot.confirmedTrips} confirmed trip${slot.confirmedTrips === 1 ? "" : "s"}`
                        : ""
                    }`}
                  >
                    {marker && (
                      <span className="absolute -top-1 left-1/2 z-10 h-2 w-2 -translate-x-1/2 rounded-full bg-primary ring-2 ring-surface" />
                    )}
                    <div
                      className={`w-full rounded-t ${demandBarClass(slot.level)} ${
                        isPeak ? "ring-2 ring-fg/30" : ""
                      }`}
                      style={{ height: `${Math.max(2, slot.index)}%` }}
                      aria-hidden="true"
                    />
                  </li>
                );
              })}
            </ul>

            {/* Hour ticks, not one label per slot. */}
            <div className="mt-1.5 flex min-w-[36rem] justify-between text-[0.6rem] text-subtle">
              {[0, 4, 8, 12, 16, 20, 24].map((hour) => (
                <span key={hour}>{hour === 24 ? "24:00" : `${String(hour).padStart(2, "0")}:00`}</span>
              ))}
            </div>
          </div>

          {markers.length > 0 && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              {markers.map((marker) => marker.label).join(" · ")}
            </p>
          )}

          {peakMinutes !== null && (
            <p className="mt-3 text-sm text-muted">
              Today&apos;s predicted peak is around{" "}
              <span className="font-medium text-fg">{formatSlotLabel(peakMinutes)}</span>.
            </p>
          )}

          {/* The bars are decorative; this is the same data as text. */}
          <p className="sr-only-cf">
            {slots
              .filter((slot) => slot.minutes % 60 === 0)
              .map((slot) => `${formatSlotLabel(slot.minutes)}: ${slot.label}, ${slot.index} out of 100`)
              .join(". ")}
          </p>
        </>
      )}

      {/* Status key — text and shape, never colour alone. */}
      <ul className="mt-4 flex flex-wrap gap-2 border-t border-border-base pt-4">
        {(
          [
            { level: "LOW" as const, label: "Low" },
            { level: "MODERATE" as const, label: "Moderate" },
            { level: "HIGH" as const, label: "High" },
            { level: "VERY_HIGH" as const, label: "Very high" },
          ]
        ).map((entry) => (
          <li key={entry.level} className="flex items-center gap-1.5">
            <span
              className={`h-3 w-3 rounded-sm ${demandBarClass(entry.level)}`}
              aria-hidden="true"
            />
            <span className="text-xs text-muted">
              <span aria-hidden="true">{demandMarker(entry.level)} </span>
              {entry.label}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs leading-relaxed text-subtle">
        These are <span className="font-medium">model predictions</span>, not live traffic
        counts. The curve is the shape urban demand normally takes for this city and day of
        the week, raised by every departure CityFlow AI users have confirmed and by any
        recorded disruption.
      </p>
    </Card>
  );
}
