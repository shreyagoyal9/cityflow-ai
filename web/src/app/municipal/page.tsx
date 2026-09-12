import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Notice } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { requireMunicipal } from "@/lib/auth/municipal";
import { getCity } from "@/lib/cities";
import { loadMetrics } from "@/lib/municipal/municipal-service";
import { STATUS_META } from "@/lib/municipal/workflow";

export const metadata: Metadata = { title: "Overview" };

/**
 * Municipal Dashboard — overview.
 *
 * Built as a WORK QUEUE, not a report. The first thing an officer sees is what
 * needs a decision today: high-priority issues still open, verified issues with
 * nobody assigned, and anything past its due date. A dashboard that opens with
 * a total count and a pie chart looks impressive and tells nobody what to do.
 */
export default async function MunicipalOverviewPage() {
  const user = await requireMunicipal();
  const city = getCity(user.cityCode);

  const metrics = await loadMetrics(city.code);

  const needsAttention =
    metrics.highPriorityOpen + metrics.unassignedVerified + metrics.overdue;

  return (
    <section className="py-8 sm:py-10">
      <Container width="wide">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            eyebrow={city.name}
            title="Road condition overview"
            description="Issues raised by citizens and phone sensors, prioritised by evidence, severity and how many trips pass through."
          />
          <ButtonLink href="/municipal/issues">Open the work queue</ButtonLink>
        </div>

        {/* ------------------------------------------------ needs attention */}
        <div className="mt-6">
          {needsAttention === 0 ? (
            <Notice tone="success">
              Nothing needs a decision right now. No high-priority issues are open, every
              verified issue has an owner, and nothing is past its due date.
            </Notice>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <AttentionTile
                value={metrics.highPriorityOpen}
                label="High priority, still open"
                detail={`Priority ${metrics.highPriorityThreshold} or above`}
                href="/municipal/issues?priority=high"
                urgent
              />
              <AttentionTile
                value={metrics.unassignedVerified}
                label="Verified, nobody assigned"
                detail="Confirmed real, waiting for an owner"
                href="/municipal/issues?status=VERIFIED"
              />
              <AttentionTile
                value={metrics.overdue}
                label="Past the due date"
                detail="Assigned work that has run over"
                href="/municipal/issues?status=OPEN"
              />
            </div>
          )}
        </div>

        {/* -------------------------------------------------------- pipeline */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader
                title="Where everything stands"
                description={`${metrics.total} issues recorded in ${city.name}.`}
              />

              {metrics.total === 0 ? (
                <p className="text-sm leading-relaxed text-muted">
                  No road issues have been reported in {city.name} yet. They arrive here
                  when a citizen files a report, or when several phones detect a jolt at
                  the same spot.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {Object.entries(STATUS_META).map(([status, meta]) => {
                    const count = metrics.byStatus[status] ?? 0;
                    const share = metrics.total === 0 ? 0 : (count / metrics.total) * 100;

                    return (
                      <li key={status}>
                        <Link
                          href={`/municipal/issues?status=${status}`}
                          className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
                        >
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="flex items-center gap-2">
                              <Badge tone={meta.tone}>{meta.label}</Badge>
                              <span className="hidden text-xs text-subtle sm:inline">
                                {meta.description}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-semibold text-fg">
                              {count}
                            </span>
                          </div>
                          <div
                            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
                            aria-hidden="true"
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${share}%` }}
                            />
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Repair performance" description="Last 30 days." />

              <dl className="space-y-3 text-sm">
                <Stat label="Repairs completed" value={String(metrics.completedLast30Days)} />
                <Stat
                  label="Mean time to repair"
                  value={
                    metrics.meanRepairHours === null
                      ? "Not enough data"
                      : formatHours(metrics.meanRepairHours)
                  }
                />
              </dl>

              <p className="mt-4 text-xs leading-relaxed text-subtle">
                Measured from the moment an inspector VERIFIED the defect, not from the
                first citizen report. The repair crews should not be measured on the
                inspection backlog.
              </p>
            </Card>

            <Card>
              <CardHeader
                title="Areas with the most open issues"
                description="Where the work is concentrated."
              />

              {metrics.hotspots.length === 0 ? (
                <p className="text-sm text-muted">No open issues.</p>
              ) : (
                <ol className="space-y-2">
                  {metrics.hotspots.map((spot, index) => (
                    <li
                      key={spot.areaLabel}
                      className="flex items-center justify-between gap-3 border-b border-border-base pb-2 last:border-0"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="w-4 shrink-0 text-sm font-semibold text-muted">
                          {index + 1}
                        </span>
                        <span className="truncate text-sm text-fg">{spot.areaLabel}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-fg">
                        {spot.count}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>

        {/* ------------------------------------------------- honesty footer */}
        <div className="mt-8 rounded-card border border-border-base bg-surface-2 p-5">
          <Badge tone="neutral">What this dashboard can and cannot see</Badge>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Every issue here was raised by citizens or by phone motion sensors. The number
            of reports is <span className="font-medium text-fg">evidence</span>, not proof:
            a hard jolt can be a speed breaker, a kerb or a dropped phone. Only an
            inspector can mark an issue verified, and this system never does so on their
            behalf.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            This portal cannot see who reported an issue, and has no access to any
            commuter&apos;s travel routine, departures or recommendations.
          </p>
        </div>
      </Container>
    </section>
  );
}

function AttentionTile({
  value,
  label,
  detail,
  href,
  urgent = false,
}: {
  value: number;
  label: string;
  detail: string;
  href: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        urgent && value > 0
          ? "rounded-card border-2 border-traffic-high bg-traffic-high-soft p-5 transition-opacity hover:opacity-90"
          : "rounded-card border border-border-base bg-surface p-5 shadow-card transition-colors hover:bg-surface-2"
      }
    >
      <p className="text-3xl font-semibold tracking-tight text-fg">{value}</p>
      <p className="mt-1 text-sm font-medium text-fg">{label}</p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-base pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold text-fg">{value}</dd>
    </div>
  );
}

/** "6.5 hours" / "2 days 4 hours" — hours alone stop being readable past a day. */
function formatHours(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);

  return rest === 0
    ? `${days} day${days === 1 ? "" : "s"}`
    : `${days} day${days === 1 ? "" : "s"} ${rest} hr`;
}
