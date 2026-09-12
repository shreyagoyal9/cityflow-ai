"""
Request and response shapes.

These are the contract between the Next.js application and this service. They
are deliberately explicit — the web app sends everything the model needs and
this service holds no database, no session and no memory of a caller. That
makes the service trivially horizontally scalable and, more importantly, means
it never becomes a second place where personal data lives.

NOTHING HERE IDENTIFIES A PERSON. A commuter is a `ref` string chosen by the
caller (in practice a journey id), which is meaningless outside the caller's own
database.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

SLOT_MINUTES = 15
SLOTS_PER_DAY = (24 * 60) // SLOT_MINUTES


# =============================================================================
# Forecasting
# =============================================================================


class ObservedSlot(BaseModel):
    """One real observation the caller already holds: trips confirmed in a slot."""

    date: str = Field(description="YYYY-MM-DD")
    slot_minutes: int = Field(ge=0, lt=24 * 60)
    trips: int = Field(ge=0)


class ForecastRequest(BaseModel):
    city_code: str = Field(min_length=2, max_length=40)
    target_date: str = Field(description="YYYY-MM-DD — the day to forecast")

    # Real aggregated demand the web app has recorded. May be empty on a new
    # deployment, which is the normal case and is handled explicitly.
    observed: list[ObservedSlot] = Field(default_factory=list, max_length=20000)

    # Relative traffic pressure for this city, 0.4 - 1.2. Supplied by the caller
    # so the two systems cannot disagree about how busy a city is.
    city_pressure: float = Field(default=1.0, ge=0.2, le=2.0)

    # Optional weather signal. Rain reliably thickens a peak and lengthens
    # journeys, and Open-Meteo gives it away free, so the model uses it when the
    # caller has it and ignores it when it does not.
    precipitation_mm: float | None = Field(default=None, ge=0, le=500)
    temperature_c: float | None = Field(default=None, ge=-40, le=60)

    # Known disruptions on the day: closures, events, accidents.
    events: list["ForecastEvent"] = Field(default_factory=list, max_length=100)


class ForecastEvent(BaseModel):
    start_minutes: int = Field(ge=0, lt=24 * 60)
    end_minutes: int = Field(ge=0, le=24 * 60)
    # How many index points this adds to demand while it is active.
    demand_impact: int = Field(ge=0, le=60)


class ForecastSlot(BaseModel):
    slot_minutes: int
    # 0-100 demand index, the same scale the web app's own model uses.
    demand_index: int
    # Prophet's uncertainty interval, carried through rather than discarded:
    # a forecast without one invites the reader to treat it as a measurement.
    lower: int
    upper: int


class ForecastResponse(BaseModel):
    city_code: str
    target_date: str
    slots: list[ForecastSlot]

    # Which path actually produced these numbers. The web app shows this to
    # administrators, because "Prophet fitted on 90 days of real demand" and
    # "seasonal prior, no history yet" are very different claims.
    method: Literal["prophet_xgboost", "prophet_only", "seasonal_prior"]
    # How many real observations were available to fit on.
    observations_used: int
    # 0-100. Degrades when history is thin or the horizon is far out.
    confidence: int
    notes: list[str] = Field(default_factory=list)


# =============================================================================
# Optimisation
# =============================================================================


class Commuter(BaseModel):
    """
    One trip that may be scheduled.

    `ref` is the caller's own identifier and is echoed back untouched. This
    service never learns who the person is.
    """

    ref: str = Field(min_length=1, max_length=64)

    usual_slot: int = Field(ge=0, lt=24 * 60, description="Minutes since midnight")

    # The slots this person actually agreed to. Computed by the caller from the
    # person's own flexibility settings, so the optimiser can never propose a
    # time the person never consented to.
    allowed_slots: list[int] = Field(min_length=1, max_length=97)

    # How many vehicles this trip puts on the road. A carpool of four is one
    # vehicle; a bus passenger is a fraction. Kept as a weight so the optimiser
    # minimises ROAD LOAD rather than headcount.
    weight: float = Field(default=1.0, ge=0.0, le=50.0)

    # Latest slot that still arrives on time. Slots after this are dropped.
    latest_feasible_slot: int | None = Field(default=None, ge=0, lt=24 * 60)

    @model_validator(mode="after")
    def _slots_aligned(self) -> "Commuter":
        bad = [s for s in self.allowed_slots if s % SLOT_MINUTES != 0]
        if bad:
            raise ValueError(f"allowed_slots must align to {SLOT_MINUTES}-minute slots: {bad[:3]}")
        return self


class OptimizeRequest(BaseModel):
    city_code: str = Field(min_length=2, max_length=40)
    target_date: str

    commuters: list[Commuter] = Field(min_length=1, max_length=5000)

    # Demand already on the road that this optimisation cannot move: people who
    # are not CityFlow users, fixed-schedule trips, freight.
    #
    # UNITS MATTER HERE. This is a VEHICLE LOAD per slot, in the same units as
    # `Commuter.weight` — not a 0-100 demand index. The two are summed, so
    # passing an index would silently weigh "the curve" against "the people" on
    # different scales and produce a schedule that looks optimal and is not.
    # The caller converts its demand index into vehicle units before sending;
    # see `indexToVehicleLoad` in the web application's ML client.
    baseline: list[int] = Field(default_factory=list, max_length=96)

    # Optional per-slot vehicle ceiling. When given, the solver treats exceeding
    # it as a hard constraint rather than merely expensive.
    slot_capacity: float | None = Field(default=None, gt=0)

    peak_weight: int | None = Field(default=None, ge=0, le=10000)
    disruption_weight: int | None = Field(default=None, ge=0, le=10000)


class Assignment(BaseModel):
    ref: str
    usual_slot: int
    assigned_slot: int
    shift_minutes: int


class OptimizeResponse(BaseModel):
    city_code: str
    target_date: str

    assignments: list[Assignment]

    # Vehicle load per slot before and after, so the caller can show the effect
    # honestly instead of asserting an improvement.
    load_before: list[float]
    load_after: list[float]

    peak_before: float
    peak_after: float
    peak_reduction_percent: float

    # How many people were actually asked to move. The rest keep their time.
    moved_count: int
    unchanged_count: int
    mean_shift_minutes: float

    solver_status: str
    solve_seconds: float

    # True when the solver hit its time limit and returned the best it had.
    # An administrator should know the answer is good rather than proven best.
    time_limited: bool
    notes: list[str] = Field(default_factory=list)


ForecastRequest.model_rebuild()
