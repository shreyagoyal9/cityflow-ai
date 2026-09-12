import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusActions } from "@/components/municipal/status-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { requireMunicipal } from "@/lib/auth/municipal";
import { getCity } from "@/lib/cities";
import {
  getIssue,
  listEmployeesWithWorkload,
} from "@/lib/municipal/municipal-service";
import { STATUS_META, allowedTransitions } from "@/lib/municipal/workflow";
import { confidenceMeta, issueTypeLabel, severityLabel } from "@/lib/roads/types";

export const metadata: Metadata = { title: "Road issue" };

/**
 * One road issue: the evidence, the audit trail, and what to do next.
 *
 * THE TWO COLUMNS ARE DELIBERATE
 * Left: what citizens reported — the evidence, never the reporters.
 * Right: what the council has done — the workflow and its history.
 *
 * Keeping them apart on screen mirrors the rule the data model enforces:
 * citizen evidence and municipal action are different kinds of claim, and
 * neither should be mistaken for the other.
 */
export default async function MunicipalIssuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireMunicipal();
  const city = getCity(user.cityCode);

  const { id } = await params;

  const [issue, employees] = await Promise.all([
    getIssue(city.code, id),
    listEmployeesWithWorkload(city.code),
  ]);

  if (!issue) notFound();

  const meta = STATUS_META[issue.status];
  const confidence = confidenceMeta(issue.confidence);

  const transitions = allowedTransitions(issue.status).map((status) => ({
    value: status,
    label: STATUS_META[status].label,
    description: STATUS_META[status].description,
  }));

  return (
    <section className="py-8 sm:py-10">
      <Container width="wide">
        <Link
          href="/municipal/issues"
          className="text-sm font-medium text-primary underline"
        >
          ← Back to the work queue
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">
                {issueTypeLabel(issue.issueType)}
              </h1>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              {issue.areaLabel}
              {issue.lat !== null && issue.lng !== null && (
                <span className="ml-2 font-mono text-xs text-subtle">
                  {issue.lat.toFixed(5)}, {issue.lng.toFixed(5)}
                </span>
              )}
            </p>
          </div>

          <div className="shrink-0 rounded-card border border-border-base bg-surface px-4 py-3 text-center shadow-card">
            <p className="text-2xl font-semibold text-fg">{issue.priorityScore}</p>
            <p className="text-[0.65rem] uppercase tracking-wider text-subtle">
              Priority score
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* ------------------------------------------- left: the evidence */}
          <div className="space-y-6">
            <Card>
              <CardHeader
                title="What citizens reported"
                description="Evidence, not proof. Only an inspection can confirm a defect."
              />

              <dl className="space-y-2.5 text-sm">
                <Row label="Reported severity" value={severityLabel(issue.severity)} />
                <Row
                  label="Independent reports"
                  value={`${issue.reportCount}${
                    issue.sensorReportCount > 0
                      ? ` (${issue.sensorReportCount} from phone sensors)`
                      : ""
                  }`}
                />
                <Row label="Evidence strength" value={confidence.label} />
                <Row
                  label="First reported"
                  value={issue.firstReportedAt.toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                />
                <Row
                  label="Last reported"
                  value={issue.lastReportedAt.toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                />
              </dl>

              <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
                {confidence.sentence}
              </p>
            </Card>

            <Card>
              <CardHeader
                title={`Reports (${issue.reports.length})`}
                description="Who reported an issue is never shown here, or anywhere in this portal."
              />

              {issue.reports.length === 0 ? (
                <p className="text-sm text-muted">No individual reports recorded.</p>
              ) : (
                <ul className="space-y-3">
                  {issue.reports.map((report) => (
                    <li
                      key={report.id}
                      className="rounded-lg border border-border-base bg-surface-2 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge tone={report.source === "SENSOR_DETECTION" ? "neutral" : "secondary"}>
                          {report.source === "SENSOR_DETECTION"
                            ? "Phone sensor"
                            : "Citizen report"}
                        </Badge>
                        <span className="text-xs text-subtle">
                          {report.createdAt.toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </div>

                      {report.description && (
                        <p className="mt-2 text-sm leading-relaxed text-fg">
                          {report.description}
                        </p>
                      )}

                      {report.impactMagnitude !== null && (
                        <p className="mt-1.5 text-xs text-subtle">
                          Peak vertical acceleration:{" "}
                          {report.impactMagnitude.toFixed(1)} m/s²
                        </p>
                      )}

                      {report.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={report.photo}
                          alt="Photograph submitted with this road issue report"
                          className="mt-2 max-h-48 w-full rounded-lg object-cover"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* ---------------------------------------- right: council action */}
          <div className="space-y-6">
            <StatusActions
              issueId={issue.id}
              currentStatus={issue.status}
              options={transitions}
              employees={employees
                .filter((employee) => employee.isActive)
                .map((employee) => ({
                  id: employee.id,
                  name: employee.name,
                  staffCode: employee.staffCode,
                  assignedArea: employee.assignedArea,
                  openIssues: employee.openIssues,
                }))}
            />

            <Card>
              <CardHeader title="Assignment" />
              <dl className="space-y-2.5 text-sm">
                <Row
                  label="Assigned to"
                  value={
                    issue.assignedEmployee
                      ? `${issue.assignedEmployee.name} (${issue.assignedEmployee.staffCode})`
                      : "Nobody yet"
                  }
                />
                <Row
                  label="Verified by"
                  value={issue.verifiedByEmployee?.name ?? "Not yet inspected"}
                />
                <Row
                  label="Due"
                  value={
                    issue.dueAt
                      ? issue.dueAt.toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                      : "No date set"
                  }
                />
              </dl>

              {issue.notes && (
                <p className="mt-4 rounded-lg bg-surface-2 p-3 text-sm leading-relaxed text-fg">
                  {issue.notes}
                </p>
              )}
            </Card>

            <Card>
              <CardHeader
                title="History"
                description="Every status change, with who made it."
              />

              {issue.events.length === 0 ? (
                <p className="text-sm text-muted">
                  No status changes yet. This issue has not been actioned.
                </p>
              ) : (
                <ol className="space-y-3">
                  {issue.events.map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <div
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-fg">
                          {event.fromStatus
                            ? `${STATUS_META[event.fromStatus].label} → ${
                                STATUS_META[event.toStatus].label
                              }`
                            : STATUS_META[event.toStatus].label}
                        </p>
                        <p className="mt-0.5 text-xs text-subtle">
                          {event.employee
                            ? `${event.employee.name} (${event.employee.staffCode})`
                            : "Municipal staff"}
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          {event.createdAt.toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                        {event.note && (
                          <p className="mt-1 text-sm leading-relaxed text-muted">
                            {event.note}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-base pb-2 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{value}</dd>
    </div>
  );
}
