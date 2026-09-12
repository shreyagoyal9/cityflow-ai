import type { Employee, RoadIssue, RoadIssueStatus } from "@prisma/client";

import type { CityCode } from "@/lib/cities";
import { getCityConfig } from "@/lib/city-config";
import { prisma } from "@/lib/db";
import { ACTIVE_STATUSES, canTransition, explainRefusal } from "@/lib/municipal/workflow";
import type { EmployeeInput } from "@/lib/validation";

/**
 * The Municipal Dashboard's data layer: road issues as WORK, and the people who
 * do it.
 *
 * SCOPE, AND WHAT IS DELIBERATELY ABSENT
 * Nothing in this module can read a commuter's travel profile, journeys,
 * recommendations or chat history — and nothing here should ever be given the
 * ability to. A municipal officer needs to know that a stretch of road is
 * broken and how many people pass over it. They do not need to know who
 * reported it, and the reporter's identity never leaves `road_issue_reports`.
 */

/* -------------------------------------------------------------------------- */
/*  Employees                                                                  */
/* -------------------------------------------------------------------------- */

export async function listEmployees(cityCode: CityCode): Promise<Employee[]> {
  return prisma.employee.findMany({
    where: { cityCode },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

/** Employees with their current open workload, for the assignment picker. */
export async function listEmployeesWithWorkload(cityCode: CityCode) {
  const [employees, counts] = await Promise.all([
    listEmployees(cityCode),
    prisma.roadIssue.groupBy({
      by: ["assignedEmployeeId"],
      where: { cityCode, status: { in: ACTIVE_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const openByEmployee = new Map(
    counts
      .filter((row) => row.assignedEmployeeId !== null)
      .map((row) => [row.assignedEmployeeId!, row._count._all])
  );

  return employees.map((employee) => ({
    ...employee,
    openIssues: openByEmployee.get(employee.id) ?? 0,
  }));
}

export class DuplicateStaffCodeError extends Error {
  constructor(staffCode: string) {
    super(`Staff number ${staffCode} is already used by another employee in this city.`);
    this.name = "DuplicateStaffCodeError";
  }
}

export async function createEmployee(
  cityCode: CityCode,
  input: EmployeeInput
): Promise<Employee> {
  const existing = await prisma.employee.findUnique({
    where: { cityCode_staffCode: { cityCode, staffCode: input.staffCode } },
  });

  // Checked explicitly rather than caught as a unique-constraint violation, so
  // the person gets a sentence about staff numbers instead of a database error.
  if (existing) throw new DuplicateStaffCodeError(input.staffCode);

  return prisma.employee.create({
    data: {
      cityCode,
      staffCode: input.staffCode,
      name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      assignedArea: input.assignedArea || null,
      role: input.role,
      isActive: input.isActive,
    },
  });
}

export async function updateEmployee(
  cityCode: CityCode,
  employeeId: string,
  input: EmployeeInput
): Promise<Employee | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });

  // Scoped to the city, so an officer in one city cannot edit another's records
  // by guessing an id.
  if (!employee || employee.cityCode !== cityCode) return null;

  if (employee.staffCode !== input.staffCode) {
    const clash = await prisma.employee.findUnique({
      where: { cityCode_staffCode: { cityCode, staffCode: input.staffCode } },
    });
    if (clash) throw new DuplicateStaffCodeError(input.staffCode);
  }

  return prisma.employee.update({
    where: { id: employeeId },
    data: {
      staffCode: input.staffCode,
      name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      assignedArea: input.assignedArea || null,
      role: input.role,
      isActive: input.isActive,
    },
  });
}

export interface DeactivateResult {
  ok: boolean;
  error?: string;
  openIssues?: number;
}

/**
 * Deactivates an employee.
 *
 * NOT a delete. Their name appears in the audit trail of every issue they
 * touched, and removing the row would leave those records pointing at nobody —
 * which is precisely what an audit trail exists to prevent. Deactivating keeps
 * the history and takes them out of the assignment picker.
 *
 * Refused while they still hold open work, because silently orphaning assigned
 * repairs is how jobs get lost.
 */
export async function deactivateEmployee(
  cityCode: CityCode,
  employeeId: string
): Promise<DeactivateResult> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || employee.cityCode !== cityCode) {
    return { ok: false, error: "That employee was not found." };
  }

  const openIssues = await prisma.roadIssue.count({
    where: { assignedEmployeeId: employeeId, status: { in: ACTIVE_STATUSES } },
  });

  if (openIssues > 0) {
    return {
      ok: false,
      openIssues,
      error: `${employee.name} still has ${openIssues} open ${
        openIssues === 1 ? "job" : "jobs"
      }. Reassign them before deactivating this employee.`,
    };
  }

  await prisma.employee.update({ where: { id: employeeId }, data: { isActive: false } });
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Road issues as work                                                        */
/* -------------------------------------------------------------------------- */

export interface IssueFilters {
  status?: RoadIssueStatus | "ALL" | "OPEN";
  employeeId?: string;
  /** Only issues at or above the city's high-priority threshold. */
  highPriorityOnly?: boolean;
  search?: string;
}

export async function listIssues(cityCode: CityCode, filters: IssueFilters = {}) {
  const config = await getCityConfig(cityCode);

  const statusFilter =
    filters.status === undefined || filters.status === "ALL"
      ? undefined
      : filters.status === "OPEN"
        ? { notIn: ["CLOSED", "REJECTED"] as RoadIssueStatus[] }
        : filters.status;

  const issues = await prisma.roadIssue.findMany({
    where: {
      cityCode,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(filters.employeeId ? { assignedEmployeeId: filters.employeeId } : {}),
      ...(filters.highPriorityOnly
        ? { priorityScore: { gte: config.highPriorityThreshold } }
        : {}),
      ...(filters.search
        ? { areaLabel: { contains: filters.search, mode: "insensitive" as const } }
        : {}),
    },
    // Highest priority first — the list is a work queue, not a log.
    orderBy: [{ priorityScore: "desc" }, { lastReportedAt: "desc" }],
    take: 200,
    include: {
      assignedEmployee: { select: { id: true, name: true, staffCode: true } },
      verifiedByEmployee: { select: { id: true, name: true } },
    },
  });

  return { issues, highPriorityThreshold: config.highPriorityThreshold };
}

/** One issue with its full audit trail. */
export async function getIssue(cityCode: CityCode, issueId: string) {
  const issue = await prisma.roadIssue.findUnique({
    where: { id: issueId },
    include: {
      assignedEmployee: true,
      verifiedByEmployee: true,
      events: {
        orderBy: { createdAt: "asc" },
        include: { employee: { select: { name: true, staffCode: true } } },
      },
      /*
        Reports are included WITHOUT their userId.
        The municipal side needs to know how many reports there are, how severe
        people said it was and what they wrote — never who wrote it.
      */
      reports: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          source: true,
          description: true,
          photo: true,
          impactMagnitude: true,
          createdAt: true,
        },
      },
    },
  });

  if (!issue || issue.cityCode !== cityCode) return null;
  return issue;
}

export interface StatusChangeArgs {
  cityCode: CityCode;
  issueId: string;
  toStatus: RoadIssueStatus;
  employeeId?: string;
  dueAt?: string;
  note?: string;
  /** The signed-in account making the change, for the audit trail. */
  actorUserId: string;
}

export interface StatusChangeResult {
  ok: boolean;
  error?: string;
  issue?: RoadIssue;
}

/**
 * Moves an issue through the workflow, writing an audit row.
 *
 * Everything happens in one transaction: the status, the timestamps, the
 * assignment and the audit entry. A status that changed without its audit row
 * is worse than no audit trail at all, because it looks complete.
 */
export async function changeStatus(args: StatusChangeArgs): Promise<StatusChangeResult> {
  const { cityCode, issueId, toStatus, employeeId, dueAt, note, actorUserId } = args;

  const issue = await prisma.roadIssue.findUnique({ where: { id: issueId } });
  if (!issue || issue.cityCode !== cityCode) {
    return { ok: false, error: "That road issue was not found." };
  }

  if (!canTransition(issue.status, toStatus)) {
    return { ok: false, error: explainRefusal(issue.status, toStatus) };
  }

  // An assignment needs a real, active employee in this city.
  let employee: Employee | null = null;
  if (employeeId) {
    employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.cityCode !== cityCode) {
      return { ok: false, error: "That employee was not found in this city." };
    }
    if (!employee.isActive) {
      return {
        ok: false,
        error: `${employee.name} is no longer active and cannot be assigned new work.`,
      };
    }
  }

  const now = new Date();

  /*
    Timestamps are set from the transition, never sent by the client.
    A completion time the browser can choose is a completion time that can be
    backdated, and this is a public-works record.
  */
  const timestamps: Partial<
    Record<
      "verifiedAt" | "assignedAt" | "acknowledgedAt" | "startedAt" | "completedAt",
      Date
    >
  > = {};

  if (toStatus === "VERIFIED") timestamps.verifiedAt = now;
  if (toStatus === "ASSIGNED") timestamps.assignedAt = now;
  if (toStatus === "ACKNOWLEDGED") timestamps.acknowledgedAt = now;
  if (toStatus === "IN_PROGRESS") timestamps.startedAt = now;
  if (toStatus === "COMPLETED") timestamps.completedAt = now;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.roadIssue.update({
        where: { id: issueId },
        data: {
          status: toStatus,
          ...timestamps,
          ...(toStatus === "VERIFIED" && employee
            ? { verifiedByEmployeeId: employee.id }
            : {}),
          ...(toStatus === "ASSIGNED" && employee
            ? { assignedEmployeeId: employee.id }
            : {}),
          ...(dueAt ? { dueAt: new Date(`${dueAt}T00:00:00.000Z`) } : {}),
          ...(note ? { notes: note } : {}),
        },
      });

      await tx.roadIssueEvent.create({
        data: {
          roadIssueId: issueId,
          fromStatus: issue.status,
          toStatus,
          employeeId: employee?.id ?? issue.assignedEmployeeId ?? null,
          actorUserId,
          note: note || null,
        },
      });

      return result;
    });

    return { ok: true, issue: updated };
  } catch (error) {
    console.error("[municipal changeStatus] failed:", error);
    return { ok: false, error: "We could not update this issue. Please try again." };
  }
}

/* -------------------------------------------------------------------------- */
/*  Analytics                                                                  */
/* -------------------------------------------------------------------------- */

export interface MunicipalMetrics {
  total: number;
  byStatus: Record<string, number>;
  highPriorityOpen: number;
  unassignedVerified: number;
  overdue: number;
  completedLast30Days: number;
  /** Mean hours from VERIFIED to COMPLETED, over issues that reached both. */
  meanRepairHours: number | null;
  /** Areas with the most open issues. */
  hotspots: Array<{ areaLabel: string; count: number }>;
  highPriorityThreshold: number;
}

export async function loadMetrics(cityCode: CityCode): Promise<MunicipalMetrics> {
  const config = await getCityConfig(cityCode);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [grouped, highPriorityOpen, unassignedVerified, overdue, completed, hotspots] =
    await Promise.all([
      prisma.roadIssue.groupBy({
        by: ["status"],
        where: { cityCode },
        _count: { _all: true },
      }),
      prisma.roadIssue.count({
        where: {
          cityCode,
          priorityScore: { gte: config.highPriorityThreshold },
          status: { notIn: ["CLOSED", "REJECTED"] },
        },
      }),
      prisma.roadIssue.count({ where: { cityCode, status: "VERIFIED" } }),
      prisma.roadIssue.count({
        where: {
          cityCode,
          dueAt: { lt: new Date() },
          status: { notIn: ["CLOSED", "REJECTED", "COMPLETED"] },
        },
      }),
      prisma.roadIssue.findMany({
        where: {
          cityCode,
          completedAt: { gte: thirtyDaysAgo },
          verifiedAt: { not: null },
        },
        select: { verifiedAt: true, completedAt: true },
      }),
      prisma.roadIssue.groupBy({
        by: ["areaLabel"],
        where: { cityCode, status: { notIn: ["CLOSED", "REJECTED"] } },
        _count: { _all: true },
        orderBy: { _count: { areaLabel: "desc" } },
        take: 5,
      }),
    ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of grouped) {
    byStatus[row.status] = row._count._all;
    total += row._count._all;
  }

  /*
    Mean repair time, measured from VERIFIED (not from first report).

    Deliberate: the clock a council can be held to starts when the authority
    accepted the defect is real. Counting from the citizen's first report would
    blame the repair crews for the inspection backlog.
  */
  const durations = completed
    .filter((row) => row.verifiedAt && row.completedAt)
    .map((row) => (row.completedAt!.getTime() - row.verifiedAt!.getTime()) / 3_600_000)
    .filter((hours) => hours >= 0);

  const meanRepairHours =
    durations.length === 0
      ? null
      : Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;

  return {
    total,
    byStatus,
    highPriorityOpen,
    unassignedVerified,
    overdue,
    completedLast30Days: completed.length,
    meanRepairHours,
    hotspots: hotspots.map((row) => ({
      areaLabel: row.areaLabel,
      count: row._count._all,
    })),
    highPriorityThreshold: config.highPriorityThreshold,
  };
}

/** Per-employee performance, for the workforce page. */
export async function loadEmployeePerformance(cityCode: CityCode) {
  const employees = await prisma.employee.findMany({
    where: { cityCode, isActive: true },
    orderBy: { name: "asc" },
  });

  const issues = await prisma.roadIssue.findMany({
    where: { cityCode, assignedEmployeeId: { not: null } },
    select: {
      assignedEmployeeId: true,
      status: true,
      assignedAt: true,
      completedAt: true,
      dueAt: true,
    },
  });

  return employees.map((employee) => {
    const theirs = issues.filter((issue) => issue.assignedEmployeeId === employee.id);
    const done = theirs.filter(
      (issue) => issue.status === "COMPLETED" || issue.status === "CLOSED"
    );

    const durations = done
      .filter((issue) => issue.assignedAt && issue.completedAt)
      .map(
        (issue) =>
          (issue.completedAt!.getTime() - issue.assignedAt!.getTime()) / 3_600_000
      );

    const lateCount = done.filter(
      (issue) => issue.dueAt && issue.completedAt && issue.completedAt > issue.dueAt
    ).length;

    return {
      employee,
      assigned: theirs.length,
      open: theirs.filter((issue) => ACTIVE_STATUSES.includes(issue.status)).length,
      completed: done.length,
      meanHours:
        durations.length === 0
          ? null
          : Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10,
      lateCount,
    };
  });
}
