"""
Tests for demand forecasting.

The theme running through these: the service must be HONEST about where a
number came from. A forecast with no history behind it is allowed to exist, but
it is not allowed to look like a measurement.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.schemas import ForecastEvent, ForecastRequest, ObservedSlot
from app.services import synthetic
from app.services.forecast import forecast


def _tomorrow() -> str:
    return (date.today() + timedelta(days=1)).isoformat()


def test_no_history_returns_a_clearly_labelled_prior():
    result = forecast(ForecastRequest(city_code="bhopal", target_date=_tomorrow()))

    assert result.method == "seasonal_prior"
    assert result.observations_used == 0
    # A prior must not masquerade as a confident forecast.
    assert result.confidence <= 40
    assert any("seasonal prior" in note for note in result.notes)


def test_a_full_day_of_slots_is_always_returned():
    result = forecast(ForecastRequest(city_code="delhi", target_date=_tomorrow()))

    assert len(result.slots) == 96
    assert result.slots[0].slot_minutes == 0
    assert result.slots[-1].slot_minutes == 1425


def test_demand_index_stays_in_range():
    result = forecast(
        ForecastRequest(
            city_code="mumbai",
            target_date=_tomorrow(),
            precipitation_mm=40.0,
            events=[ForecastEvent(start_minutes=480, end_minutes=600, demand_impact=60)],
        )
    )

    for slot in result.slots:
        assert 0 <= slot.demand_index <= 100
        assert slot.lower <= slot.demand_index <= slot.upper


def test_morning_peak_is_busier_than_the_small_hours():
    """The prior must actually have the shape of a commute."""
    result = forecast(ForecastRequest(city_code="bengaluru", target_date=_tomorrow()))
    by_slot = {s.slot_minutes: s.demand_index for s in result.slots}

    assert by_slot[9 * 60] > by_slot[3 * 60]
    assert by_slot[18 * 60 + 30] > by_slot[3 * 60]


def test_rain_raises_predicted_demand():
    dry = forecast(ForecastRequest(city_code="pune", target_date=_tomorrow()))
    wet = forecast(
        ForecastRequest(city_code="pune", target_date=_tomorrow(), precipitation_mm=12.0)
    )

    dry_peak = max(s.demand_index for s in dry.slots)
    wet_peak = max(s.demand_index for s in wet.slots)
    assert wet_peak >= dry_peak


def test_an_event_only_lifts_the_slots_it_covers():
    quiet = forecast(ForecastRequest(city_code="delhi", target_date=_tomorrow()))
    disrupted = forecast(
        ForecastRequest(
            city_code="delhi",
            target_date=_tomorrow(),
            events=[ForecastEvent(start_minutes=600, end_minutes=660, demand_impact=30)],
        )
    )

    quiet_by = {s.slot_minutes: s.demand_index for s in quiet.slots}
    loud_by = {s.slot_minutes: s.demand_index for s in disrupted.slots}

    assert loud_by[600] > quiet_by[600]
    # 09:00 is before the event window and must be untouched.
    assert loud_by[9 * 60] == quiet_by[9 * 60]


def test_the_prior_is_deterministic():
    """
    Same inputs, same numbers — always.

    If this ever fails, a stored recommendation could stop matching the curve it
    was derived from, and nobody could reproduce a result.
    """
    a = synthetic.prior_curve("delhi", date(2026, 3, 10), 1.0)
    b = synthetic.prior_curve("delhi", date(2026, 3, 10), 1.0)
    assert a == b


def test_weekends_are_flatter_than_weekdays():
    weekday = synthetic.prior_curve("delhi", date(2026, 3, 10), 1.0)  # Tuesday
    weekend = synthetic.prior_curve("delhi", date(2026, 3, 14), 1.0)  # Saturday

    assert max(weekend) < max(weekday)


@pytest.mark.slow
def test_enough_history_switches_to_prophet():
    """
    With a month of real observations the service should stop calling its answer
    a prior. Marked slow because it fits Prophet; run with `-m slow`.
    """
    observed: list[ObservedSlot] = []
    start = date.today() - timedelta(days=40)
    for day_offset in range(35):
        day = start + timedelta(days=day_offset)
        for slot in synthetic.slot_starts():
            trips = int(synthetic.prior_index("delhi", day, slot) / 2)
            observed.append(
                ObservedSlot(date=day.isoformat(), slot_minutes=slot, trips=trips)
            )

    result = forecast(
        ForecastRequest(city_code="delhi", target_date=_tomorrow(), observed=observed)
    )

    assert result.method in ("prophet_only", "prophet_xgboost")
    assert result.confidence > 40
