import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  allowedTransitions,
  canTransition,
  explainRefusal,
} from "@/lib/municipal/workflow";

/**
 * The municipal repair workflow.
 *
 * This state machine exists to make dishonest record-keeping impossible rather
 * than merely discouraged — an issue marked COMPLETED that was never assigned,
 * or VERIFIED before anyone visited the site. These tests assert that the
 * sequences which would embarrass a council cannot be reached.
 */

describe("the repair state machine", () => {
  it("requires an inspection before work is assigned", () => {
    expect(canTransition("NEW", "ASSIGNED")).toBe(false);
    expect(canTransition("NEW", "VERIFIED")).toBe(true);
    expect(canTransition("VERIFIED", "ASSIGNED")).toBe(true);
  });

  it("requires work to have started before it can be completed", () => {
    expect(canTransition("VERIFIED", "COMPLETED")).toBe(false);
    expect(canTransition("ASSIGNED", "COMPLETED")).toBe(false);
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it("cannot skip from new straight to closed", () => {
    expect(canTransition("NEW", "CLOSED")).toBe(false);
    expect(canTransition("NEW", "COMPLETED")).toBe(false);
  });

  it("treats closed as final", () => {
    expect(allowedTransitions("CLOSED")).toHaveLength(0);
    expect(canTransition("CLOSED", "NEW")).toBe(false);
    expect(canTransition("CLOSED", "IN_PROGRESS")).toBe(false);
  });

  it("lets a failed sign-off send work back", () => {
    // Sign-off inspections fail. The honest record of that is a move backwards.
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(true);
  });

  it("lets a rejected issue be reopened", () => {
    // Inspectors are sometimes wrong, and more reports may arrive.
    expect(canTransition("REJECTED", "NEW")).toBe(true);
  });

  it("allows a sensor artefact to be dismissed without a fake verification", () => {
    expect(canTransition("NEW", "REJECTED")).toBe(true);
  });

  it("never allows a transition to itself", () => {
    for (const status of [...ACTIVE_STATUSES, ...TERMINAL_STATUSES, "NEW" as const]) {
      expect(allowedTransitions(status)).not.toContain(status);
    }
  });

  it("explains a refusal in terms of what to do instead", () => {
    const message = explainRefusal("NEW", "ASSIGNED");

    expect(message.toLowerCase()).toContain("verified");
    // A bare "invalid transition" teaches people to work around the system.
    expect(message.toLowerCase()).not.toContain("invalid transition");
  });

  it("explains why a closed issue cannot reopen, and what to do", () => {
    const message = explainRefusal("CLOSED", "IN_PROGRESS");

    expect(message.toLowerCase()).toContain("new issue");
  });

  it("says plainly when a status is already set", () => {
    expect(explainRefusal("VERIFIED", "VERIFIED").toLowerCase()).toContain("already");
  });
});
