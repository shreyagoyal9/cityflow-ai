"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { CounterfactualSlot } from "@/lib/demand/insights";

/**
 * "With CityFlow AI" against "if nobody moved".
 *
 * THE CHART THAT HAS TO BE RIGHT
 * This is the product's central claim rendered as a picture, so it is built to
 * the rules that stop a two-series chart from misleading:
 *
 *  - ONE AXIS. Both series are counts of the same thing — confirmed trips — so
 *    they share a scale. A second axis here would let any pair of shapes be
 *    made to look like any conclusion.
 *  - The scale is the larger of the two peaks, so neither series is clipped and
 *    the "before" bar is never cropped to flatter the "after" one.
 *  - A LEGEND IS ALWAYS PRESENT, and the two peaks are directly labelled, so
 *    identity never rests on colour alone.
 *  - Colours are the validated `series-1` / `series-2` tokens: ΔE 28 apart for
 *    normal vision and at least 23 under every simulated colour-vision
 *    deficiency. See the note in globals.css.
 *  - A TABLE VIEW holds the same numbers, for screen readers, for print, and
 *    for anybody who would rather read than compare bar heights.
 *  - Text stays in ink tokens. The coloured mark beside a label carries the
 *    identity; the label itself is never painted in the series colour.
 */

interface SmoothingComparisonProps {
  slots: CounterfactualSlot[];
  peakWithCityflow: number;
  peakIfNobodyMoved: number;
  peakReductionPercent: number;
  confirmedPlans: number;
  movedPlans: number;
  noNewPeakCreated: boolean;
  fromLabel: string;
  toLabel: string;
  cityName: string;
}

export function SmoothingComparison(props: SmoothingComparisonProps) {
  const [showTable, setShowTable] = useState(false);

  // One shared scale for both series. Never the per-series maximum.
  const scale = Math.max(props.peakIfNobodyMoved, props.peakWithCityflow, 1);

  return (
    <Card>
      <CardHeader
        title="Did the peak flatten, or just move?"
        description={`Confirmed departures in ${props.cityName}, ${props.fromLabel} to ${props.toLabel}.`}
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

      {/* ------------------------------------------------------ headline */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-subtle">
            Busiest 15 minutes
          </p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight text-fg">
            {props.peakIfNobodyMoved} → {props.peakWithCityflow}
            <span className="ml-2 text-base font-medium text-muted">
              {props.peakReductionPercent > 0
                ? `−${props.peakReductionPercent}%`
                : "no change"}
            </span>
          </p>
        </div>

        {/*
          The honest verdict, stated as a badge rather than buried.
          A peak reduction with a new peak elsewhere is not smoothing, and the
          page says which of the two happened.
        */}
        {props.noNewPeakCreated ? (
          <Badge tone="low">No new peak formed elsewhere</Badge>
        ) : (
          <Badge tone="high">A new peak formed — demand moved, not smoothed</Badge>
        )}
      </div>

      {/* -------------------------------------------------------- legend */}
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        <LegendItem colorClass="bg-series-2" label="If nobody moved" />
        <LegendItem colorClass="bg-series-1" label="With CityFlow AI" />
      </ul>

      {showTable ? (
        <TableView slots={props.slots} />
      ) : (
        <>
          {/* --------------------------------------------------- the chart */}
          <div className="overflow-x-auto">
            <ul className="flex min-w-[20rem] items-end gap-2" style={{ height: "9rem" }}>
              {props.slots.map((slot) => {
                const isPeakBefore = slot.ifNobodyMoved === props.peakIfNobodyMoved;
                const isPeakAfter = slot.withCityflow === props.peakWithCityflow;

                return (
                  <li
                    key={slot.minutes}
                    className="flex h-full flex-1 flex-col justify-end gap-1"
                  >
                    {/* Two bars, 2px apart, both measured against one scale. */}
                    <div className="flex h-full items-end gap-[2px]">
                      <Bar
                        value={slot.ifNobodyMoved}
                        scale={scale}
                        colorClass="bg-series-2"
                        title={`${slot.label} — if nobody moved: ${slot.ifNobodyMoved} trip${
                          slot.ifNobodyMoved === 1 ? "" : "s"
                        }`}
                        directLabel={isPeakBefore ? String(slot.ifNobodyMoved) : null}
                      />
                      <Bar
                        value={slot.withCityflow}
                        scale={scale}
                        colorClass="bg-series-1"
                        title={`${slot.label} — with CityFlow AI: ${slot.withCityflow} trip${
                          slot.withCityflow === 1 ? "" : "s"
                        }`}
                        directLabel={isPeakAfter ? String(slot.withCityflow) : null}
                      />
                    </div>

                    <span className="text-center text-[0.6rem] leading-none text-subtle">
                      {slot.time}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* The bars are decorative; this carries the same data as text. */}
          <p className="sr-only-cf">
            {props.slots
              .map(
                (slot) =>
                  `${slot.label}: ${slot.ifNobodyMoved} if nobody moved, ${slot.withCityflow} with CityFlow AI`
              )
              .join(". ")}
          </p>
        </>
      )}

      {/* --------------------------------------------------------- caveat */}
      <div className="mt-5 border-t border-border-base pt-4">
        <p className="text-sm leading-relaxed text-muted">
          Based on <span className="font-medium text-fg">{props.confirmedPlans}</span>{" "}
          confirmed {props.confirmedPlans === 1 ? "plan" : "plans"} today, of which{" "}
          <span className="font-medium text-fg">{props.movedPlans}</span>{" "}
          {props.movedPlans === 1 ? "moved" : "moved"} from their routine time.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          The &ldquo;if nobody moved&rdquo; figures are not a simulation. They are the same
          people counted at the departure time their own saved routine specifies, which is
          what they told us they would otherwise do. This compares{" "}
          <span className="font-medium">CityFlow AI users&apos; confirmed departures</span>{" "}
          — a small sample of the city&apos;s trips — and is not a measurement of traffic
          on the road.
        </p>
      </div>
    </Card>
  );
}

function Bar({
  value,
  scale,
  colorClass,
  title,
  directLabel,
}: {
  value: number;
  scale: number;
  colorClass: string;
  title: string;
  directLabel: string | null;
}) {
  // A zero keeps a 2px sliver so the slot is visibly present-and-empty rather
  // than looking like missing data.
  const percent = value === 0 ? 0 : Math.max(4, (value / scale) * 100);

  return (
    <div
      className="group relative flex h-full flex-1 cursor-default items-end"
      title={title}
    >
      {directLabel && (
        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[0.6rem] font-semibold text-fg">
          {directLabel}
        </span>
      )}
      <div
        className={`w-full rounded-t ${colorClass}`}
        style={{ height: value === 0 ? "2px" : `${percent}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

function LegendItem({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`h-3 w-3 shrink-0 rounded-sm ${colorClass}`}
        aria-hidden="true"
      />
      {/* Ink token, never the series colour. */}
      <span className="text-sm text-fg">{label}</span>
    </li>
  );
}

function TableView({ slots }: { slots: CounterfactualSlot[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-sm">
        <caption className="sr-only-cf">
          Confirmed departures per 15-minute slot, with and without CityFlow AI
        </caption>
        <thead>
          <tr className="border-b border-border-base text-left">
            <th scope="col" className="pb-2 font-medium text-muted">
              Time
            </th>
            <th scope="col" className="pb-2 text-right font-medium text-muted">
              If nobody moved
            </th>
            <th scope="col" className="pb-2 text-right font-medium text-muted">
              With CityFlow AI
            </th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.minutes} className="border-b border-border-base last:border-0">
              <th scope="row" className="py-2 text-left font-normal text-fg">
                {slot.label}
              </th>
              <td className="py-2 text-right text-fg">{slot.ifNobodyMoved}</td>
              <td className="py-2 text-right text-fg">{slot.withCityflow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
