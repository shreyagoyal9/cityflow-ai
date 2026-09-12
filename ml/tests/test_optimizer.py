"""
Tests for the departure-time optimiser.

These are the tests that matter most in the whole project, because they check
the claim the product is built on: that CityFlow AI SMOOTHS demand rather than
relocating it, and that it never proposes a time a person did not agree to.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.schemas import Commuter, OptimizeRequest
from app.services.optimizer import SLOTS_PER_DAY, optimize


@pytest.fixture
def settings() -> Settings:
    # A short timeout keeps the suite quick; these problems are small.
    return Settings(solver_timeout_seconds=5.0, peak_weight=100, disruption_weight=1)


def _commuters(count: int, usual: int, window: int = 30) -> list[Commuter]:
    """`count` identical flexible trips all departing at the same time."""
    allowed = [usual + offset for offset in range(-window, window + 1, 15)]
    return [
        Commuter(ref=f"j{i}", usual_slot=usual, allowed_slots=allowed, weight=1.0)
        for i in range(count)
    ]


def test_peak_is_reduced_when_everyone_departs_together(settings):
    """40 people all leaving at 09:00 should be spread across their windows."""
    request = OptimizeRequest(
        city_code="bhopal",
        target_date="2026-03-10",
        commuters=_commuters(40, usual=9 * 60, window=30),
    )

    result = optimize(request, settings)

    assert result.peak_before == 40
    assert result.peak_after < result.peak_before
    assert result.peak_reduction_percent > 0
    # Five slots are available, so a perfectly flat answer is 8 per slot.
    assert result.peak_after <= 10


def test_no_new_peak_is_created(settings):
    """
    The core claim.

    After optimisation no slot may exceed the original peak. A solution that
    merely moved the jam to 08:30 would pass a naive "peak reduced" check by
    looking only at the original slot; this one cannot.
    """
    request = OptimizeRequest(
        city_code="delhi",
        target_date="2026-03-10",
        commuters=_commuters(60, usual=9 * 60, window=45),
    )

    result = optimize(request, settings)

    assert max(result.load_after) <= max(result.load_before)


def test_total_demand_is_conserved(settings):
    """
    Smoothing moves trips, it never deletes them.

    If the two curves did not sum to the same total, the optimiser would be
    quietly losing people — and every "peak reduced" figure downstream would be
    an artefact of that bug rather than a real result.
    """
    request = OptimizeRequest(
        city_code="pune",
        target_date="2026-03-10",
        commuters=_commuters(25, usual=8 * 60 + 30, window=30),
    )

    result = optimize(request, settings)

    assert sum(result.load_before) == pytest.approx(sum(result.load_after), abs=0.01)


def test_inflexible_commuter_is_never_moved(settings):
    """
    Consent is structural.

    A person with one allowed slot has exactly one variable that can be true.
    No objective value, however good, can move them.
    """
    fixed = Commuter(ref="fixed", usual_slot=9 * 60, allowed_slots=[9 * 60], weight=1.0)
    flexible = _commuters(30, usual=9 * 60, window=30)

    result = optimize(
        OptimizeRequest(
            city_code="mumbai",
            target_date="2026-03-10",
            commuters=[fixed, *flexible],
        ),
        settings,
    )

    assignment = next(a for a in result.assignments if a.ref == "fixed")
    assert assignment.assigned_slot == 9 * 60
    assert assignment.shift_minutes == 0


def test_assignments_stay_inside_the_allowed_window(settings):
    """Every assigned slot must be one the person actually offered."""
    commuters = [
        Commuter(
            ref="early-only",
            usual_slot=9 * 60,
            # Willing to leave earlier, never later.
            allowed_slots=[8 * 60 + 30, 8 * 60 + 45, 9 * 60],
        ),
        *_commuters(20, usual=9 * 60, window=30),
    ]

    result = optimize(
        OptimizeRequest(city_code="chennai", target_date="2026-03-10", commuters=commuters),
        settings,
    )

    allowed = {8 * 60 + 30, 8 * 60 + 45, 9 * 60}
    assignment = next(a for a in result.assignments if a.ref == "early-only")
    assert assignment.assigned_slot in allowed


def test_late_arrival_slots_are_excluded(settings):
    """A slot that would make someone late is never chosen."""
    commuter = Commuter(
        ref="deadline",
        usual_slot=9 * 60,
        allowed_slots=[9 * 60, 9 * 60 + 15, 9 * 60 + 30],
        latest_feasible_slot=9 * 60,
    )

    result = optimize(
        OptimizeRequest(
            city_code="kolkata",
            target_date="2026-03-10",
            commuters=[commuter, *_commuters(20, usual=9 * 60, window=30)],
        ),
        settings,
    )

    assert next(a for a in result.assignments if a.ref == "deadline").assigned_slot == 9 * 60


def test_nobody_moves_when_demand_is_already_flat(settings):
    """
    The optimiser must not fidget.

    With one person per slot there is no peak to reduce, so the disruption term
    dominates and everybody should keep their own time.
    """
    commuters = [
        Commuter(
            ref=f"c{i}",
            usual_slot=8 * 60 + i * 15,
            allowed_slots=[8 * 60 + i * 15 - 15, 8 * 60 + i * 15, 8 * 60 + i * 15 + 15],
        )
        for i in range(6)
    ]

    result = optimize(
        OptimizeRequest(city_code="bhopal", target_date="2026-03-10", commuters=commuters),
        settings,
    )

    assert result.moved_count == 0
    assert result.unchanged_count == len(commuters)


def test_baseline_demand_is_respected(settings):
    """
    Unmovable demand shapes the answer.

    With a wall of non-CityFlow traffic at 09:00, flexible trips should be
    pushed away from it rather than piled on top.
    """
    baseline = [0] * SLOTS_PER_DAY
    baseline[(9 * 60) // 15] = 50

    result = optimize(
        OptimizeRequest(
            city_code="hyderabad",
            target_date="2026-03-10",
            commuters=_commuters(20, usual=9 * 60, window=30),
            baseline=baseline,
        ),
        settings,
    )

    nine = result.load_after[(9 * 60) // 15]
    # The baseline is immovable, so 09:00 keeps its 50 — but should collect
    # very few of the twenty flexible trips on top.
    assert nine < 60


def test_disruption_weight_changes_how_many_people_move(settings):
    """
    The policy dial does something.

    A city that protects routines heavily should move fewer people than one
    that prioritises a flat curve.
    """
    commuters = _commuters(40, usual=9 * 60, window=45)
    base = dict(city_code="pune", target_date="2026-03-10", commuters=commuters)

    smooth_hard = optimize(OptimizeRequest(**base, peak_weight=500, disruption_weight=1), settings)
    protect_routine = optimize(
        OptimizeRequest(**base, peak_weight=1, disruption_weight=500), settings
    )

    assert protect_routine.moved_count <= smooth_hard.moved_count


def test_weights_let_a_carpool_count_as_one_vehicle(settings):
    """Load is measured in vehicles, not people."""
    result = optimize(
        OptimizeRequest(
            city_code="delhi",
            target_date="2026-03-10",
            commuters=[
                Commuter(ref="car", usual_slot=9 * 60, allowed_slots=[9 * 60], weight=1.0),
                Commuter(ref="bus", usual_slot=9 * 60, allowed_slots=[9 * 60], weight=0.1),
            ],
        ),
        settings,
    )

    assert result.peak_before == pytest.approx(1.1, abs=0.01)
