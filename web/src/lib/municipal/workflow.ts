import type { RoadIssueStatus } from "@prisma/client";

/**
 * The repair workflow, as a state machine.
 *
 * ===================== WHY THIS IS A MACHINE AND NOT A FIELD ================
 * The obvious implementation is a status column anyone can set to anything.
 * That is how public-works records end up with issues marked COMPLETED that
 * were never assigned to anybody, and repairs that were "verified" before
 * anyone visited the site.
 *
 * Modelling the transitions makes those sequences impossible rather than merely
 * discouraged, and every move writes an audit row naming who did it. "Who
 * marked this repaired, and when" is exactly the question that gets asked six
 * months later when somebody's wheel is destroyed on a pothole the records say
 * was fixed.
 *
 * THE ONE RULE THAT SURVIVES FROM EARLIER PHASES
 * `confidence` (POSSIBLE → LIKELY → CONFIRMED_BY_REPORTS) is what CITIZEN
 * EVIDENCE supports, and the system sets it automatically from report counts.
 * `status` is what a NAMED OFFICER has done. They are deliberately separate:
 * twenty citizens agreeing is not the council acting, and only a person may
 * move an issue to VERIFIED — never the system, and never on their behalf.
 * ============================================================================
 */

export const ROAD_ISSUE_STATUSES: RoadIssueStatus[] = [
  "NEW",
  "VERIFIED",
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
  "REJECTED",
];

export const STATUS_META: Record<
  RoadIssueStatus,
  { label: string; description: string; tone: "neutral" | "primary" | "moderate" | "low" | "high" }
> = {
  NEW: {
    label: "New",
    description: "Reported by citizens or phone sensors. Nobody has looked at it yet.",
    tone: "neutral",
  },
  VERIFIED: {
    label: "Verified",
    description: "An inspector has been to the site and confirmed the defect is real.",
    tone: "primary",
  },
  ASSIGNED: {
    label: "Assigned",
    description: "Allocated to a named employee.",
    tone: "primary",
  },
  ACKNOWLEDGED: {
    label: "Acknowledged",
    description: "That employee has seen the assignment.",
    tone: "primary",
  },
  IN_PROGRESS: {
    label: "In progress",
    description: "Repair work has begun.",
    tone: "moderate",
  },
  COMPLETED: {
    label: "Completed",
    description: "The employee reports the repair finished. Not yet signed off.",
    tone: "low",
  },
  CLOSED: {
    label: "Closed",
    description: "Inspected after repair and signed off.",
    tone: "low",
  },
  REJECTED: {
    label: "Not a defect",
    description:
      "Inspected and found not to be a real defect — a speed breaker, a kerb, or a sensor artefact.",
    tone: "high",
  },
};

/**
 * Which statuses each status may move to.
 *
 * Notes on the less obvious edges:
 *  - NEW can go straight to REJECTED. A cluster of sensor jolts on a speed
 *    breaker should be dismissible without pretending to verify it first.
 *  - COMPLETED can return to IN_PROGRESS. Sign-off inspections fail, and the
 *    honest record of that is a move backwards, not a new issue.
 *  - CLOSED is terminal. Reopening would destroy the meaning of the audit
 *    trail; a defect that returns is a NEW issue at the same location, which is
 *    also how a city would want to see repeat failures.
 *  - REJECTED can go back to NEW, because inspectors are sometimes wrong and
 *    more reports may arrive.
 */
const TRANSITIONS: Record<RoadIssueStatus, RoadIssueStatus[]> = {
  NEW: ["VERIFIED", "REJECTED"],
  VERIFIED: ["ASSIGNED", "REJECTED"],
  ASSIGNED: ["ACKNOWLEDGED", "IN_PROGRESS", "VERIFIED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "ASSIGNED"],
  IN_PROGRESS: ["COMPLETED", "ASSIGNED"],
  COMPLETED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
  REJECTED: ["NEW"],
};

export function allowedTransitions(from: RoadIssueStatus): RoadIssueStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: RoadIssueStatus, to: RoadIssueStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Why a transition was refused, in words an officer can act on.
 *
 * A bare "invalid transition" tells somebody that the software disagrees with
 * them but not what to do instead, which is how people learn to work around a
 * system rather than with it.
 */
export function explainRefusal(from: RoadIssueStatus, to: RoadIssueStatus): string {
  if (from === to) return `This issue is already marked ${STATUS_META[to].label}.`;

  if (from === "CLOSED") {
    return "This issue is closed and signed off. If the defect has returned, raise it as a new issue at the same location — that is also how repeat failures become visible.";
  }

  if (to === "ASSIGNED" && from === "NEW") {
    return "An issue has to be verified by an inspector before work is assigned. Mark it Verified first.";
  }

  if (to === "COMPLETED" && from !== "IN_PROGRESS") {
    return "Only work that is in progress can be marked completed. Assign it and start the work first.";
  }

  const options = allowedTransitions(from)
    .map((status) => STATUS_META[status].label)
    .join(", ");

  return `An issue that is ${STATUS_META[from].label} can only move to: ${
    options || "nothing — this is a final state"
  }.`;
}

/** Statuses that mean the issue is finished, one way or another. */
export const TERMINAL_STATUSES: RoadIssueStatus[] = ["CLOSED", "REJECTED"];

/** Statuses that mean somebody is actively dealing with it. */
export const ACTIVE_STATUSES: RoadIssueStatus[] = [
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
];
