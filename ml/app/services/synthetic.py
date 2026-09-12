"""
The seasonal prior — the demand shape a city has before anyone has measured it.

WHY A SYNTHETIC PRIOR EXISTS AT ALL
Prophet needs history. A newly deployed city has none: nobody has confirmed a
trip yet, so `observed` arrives empty. The dishonest options are to refuse to
answer, or to answer from thin air and present it as a forecast. This module
takes the third path: it generates a baseline from the shape urban travel demand
is known to take — an overnight floor, a sharp morning commute peak, a midday
bump, a broader evening peak, a much flatter weekend — and every response that
leans on it is tagged `seasonal_prior`, with reduced confidence, so no screen
can quietly present it as a measurement.

The curve here is deliberately IDENTICAL to the one in the web application's
`src/lib/demand/demand-model.ts`. Two systems that disagree about what a normal
Tuesday looks like would produce recommendations that contradict each other, and
whichever one the user saw last would appear to be lying.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

SLOT_MINUTES = 15
SLOTS_PER_DAY = (24 * 60) // SLOT_MINUTES

# Baseline traffic present at any hour of the day or night.
FLOOR = 6.0


@dataclass(frozen=True)
class Peak:
    """One bell-shaped peak in the day."""

    centre: int  # minutes since midnight
    height: float
    spread: float  # larger = flatter and wider


WEEKDAY_PEAKS = (
    Peak(centre=9 * 60, height=74, spread=52),            # morning commute
    Peak(centre=13 * 60, height=22, spread=55),           # midday errands
    Peak(centre=18 * 60 + 30, height=78, spread=68),      # evening, broader
)

WEEKEND_PEAKS = (
    Peak(centre=11 * 60 + 30, height=30, spread=110),
    Peak(centre=19 * 60, height=40, spread=110),
)


def _bell(minute_of_day: int, peak: Peak) -> float:
    distance = minute_of_day - peak.centre
    return peak.height * math.exp(-(distance**2) / (2 * peak.spread**2))


def _deterministic_noise(seed: str) -> float:
    """
    A small repeatable wobble in the range -1..1.

    It MUST be deterministic. With randomness, the same day would forecast
    differently on every request, a stored recommendation would stop matching
    the curve behind it, and nobody could reproduce a result. FNV-1a is used
    because it is tiny and well distributed; this mirrors the identical function
    in the web application so both systems wobble the same way.
    """
    h = 0x811C9DC5
    for ch in seed:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return (h / 0xFFFFFFFF) * 2 - 1


def slot_starts() -> list[int]:
    """Every slot start in a day: 0, 15, 30 ... 1425."""
    return [i * SLOT_MINUTES for i in range(SLOTS_PER_DAY)]


def prior_index(city_code: str, day: date, slot_minutes: int, city_pressure: float = 1.0) -> float:
    """Prior demand index (0-100) for one slot, before any observed data."""
    peaks = WEEKEND_PEAKS if day.weekday() >= 5 else WEEKDAY_PEAKS

    shape = FLOOR + sum(_bell(slot_minutes, p) for p in peaks)
    wobble = _deterministic_noise(f"{city_code}|{day.isoformat()}|{slot_minutes}") * 7.0

    return max(0.0, min(100.0, shape * city_pressure + wobble))


def prior_curve(city_code: str, day: date, city_pressure: float = 1.0) -> list[float]:
    """The full 96-slot prior for one day."""
    return [prior_index(city_code, day, s, city_pressure) for s in slot_starts()]


def synthetic_history(city_code: str, end_day: date, days: int, city_pressure: float = 1.0):
    """
    `days` of prior curve ending the day before `end_day`, as (timestamp, value)
    pairs ready for Prophet.

    This is a PRIOR, not data. It exists so Prophet has a weekly seasonality to
    lock onto while a real deployment accumulates its first months of demand;
    as observations arrive they are appended and progressively dominate the fit.
    """
    from datetime import timedelta

    rows: list[tuple[str, float]] = []
    for back in range(days, 0, -1):
        day = end_day - timedelta(days=back)
        for slot in slot_starts():
            stamp = f"{day.isoformat()} {slot // 60:02d}:{slot % 60:02d}:00"
            rows.append((stamp, prior_index(city_code, day, slot, city_pressure)))
    return rows
