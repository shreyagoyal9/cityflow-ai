import Link from "next/link";
import type { TravelProfile } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { DemandSlot } from "@/lib/demand/demand-model";
import { formatTime } from "@/lib/demand/time-slots";
import { demandBadgeTone, demandTextClass } from "@/lib/demand/ui";
import type { RoadIssueView } from "@/lib/roads/road-service";
import { confidenceMeta, issueTypeLabel } from "@/lib/roads/types";
import { getTransportMode } from "@/lib/travel";

/**
 * The smaller dashboard cards: current traffic status, road conditions and
 * travel options.
 *
 * They are grouped in one file because they are all short, read-only summaries
 * with no state of their own — splitting them into four files would add
 * navigation cost without adding clarity.
 */

/* -------------------------------------------------------------------------- */
/*  Traffic status right now                                                   */
/* -------------------------------------------------------------------------- */

export function TrafficStatusCard({ now, cityName }: { now: DemandSlot; cityName: string }) {
  return (
    <Card>
      <CardHeader
        title="Traffic status"
        description={`Predicted for ${cityName}, right now`}
        action={<Badge tone={demandBadgeTone(now.level)}>{now.label}</Badge>}
      />

      <p className={`text-3xl font-semibold tracking-tight ${demandTextClass(now.level)}`}>
        {now.label}
      </p>

      <p className="mt-2 text-sm leading-relaxed text-muted">
        Demand index {now.index} out of 100 for the {formatTime(now.time)} slot. Higher means
        closer to comfortable road capacity.
      </p>

      <p className="mt-3 text-xs leading-relaxed text-subtle">
        This is a modelled prediction of travel demand, not a live measurement of traffic on
        the road.
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  REMOVED IN PHASE 6 — RoutineCard                                           */
/* -------------------------------------------------------------------------- */
//
// `RoutineCard` rendered a person's single routine from their `TravelProfile`.
// It was deleted rather than kept, because a person now has MANY routines and
// those live in the `Journey` table. The profile still carries the old journey
// columns for migration purposes, so a component reading them would have
// compiled, rendered, and shown a stale trip — the worst kind of dead code,
// because it looks like it works.
//
// Journeys are shown by `components/journeys/journey-list.tsx` (management) and
// by the per-journey recommendation cards on the dashboard.

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-base pb-2 last:border-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Road conditions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Road conditions near the user.
 *
 * Shows the strongest few possible road issues reported in the areas this
 * person travels between, each with its evidence label in words. Nothing here
 * is ever described as a confirmed defect — see lib/roads/confidence.ts.
 */
export function RoadConditionsCard({
  area,
  issues,
}: {
  area: string;
  issues: RoadIssueView[];
}) {
  /*
    Two genuinely different situations, and they must not look the same:
      - nobody has reported anything here  -> an honest empty state
      - there are reports                  -> the strongest few, with evidence
    An empty list is NOT evidence that the roads are fine, and the copy below
    says so rather than letting silence imply an all-clear.
  */
  const top = issues.slice(0, 3);

  return (
    <Card>
      <CardHeader
        title="Road conditions near you"
        action={
          <Link
            href="/roads"
            className="rounded-md px-2 py-1 text-sm font-medium text-primary underline-offset-2 hover:bg-primary-soft hover:underline"
          >
            View all
          </Link>
        }
      />

      {top.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong bg-surface-2 p-5 text-center">
          <p className="text-sm font-medium text-fg">No road reports for {area} yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            Nobody using CityFlow AI has reported a problem here. That is not the same as the
            roads being fine — if you know of one,{" "}
            <Link href="/roads" className="font-medium text-primary underline underline-offset-2">
              report it in about thirty seconds
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {top.map((issue) => {
            const meta = confidenceMeta(issue.confidence);

            return (
              <li
                key={issue.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border-base bg-surface-2 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    {issueTypeLabel(issue.issueType)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {issue.areaLabel} · {issue.reportCount} report
                    {issue.reportCount === 1 ? "" : "s"}
                  </p>
                </div>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-subtle">
        Nothing here has been inspected. CityFlow AI identifies and prioritises possible
        issues; the municipal road-maintenance team — a separate service — inspects and
        repairs them.
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Travel options                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Modes the person could use, with an honest note on road impact.
 *
 * The ordering is deliberate: their own primary mode first (this is their
 * dashboard, not a lecture), then the alternatives they said they were open to,
 * then the rest.
 */
export function TravelOptionsCard({ profile }: { profile: TravelProfile }) {
  const primary = getTransportMode(profile.primaryMode);
  const openTo = profile.preferredModes
    .filter((code) => code !== profile.primaryMode)
    .map((code) => getTransportMode(code));

  const IMPACT_NOTE: Record<string, string> = {
    high: "Uses the most road space per traveller",
    medium: "Uses some road space per traveller",
    low: "Shares road space between many travellers",
    none: "Does not use road capacity",
  };

  return (
    <Card>
      <CardHeader
        title="Travel options"
        description="Your usual mode, and the alternatives you said you are open to."
      />

      <ul className="space-y-2">
        <li className="flex items-center justify-between gap-3 rounded-lg border border-primary bg-primary-soft p-3">
          <div>
            <p className="text-sm font-semibold text-primary">{primary.label}</p>
            <p className="text-xs text-muted">{IMPACT_NOTE[primary.roadImpact]}</p>
          </div>
          <Badge tone="primary">Your usual</Badge>
        </li>

        {openTo.map((mode) => (
          <li
            key={mode.code}
            className="flex items-center justify-between gap-3 rounded-lg border border-border-base bg-surface p-3"
          >
            <div>
              <p className="text-sm font-medium text-fg">{mode.label}</p>
              <p className="text-xs text-muted">{IMPACT_NOTE[mode.roadImpact]}</p>
            </div>
            <Badge tone="neutral">Open to</Badge>
          </li>
        ))}
      </ul>

      {openTo.length === 0 && (
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          You have not listed any alternative modes. You can add some from{" "}
          <Link href="/profile" className="font-medium text-primary underline">
            My profile
          </Link>{" "}
          if you would like to see other options here.
        </p>
      )}

      {(profile.carpoolInterest || profile.publicTransportInterest) && (
        <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
          You have registered interest in{" "}
          {[
            profile.carpoolInterest ? "carpooling" : null,
            profile.publicTransportInterest ? "public transport" : null,
          ]
            .filter(Boolean)
            .join(" and ")}
          . Matching for these is not built yet — nothing has been arranged on your behalf.
        </p>
      )}
    </Card>
  );
}
