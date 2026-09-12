import { planTrip, type TripPlanRequest } from "@/lib/demand/trip-plan";

/**
 * The one-off trip planner.
 *
 * The failure that matters here is different from the routine engine's: this is
 * somebody planning for a flight. Recommending a quieter departure that arrives
 * late is the one thing it must never do, and "quiet roads" is exactly the
 * metric that would tempt a naive implementation into it.
 */

function request(overrides: Partial<TripPlanRequest> = {}): TripPlanRequest {
  return {
    // Quiet everywhere except a spike at 08:00.
    demandAt: (slot) => (slot === 8 * 60 ? 95 : 25),
    requiredArrival: "10:30",
    typicalJourneyMinutes: 30,
    tripType: "MOVIE",
    earliestDepartureMinutes: null,
    ...overrides,
  };
}

describe("planTrip", () => {
  it("works backwards from the arrival deadline", () => {
    const result = planTrip(request());

    const departure =
      Number(result.recommendedDeparture.slice(0, 2)) * 60 +
      Number(result.recommendedDeparture.slice(3, 5));
    const arrival =
      Number(result.estimatedArrival.slice(0, 2)) * 60 +
      Number(result.estimatedArrival.slice(3, 5));

    expect(arrival).toBeLessThanOrEqual(10 * 60 + 30);
    expect(departure).toBeLessThan(arrival);
  });

  it("applies a bigger buffer for a flight than for a film", () => {
    const film = planTrip(request({ tripType: "MOVIE" }));
    const flight = planTrip(request({ tripType: "FLIGHT" }));

    expect(flight.bufferMinutes).toBeGreaterThan(film.bufferMinutes);

    // A bigger buffer must actually move the departure earlier.
    expect(flight.recommendedDeparture < film.recommendedDeparture).toBe(true);
  });

  it("never recommends a slot that misses the deadline", () => {
    const result = planTrip(request({ typicalJourneyMinutes: 45 }));

    const chosen = result.options.find(
      (option) => option.time === result.recommendedDeparture
    );

    expect(chosen?.arrivesInTime === true || result.warning !== null).toBe(true);
  });

  it("prefers the latest of several equally quiet slots", () => {
    // A flat curve: nobody should be told to leave three hours early just
    // because the model is indifferent.
    const result = planTrip(request({ demandAt: () => 20 }));

    const viable = result.options.filter((option) => option.arrivesInTime);
    const latestViable = Math.max(...viable.map((option) => option.minutes));
    const chosen = result.options.find(
      (option) => option.time === result.recommendedDeparture
    )!;

    expect(chosen.minutes).toBe(latestViable);
  });

  it("refuses to pretend when the deadline is already too close", () => {
    const result = planTrip(
      request({
        requiredArrival: "10:30",
        typicalJourneyMinutes: 60,
        // It is already 10:00.
        earliestDepartureMinutes: 10 * 60,
      })
    );

    expect(result.warning).not.toBeNull();
    expect(result.confidenceScore).toBeLessThan(50);
  });

  it("never offers a departure in the past for a trip today", () => {
    const result = planTrip(request({ earliestDepartureMinutes: 9 * 60 }));

    for (const option of result.options) {
      expect(option.minutes).toBeGreaterThanOrEqual(9 * 60);
    }
  });

  it("lowers confidence when the plan has little slack", () => {
    const roomy = planTrip(request({ typicalJourneyMinutes: 20 }));
    const tight = planTrip(request({ typicalJourneyMinutes: 55 }));

    expect(tight.confidenceScore).toBeLessThanOrEqual(roomy.confidenceScore);
  });

  it("explains the buffer it applied", () => {
    const result = planTrip(request({ tripType: "FLIGHT" }));

    expect(result.bufferReason.toLowerCase()).toContain("45");
    expect(result.reason.length).toBeGreaterThan(30);
  });
});
