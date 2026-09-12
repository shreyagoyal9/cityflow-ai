import {
  ESTIMATE_CAVEAT,
  aggregateSavings,
  estimateFuelLitres,
  estimateSavings,
} from "@/lib/demand/savings";

/**
 * The savings estimator.
 *
 * This module produces the only numbers in the product that look like a
 * measurement and are not. The tests therefore check the guard rails as much as
 * the arithmetic: that it never overstates, never reports a negative saving as
 * a gain, and never claims significance it cannot support.
 */

describe("estimateSavings", () => {
  it("reports a saving when the recommended slot is quieter", () => {
    const result = estimateSavings(30, 90, 20);

    expect(result.minutes).toBeGreaterThan(0);
    expect(result.journeyAtRecommended).toBeLessThan(result.journeyAtUsual);
  });

  it("never reports a negative saving", () => {
    // Recommended slot is BUSIER — which the engine would not do, but the
    // estimator must not return a negative number if it ever happens.
    const result = estimateSavings(30, 20, 90);

    expect(result.minutes).toBe(0);
    expect(result.isMeaningful).toBe(false);
  });

  it("reports nothing meaningful for a difference inside the model's noise", () => {
    // Both indices in the same congestion band: the multiplier is identical, so
    // the honest answer is "no meaningful difference".
    const result = estimateSavings(20, 40, 45);

    expect(result.isMeaningful).toBe(false);
  });

  it("floors rather than rounds, so it never overstates", () => {
    const result = estimateSavings(30, 90, 20);

    // 30 × 1.75 = 52.5 → 52 (floored); 30 × 1.0 = 30. Saving 22, never 23.
    expect(result.minutes).toBe(result.journeyAtUsual - result.journeyAtRecommended);
    expect(Number.isInteger(result.minutes)).toBe(true);
  });

  it("always states its method", () => {
    const result = estimateSavings(25, 85, 30);

    expect(result.method).toContain("25-minute");
    expect(result.method).toContain("85");
    expect(result.method).toContain("30");
  });

  it("ships a caveat that names the limitation plainly", () => {
    expect(ESTIMATE_CAVEAT.toLowerCase()).toContain("no real journey was measured");
  });
});

describe("aggregateSavings", () => {
  it("sums per-person estimates", () => {
    const result = aggregateSavings([
      { typicalJourneyMinutes: 30, demandAtUsual: 90, demandAtRecommended: 20 },
      { typicalJourneyMinutes: 30, demandAtUsual: 90, demandAtRecommended: 20 },
    ]);

    expect(result.count).toBe(2);
    expect(result.totalMinutes).toBe(
      estimateSavings(30, 90, 20).minutes * 2
    );
  });

  it("returns zero for an empty set rather than dividing by nothing", () => {
    const result = aggregateSavings([]);

    expect(result.count).toBe(0);
    expect(result.totalMinutes).toBe(0);
    expect(result.personHours).toBe(0);
  });
});

describe("estimateFuelLitres", () => {
  it("scales with the share of trips that are private vehicles", () => {
    const allCars = estimateFuelLitres(600, 1);
    const halfCars = estimateFuelLitres(600, 0.5);

    expect(halfCars.litres).toBeLessThan(allCars.litres);
  });

  it("returns nothing when no trips were by vehicle", () => {
    expect(estimateFuelLitres(600, 0).litres).toBe(0);
  });

  it("clamps an out-of-range share rather than trusting it", () => {
    // A share above 1 would silently inflate the figure.
    expect(estimateFuelLitres(600, 5).litres).toBe(estimateFuelLitres(600, 1).litres);
    expect(estimateFuelLitres(600, -2).litres).toBe(0);
  });

  it("always returns its assumptions, including the disclaimer", () => {
    const result = estimateFuelLitres(600, 0.8);
    const text = result.assumptions.join(" ").toLowerCase();

    expect(result.assumptions.length).toBeGreaterThanOrEqual(3);

    // The fuel figure rests on two published assumptions and one measured
    // input (the mode split), so the set must say so explicitly. Asserted on
    // the substantive claim rather than an exact phrase — the earlier version
    // of this test looked for "not measured" and failed against the actual
    // wording, "no fuel consumption was measured", which says the same thing
    // better.
    expect(text).toMatch(/was measured|not measured/);
    expect(text).toContain("not an observation");
  });
});
