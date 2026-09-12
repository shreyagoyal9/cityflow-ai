import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { requireMunicipal } from "@/lib/auth/municipal";
import { getCity } from "@/lib/cities";
import { listIssues } from "@/lib/municipal/municipal-service";
import { STATUS_META } from "@/lib/municipal/workflow";
import { issueTypeLabel, severityLabel } from "@/lib/roads/types";
import type { RoadIssueStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Road issues" };

/**
 * The work queue.
 *
 * Ordered by priority score, highest first — this is a list of things to do,
 * not a chronological log. Filters are plain links rather than a JavaScript
 * control, so the state lives in the URL: an officer can bookmark "high
 * priority, unassigned" and send that link to a colleague.
 */
export default async function MunicipalIssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; q?: string }>;
}) {
  const user = await requireMunicipal();
  const city = getCity(user.cityCode);

  const params = await searchParams;

  const status = (params.status ?? "OPEN") as RoadIssueStatus | "ALL" | "OPEN";
  const highPriorityOnly = params.priority === "high";

  const { issues, highPriorityThreshold } = await listIssues(city.code, {
    status,
    highPriorityOnly,
    search: params.q,
  });

  const filters: Array<{ label: string; value: string; href: string }> = [
    { label: "Open", value: "OPEN", href: "/municipal/issues?status=OPEN" },
    { label: "All", value: "ALL", href: "/municipal/issues?status=ALL" },
    ...Object.entries(STATUS_META).map(([key, meta]) => ({
      label: meta.label,
      value: key,
      href: `/municipal/issues?status=${key}`,
    })),
  ];

  return (
    <section className="py-8 sm:py-10">
      <Container width="wide">
        <SectionHeading
          eyebrow={city.name}
          title="Road issues"
          description="Ordered by priority: evidence strength, reported severity, and how many trips pass through the area."
        />

        {/* ---------------------------------------------------------- filters */}
        <div className="mt-6 flex flex-wrap gap-2">
          {filters.map((filter) => (
            <Link
              key={filter.value}
              href={filter.href}
              className={
                status === filter.value && !highPriorityOnly
                  ? "rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-on-primary"
                  : "rounded-full border border-border-base bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg"
              }
            >
              {filter.label}
            </Link>
          ))}

          <Link
            href="/municipal/issues?priority=high"
            className={
              highPriorityOnly
                ? "rounded-full bg-traffic-high px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-full border border-traffic-high/40 bg-traffic-high-soft px-3 py-1.5 text-xs font-medium text-traffic-high hover:opacity-90"
            }
          >
            High priority ({highPriorityThreshold}+)
          </Link>
        </div>

        {/* ------------------------------------------------------------ list */}
        <div className="mt-6">
          {issues.length === 0 ? (
            <Card>
              <p className="text-base font-medium text-fg">Nothing matches this filter</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {status === "OPEN"
                  ? "There is no open road work in this city right now."
                  : "Try a different status, or view all issues."}
              </p>
            </Card>
          ) : (
            <ul className="space-y-3">
              {issues.map((issue) => {
                const meta = STATUS_META[issue.status];
                const isHighPriority = issue.priorityScore >= highPriorityThreshold;

                return (
                  <li key={issue.id}>
                    <Link
                      href={`/municipal/issues/${issue.id}`}
                      className="block rounded-card border border-border-base bg-surface p-4 shadow-card transition-colors hover:bg-surface-2 sm:p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold text-fg">
                              {issueTypeLabel(issue.issueType)}
                            </h2>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                            {isHighPriority && (
                              <Badge tone="high">Immediate action required</Badge>
                            )}
                          </div>

                          <p className="mt-1 truncate text-sm text-muted">
                            {issue.areaLabel}
                          </p>

                          <p className="mt-2 text-xs text-subtle">
                            {issue.reportCount} report
                            {issue.reportCount === 1 ? "" : "s"}
                            {issue.sensorReportCount > 0 &&
                              ` (${issue.sensorReportCount} from phone sensors)`}
                            <Dot />
                            Severity: {severityLabel(issue.severity)}
                            <Dot />
                            Last reported{" "}
                            {issue.lastReportedAt.toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </p>

                          {issue.assignedEmployee && (
                            <p className="mt-2 text-xs text-fg">
                              Assigned to{" "}
                              <span className="font-medium">
                                {issue.assignedEmployee.name}
                              </span>{" "}
                              <span className="text-subtle">
                                ({issue.assignedEmployee.staffCode})
                              </span>
                            </p>
                          )}

                          {issue.dueAt && issue.status !== "COMPLETED" && (
                            <p
                              className={
                                issue.dueAt < new Date()
                                  ? "mt-1 text-xs font-medium text-traffic-high"
                                  : "mt-1 text-xs text-muted"
                              }
                            >
                              Due{" "}
                              {issue.dueAt.toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })}
                              {issue.dueAt < new Date() && " — overdue"}
                            </p>
                          )}
                        </div>

                        {/* Priority score, prominent because it drives the order */}
                        <div
                          className={
                            isHighPriority
                              ? "shrink-0 rounded-lg bg-traffic-high-soft px-3 py-2 text-center"
                              : "shrink-0 rounded-lg bg-surface-2 px-3 py-2 text-center"
                          }
                        >
                          <p
                            className={
                              isHighPriority
                                ? "text-xl font-semibold text-traffic-high"
                                : "text-xl font-semibold text-fg"
                            }
                          >
                            {issue.priorityScore}
                          </p>
                          <p className="text-[0.65rem] uppercase tracking-wider text-subtle">
                            Priority
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="mt-6 text-xs leading-relaxed text-subtle">
          The priority score combines evidence strength, reported severity and how many
          trips pass through the area. It is a ranking aid, not an inspection result — an
          issue is only a confirmed defect once an officer has been to the site.
        </p>
      </Container>
    </section>
  );
}

function Dot() {
  return (
    <span className="mx-1.5" aria-hidden="true">
      ·
    </span>
  );
}
