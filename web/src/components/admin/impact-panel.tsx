import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { ModelledImpact } from "@/lib/admin/analytics";

/**
 * Modelled impact.
 *
 * THE RULE THIS COMPONENT ENFORCES
 * It is impossible to render these numbers here without their assumptions,
 * because the assumptions are inside the same card, above the fold, in normal
 * body text — not a tooltip, not a footnote, not a link.
 *
 * That is deliberate. A figure like "250 person-hours saved" is exactly the
 * kind of thing that ends up in a slide deck with the caveat stripped off. It
 * cannot be prevented entirely, but the component can at least refuse to make
 * the stripped-down version the convenient one.
 */
export function ImpactPanel({ impact, cityName }: { impact: ModelledImpact; cityName: string }) {
  const acceptanceRate =
    impact.offeredToday === 0
      ? null
      : Math.round((impact.acceptedToday / impact.offeredToday) * 100);

  return (
    <Card>
      <CardHeader
        title="Modelled impact today"
        description={`${cityName}. Every figure below is an estimate from the demand model — none is a measurement.`}
        action={<Badge tone="moderate">Estimates</Badge>}
      />

      {impact.acceptedToday === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          Nobody has accepted a departure recommendation in {cityName} today, so there is
          nothing to estimate. This panel deliberately shows nothing rather than zeroes —
          &ldquo;0 minutes saved&rdquo; reads as a measured result, and no measurement has
          been taken.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              value={String(impact.acceptedToday)}
              caption="Recommendations followed"
              detail={
                acceptanceRate === null
                  ? `of ${impact.offeredToday} shown`
                  : `${acceptanceRate}% of ${impact.offeredToday} shown`
              }
            />
            <Tile
              value={`~${impact.estimatedPersonHours}`}
              caption="Est. person-hours saved"
              detail={`${impact.estimatedMinutesSaved} minutes in total`}
            />
            <Tile
              value={`~${impact.estimatedFuelLitres} L`}
              caption="Est. fuel not burned"
              detail={`${Math.round(impact.vehicleShare * 100)}% of trips were private vehicles`}
            />
            <Tile
              value={String(impact.highPriorityRoadIssues)}
              caption="High-priority road issues"
              detail="Open, at or above this city's threshold"
              urgent={impact.highPriorityRoadIssues > 0}
            />
          </div>

          {/* ------------------------------------------- the assumptions */}
          <div className="mt-5 rounded-lg border border-border-base bg-surface-2 p-4">
            <p className="text-sm font-semibold text-fg">
              What these numbers are, precisely
            </p>

            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
              <li>
                <span className="font-medium text-fg">Time saved</span> is the difference
                between the journey length the demand model expects at each person&apos;s
                usual departure and at the one they accepted, using the light-traffic
                journey time they entered themselves. No journey has been timed.
              </li>
              {impact.fuelAssumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
              <li>
                Only <span className="font-medium text-fg">accepted</span> recommendations
                are counted, so this is a lower bound on modelled effect — and says
                nothing about traffic on the road, which CityFlow AI does not observe.
              </li>
            </ul>
          </div>
        </>
      )}
    </Card>
  );
}

function Tile({
  value,
  caption,
  detail,
  urgent = false,
}: {
  value: string;
  caption: string;
  detail: string;
  urgent?: boolean;
}) {
  return (
    <div
      className={
        urgent
          ? "rounded-lg border border-traffic-high/40 bg-traffic-high-soft p-4"
          : "rounded-lg border border-border-base bg-surface p-4"
      }
    >
      <p className="text-2xl font-semibold tracking-tight text-fg">{value}</p>
      <p className="mt-1 text-sm font-medium text-fg">{caption}</p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </div>
  );
}
