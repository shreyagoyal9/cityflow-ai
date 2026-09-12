import type { Metadata } from "next";

import { CitySwitcher } from "@/components/admin/city-switcher";
import { DayCurve } from "@/components/admin/day-curve";
import {
  FreshnessPanel,
  ModeSplitPanel,
  RecommendationPanel,
  StatTile,
  SystemHealthPanel,
} from "@/components/admin/panels";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import {
  loadCityOverview,
  loadModelledImpact,
  loadSystemHealth,
} from "@/lib/admin/analytics";
import { ImpactPanel } from "@/components/admin/impact-panel";
import { appDateOnly, formatAppDate } from "@/lib/app-time";
import { getCity } from "@/lib/cities";
import { DEMAND_LEVEL_LABEL } from "@/lib/demand/demand-model";
import { formatSlotLabel } from "@/lib/demand/time-slots";
import { demandBadgeTone } from "@/lib/demand/ui";

export const metadata: Metadata = { title: "City overview" };

/**
 * Admin Portal — city overview.
 *
 * The first screen answers, in order: how busy is the city right now, when are
 * the peaks, how many people are participating, and is anything broken.
 *
 * Every number on this page is a count or a model prediction. Nothing here can
 * be traced back to an individual — see the privacy note in lib/admin/analytics.ts.
 */
export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const params = await searchParams;
  const city = getCity(params.city);

  const [overview, health, impact] = await Promise.all([
    loadCityOverview(city.code),
    loadSystemHealth(city.code),
    loadModelledImpact(city.code, appDateOnly()),
  ]);

  const participationRate =
    overview.participation.totalUsers > 0
      ? Math.round(
          (overview.participation.withRoutine / overview.participation.totalUsers) * 100
        )
      : null;

  return (
    <section className="py-8">
      <Container width="wide">
        {/* --------------------------------------------------------- header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              City overview
            </h1>
            <p className="mt-2 text-sm text-muted">
              {overview.cityName} · {formatAppDate()}
            </p>
          </div>

          <CitySwitcher active={city.code} basePath="/admin" />
        </div>

        {/* -------------------------------------------------- modelled impact */}
        <div className="mt-6">
          <ImpactPanel impact={impact} cityName={overview.cityName} />
        </div>

        {/* ------------------------------------------------------- top tiles */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Demand right now"
            value={DEMAND_LEVEL_LABEL[overview.now.level]}
            detail={`Index ${overview.now.index}/100 at ${formatSlotLabel(overview.now.minutes)}`}
          />
          <StatTile
            label="Slots over capacity"
            value={String(overview.overCapacityCount)}
            detail="15-minute slots predicted at or above comfortable capacity today"
            tone={overview.overCapacityCount > 0 ? "alert" : "default"}
          />
          <StatTile
            label="Confirmed plans today"
            value={String(overview.participation.confirmedToday)}
            detail={
              overview.participation.cancelledToday > 0
                ? `${overview.participation.cancelledToday} cancelled`
                : "People who told the assistant their plan"
            }
          />
          <StatTile
            label="Recommendations adjusted"
            value={String(overview.recommendations.movedByOptimiser)}
            detail="Moved by the city-wide optimiser to keep trips spread out"
          />
        </div>

        {/* ---------------------------------------------------- peak periods */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DayCurve slots={overview.dayCurve} cityName={overview.cityName} />
          </div>

          <Card>
            <CardHeader
              title="Predicted peak periods"
              description="The three busiest slots today."
            />

            <ol className="space-y-3">
              {overview.peakSlots.map((slot, index) => (
                <li
                  key={slot.minutes}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-base p-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-fg">
                      {formatSlotLabel(slot.minutes)}
                    </p>
                    <p className="text-xs text-muted">
                      Index {slot.index}/100
                      {slot.confirmedTrips > 0 && (
                        <> · {slot.confirmedTrips} confirmed</>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-subtle">#{index + 1}</span>
                    <Badge tone={demandBadgeTone(slot.level)}>{slot.label}</Badge>
                  </div>
                </li>
              ))}
            </ol>

            <p className="mt-4 text-xs leading-relaxed text-subtle">
              A peak is where the demand model expects the most trips to start. It is a
              prediction of demand, not a measurement of congestion on the road.
            </p>
          </Card>
        </div>

        {/* ------------------------------------------------- participation */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Registered commuters"
            value={String(overview.participation.totalUsers)}
            detail={`in ${overview.cityName}`}
          />
          <StatTile
            label="Completed a routine"
            value={String(overview.participation.withRoutine)}
            detail={
              participationRate === null
                ? "No registered commuters yet"
                : `${participationRate}% of registered commuters`
            }
          />
          <StatTile
            label="Counted in city figures"
            value={String(overview.participation.sharingDemand)}
            detail="People who left city-level counting switched on"
          />
          <StatTile
            label="Recommendations today"
            value={String(overview.recommendations.total)}
            detail={`${overview.recommendations.pending} still undecided`}
          />
        </div>

        {/* --------------------------------------------------------- panels */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <RecommendationPanel stats={overview.recommendations} />
          <ModeSplitPanel modes={overview.modeSplit} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <FreshnessPanel freshness={overview.freshness} />
          <SystemHealthPanel health={health} />
        </div>

        {/* ------------------------------------------------- privacy notice */}
        <div className="mt-8 rounded-card border border-border-base bg-surface-2 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="secondary">Privacy</Badge>
          </div>
          <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted">
            This portal shows aggregated counts only. It cannot show an individual
            traveller, and the queries behind it do not select a user id, a CityFlow ID or an
            email — the boundary is in the code, not in a policy. People who switched off
            city-level counting during onboarding are excluded from every figure on this page.
          </p>
          <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted">
            The Admin Portal is separate from the{" "}
            <span className="font-medium text-fg">Municipal Dashboard</span>, which is an
            existing system for road inspection and repair. Neither controls the other, and
            the Municipal Dashboard has no authority over departure recommendations.
          </p>
        </div>
      </Container>
    </section>
  );
}
