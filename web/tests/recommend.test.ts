import {
  recommendDeparture,
  type RecommendationInput,
} from "@/lib/demand/recommend";

/**
 * The departure-time recommendation engine.
 *
 * These are the most important tests in the web application. The engine decides
 * what to ask of a real person's morning, and the failure mode that matters is
 * not a crash — it is quietly recommending something they never agreed to, or
 * something that makes them late. Neither would look broken on screen.
 */

/** A demand curve with a sharp peak at 09:00, quiet either side. */
function peakAtNine(slotMinutes: number): number {
  const distance = Math.abs(slotMinutes - 9 * 60);
  if (distance === 0) return 90;
  if (distance <= 15) return 70;
  if (distance <= 30) return 45;
  return 20;
}

function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    demandAt: peakAtNine,
    usualDeparture: "09:00",
    requiredArrival: "10:00",
    typicalJourneyMinutes: 25,
    isFlexible: true,
    flexibilityMinutes: 30,
    willingToLeaveEarlier: true,
    willingToLeaveLater: true,
    ...overrides,
  };
}

describe("recommendDeparture", () => {
  it("moves the person away from a sharp peak", () => {
    const result = recommendDeparture(input());

    expect(result.suggestsChange).toBe(true);
    expect(result.recommendedDeparture).not.toBe("09:00");
    expect(result.demandAtRecommended).toBeLessThan(result.demandAtUsual);
  });

  it("never proposes an earlier time when the person said they cannot leave earlier", () => {
    const result = recommendDeparture(
      input({ willingToLeaveEarlier: false, willingToLeaveLater: true })
    );

    // Every option considered must be at or after the usual time.
    for (const option of result.options) {
      expect(option.minutes).toBeGreaterThanOrEqual(9 * 60);
    }
  });

  it("never proposes a later time when the person said they cannot leave later", () => {
    const result = recommendDeparture(
      input({ willingToLeaveEarlier: true, willingToLeaveLater: false })
    );

    for (const option of result.options) {
      expect(option.minutes).toBeLessThanOrEqual(9 * 60);
    }
  });

  it("does not move an inflexible person at all", () => {
    const result = recommendDeparture(input({ isFlexible: false }));

    expect(result.suggestsChange).toBe(false);
    expect(result.recommendedDeparture).toBe("09:00");
  });

  it("never recommends a time that arrives after the required arrival", () => {
    // A 50-minute journey against a 10:00 deadline: anything after 09:10 is late
    // once congestion is applied.
    const result = recommendDeparture(
      input({
        typicalJourneyMinutes: 50,
        requiredArrival: "10:00",
        flexibilityMinutes: 60,
      })
    );

    const chosen = result.options.find(
      (option) => option.time === result.recommendedDeparture
    );

    // Either the chosen option arrives in time, or the engine warned that
    // nothing in the window does. Silently recommending a late departure is the
    // one outcome that must never happen.
    expect(chosen?.arrivesInTime === true || result.warning !== null).toBe(true);
  });

  it("warns rather than recommending the impossible", () => {
    const result = recommendDeparture(
      input({
        typicalJourneyMinutes: 120,
        usualDeparture: "09:00",
        requiredArrival: "09:30",
      })
    );

    expect(result.warning).not.toBeNull();
  });

  it("keeps the usual time when no alternative is meaningfully quieter", () => {
    // A flat curve: every slot is identical, so moving anybody is pointless.
    const result = recommendDeparture(input({ demandAt: () => 50 }));

    expect(result.suggestsChange).toBe(false);
    expect(result.recommendedDeparture).toBe("09:00");
  });

  it("breaks ties towards the smallest disruption", () => {
    // 08:30 and 09:30 are equally quiet; the engine should prefer neither over
    // the usual time unless it is actually better, and among equals should sit
    // closest to the routine.
    const result = recommendDeparture(
      input({
        demandAt: (slot) => (slot === 9 * 60 ? 90 : 30),
        flexibilityMinutes: 60,
      })
    );

    const shift = Math.abs(
      Number(result.recommendedDeparture.slice(0, 2)) * 60 +
        Number(result.recommendedDeparture.slice(3, 5)) -
        9 * 60
    );

    // The nearest quiet slot is 15 minutes away; it must not have picked 60.
    expect(shift).toBeLessThanOrEqual(15);
  });

  it("always explains itself", () => {
    const result = recommendDeparture(input());

    expect(result.reason.length).toBeGreaterThan(20);
    expect(result.benefit.length).toBeGreaterThan(20);
    // The wording must never state a prediction as fact.
    expect(result.reason.toLowerCase()).toMatch(/predicted|expected/);
  });

  it("evaluates the usual slot even with zero flexibility", () => {
    const result = recommendDeparture(input({ flexibilityMinutes: 0 }));

    expect(result.options.some((option) => option.isUsual)).toBe(true);
  });
});
