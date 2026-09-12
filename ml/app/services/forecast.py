"""
Demand forecasting: Prophet for the shape, XGBoost for what Prophet misses.

WHY TWO MODELS
Prophet is very good at the part of travel demand that is calendar-driven — the
daily double peak, the weekly cycle, the flatter weekend — and it gives an
uncertainty interval, which matters for a product that must never present a
prediction as a measurement.

What Prophet cannot see is everything that is not a function of the clock: rain,
a closed arterial road, a public event. Those arrive as features, and a gradient
boosted model is fitted to PROPHET'S RESIDUALS — the part of history Prophet got
wrong — rather than to demand itself. Stacking this way means the seasonal
structure stays interpretable and XGBoost only ever has the job it is good at,
which is picking up conditional effects from tabular features.

DEGRADATION IS EXPLICIT
With no history the service returns the seasonal prior and says so. With some
history it fits Prophet and says so. Only with enough history AND feature
variation does it use both. Every response carries `method` and `confidence`, and
the web app shows both — a forecast whose provenance is hidden is a forecast that
will eventually be over-trusted.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from app.schemas import ForecastEvent, ForecastRequest, ForecastResponse, ForecastSlot
from app.services import synthetic

logger = logging.getLogger(__name__)

# Below this many real observations, Prophet is fitted on the prior alone and
# the result is labelled a prior rather than a forecast.
MIN_OBSERVATIONS_FOR_PROPHET = 96 * 7  # one week of complete days

# Residual modelling needs enough points that XGBoost is learning rather than
# memorising.
MIN_OBSERVATIONS_FOR_XGBOOST = 96 * 21  # three weeks

# Observed trip counts are absolute; the index is 0-100. This converts between
# them. It is a scaling assumption, stated once, here: the caller's own peak
# observation is mapped to an index of 85 rather than 100, because the busiest
# slot seen so far is very unlikely to be the busiest slot possible.
OBSERVED_PEAK_INDEX = 85.0


def _to_frame(request: ForecastRequest, target: date) -> tuple[pd.DataFrame, int]:
    """
    Build Prophet's training frame: the synthetic prior, with any real
    observations overwriting the prior for the slots they cover.
    """
    prior = synthetic.synthetic_history(
        request.city_code,
        target,
        days=90,
        city_pressure=request.city_pressure,
    )
    frame = pd.DataFrame(prior, columns=["ds", "y"])
    frame["ds"] = pd.to_datetime(frame["ds"])

    if not request.observed:
        return frame, 0

    peak_trips = max(o.trips for o in request.observed) or 1
    scale = OBSERVED_PEAK_INDEX / peak_trips

    observed_rows = []
    for obs in request.observed:
        stamp = pd.Timestamp(f"{obs.date} {obs.slot_minutes // 60:02d}:{obs.slot_minutes % 60:02d}:00")
        observed_rows.append({"ds": stamp, "y": min(100.0, obs.trips * scale)})

    observed_frame = pd.DataFrame(observed_rows)

    # Real observations replace the prior wherever they exist.
    merged = pd.concat([frame, observed_frame]).drop_duplicates(subset="ds", keep="last")
    merged = merged.sort_values("ds").reset_index(drop=True)

    return merged, len(observed_frame)


def _event_uplift(events: list[ForecastEvent], slot_minutes: int) -> float:
    """Total demand-index uplift from every event active in this slot."""
    return float(
        sum(e.demand_impact for e in events if e.start_minutes <= slot_minutes < e.end_minutes)
    )


def _weather_uplift(precipitation_mm: float | None) -> float:
    """
    Rain's effect on demand index.

    Grounded in a consistent finding across urban travel studies rather than
    fitted here: rain shifts trips towards private vehicles and slows every
    mode, so the same number of people produce more road pressure. The mapping
    is deliberately coarse and capped — this is a nudge, not a claim of
    precision.
    """
    if precipitation_mm is None or precipitation_mm <= 0.1:
        return 0.0
    if precipitation_mm < 2.5:
        return 3.0
    if precipitation_mm < 7.6:
        return 7.0
    return 12.0


def _features(stamps: pd.Series, events: list[ForecastEvent]) -> pd.DataFrame:
    """Tabular features for the residual model."""
    minutes = stamps.dt.hour * 60 + stamps.dt.minute
    return pd.DataFrame(
        {
            "minute_of_day": minutes,
            "day_of_week": stamps.dt.dayofweek,
            "is_weekend": (stamps.dt.dayofweek >= 5).astype(int),
            # Time of day is circular: 23:45 is adjacent to 00:00, and a plain
            # integer hides that from a tree model.
            "sin_time": np.sin(2 * np.pi * minutes / 1440),
            "cos_time": np.cos(2 * np.pi * minutes / 1440),
            "event_uplift": [_event_uplift(events, int(m)) for m in minutes],
        }
    )


def forecast(request: ForecastRequest) -> ForecastResponse:
    target = datetime.strptime(request.target_date, "%Y-%m-%d").date()
    frame, observation_count = _to_frame(request, target)

    notes: list[str] = []
    method = "seasonal_prior"

    # ------------------------------------------------------- 1. Seasonal prior
    if observation_count < MIN_OBSERVATIONS_FOR_PROPHET:
        notes.append(
            f"Only {observation_count} real observations are available "
            f"({MIN_OBSERVATIONS_FOR_PROPHET} needed to fit). These figures come from the "
            "seasonal prior — the shape urban demand normally takes — not from measured traffic."
        )
        return _prior_response(request, target, observation_count, notes, confidence=35)

    # ------------------------------------------------------------- 2. Prophet
    #
    # WHY THIS WHOLE STAGE IS WRAPPED
    #
    # Prophet is not a pure-Python library. It fits through CmdStan, which means
    # a compiled binary that has to be present, executable and compatible with
    # the installed cmdstanpy. When any of that is wrong, Prophet raises from
    # deep inside its own backend loader — and its failure mode is particularly
    # unhelpful: `_load_stan_backend` swallows the real exception into a debug
    # log and then dies with `AttributeError: 'Prophet' object has no attribute
    # 'stan_backend'`, which names neither the cause nor the fix.
    #
    # Before this wrapper, that took the ENTIRE /forecast endpoint down with a
    # 500 — on a service whose whole design principle is that it degrades
    # rather than breaks. The seasonal prior was sitting right there, perfectly
    # usable, and the caller got nothing.
    #
    # So a Prophet failure now falls back to the prior, says so in `notes`, and
    # logs the real exception for whoever has to fix the install. The XGBoost
    # stage below already did this; Prophet not doing it was an oversight.
    try:
        return _prophet_forecast(request, target, frame, observation_count, notes)
    except Exception as error:
        logger.exception("Prophet stage failed; falling back to the seasonal prior")
        notes.append(
            "The Prophet model could not be fitted on this host "
            f"({type(error).__name__}), so these figures come from the seasonal prior "
            "instead. This is a deployment problem, not a data problem — the service log "
            "has the underlying error."
        )
        return _prior_response(request, target, observation_count, notes, confidence=30)


def _prior_response(
    request: ForecastRequest,
    target: date,
    observation_count: int,
    notes: list[str],
    confidence: int,
) -> ForecastResponse:
    """
    The seasonal prior, as a response.

    Reached two ways: when there is not enough history to fit on, and when
    fitting fails. Both are honestly labelled `seasonal_prior` — the caller is
    never told a prior is a fitted forecast.
    """
    values = synthetic.prior_curve(request.city_code, target, request.city_pressure)

    slots = []
    for slot, value in zip(synthetic.slot_starts(), values):
        adjusted = (
            value
            + _event_uplift(request.events, slot)
            + _weather_uplift(request.precipitation_mm)
        )
        adjusted = float(max(0.0, min(100.0, adjusted)))
        # A prior deserves a wide interval, and saying so is the point.
        slots.append(
            ForecastSlot(
                slot_minutes=slot,
                demand_index=round(adjusted),
                lower=round(max(0.0, adjusted - 18)),
                upper=round(min(100.0, adjusted + 18)),
            )
        )

    return ForecastResponse(
        city_code=request.city_code,
        target_date=request.target_date,
        slots=slots,
        method="seasonal_prior",
        observations_used=observation_count,
        confidence=confidence,
        notes=notes,
    )


def _prophet_forecast(
    request: ForecastRequest,
    target: date,
    frame: "pd.DataFrame",
    observation_count: int,
    notes: list[str],
) -> ForecastResponse:
    """Fits Prophet, optionally corrects its residuals, and builds the response."""
    from prophet import Prophet

    method = "prophet_only"

    model = Prophet(
        # Travel demand has a strong intra-day shape and a strong weekly one.
        # Yearly seasonality needs more than a year of data to mean anything,
        # so it is off rather than fitted to noise.
        daily_seasonality=True,
        weekly_seasonality=True,
        yearly_seasonality=False,
        # Demand shifts are gradual, not abrupt; a low changepoint scale stops
        # Prophet chasing a single unusual day.
        changepoint_prior_scale=0.05,
        interval_width=0.80,
    )

    # Prophet's default daily seasonality is too smooth for a double commute
    # peak. A higher Fourier order lets it resolve the morning and evening peaks
    # as separate features rather than one broad daytime hump.
    model.add_seasonality(name="intraday", period=1, fourier_order=12)

    model.fit(frame[["ds", "y"]])

    future = pd.DataFrame(
        {
            "ds": [
                pd.Timestamp(f"{target.isoformat()} {s // 60:02d}:{s % 60:02d}:00")
                for s in synthetic.slot_starts()
            ]
        }
    )
    predicted = model.predict(future)

    yhat = predicted["yhat"].to_numpy()
    lower = predicted["yhat_lower"].to_numpy()
    upper = predicted["yhat_upper"].to_numpy()

    # --------------------------------------------------- 3. XGBoost residuals
    if observation_count >= MIN_OBSERVATIONS_FOR_XGBOOST:
        try:
            from xgboost import XGBRegressor

            fitted = model.predict(frame[["ds"]])
            residuals = frame["y"].to_numpy() - fitted["yhat"].to_numpy()

            regressor = XGBRegressor(
                n_estimators=200,
                max_depth=4,
                learning_rate=0.05,
                subsample=0.85,
                colsample_bytree=0.85,
                reg_lambda=1.0,
                objective="reg:squarederror",
                n_jobs=2,
            )
            regressor.fit(_features(frame["ds"], request.events), residuals)

            correction = regressor.predict(_features(future["ds"], request.events))
            yhat = yhat + correction
            method = "prophet_xgboost"
            notes.append(
                "Prophet supplied the seasonal shape; XGBoost corrected its residuals "
                "using time-of-day, weekday and disruption features."
            )
        except Exception as error:  # pragma: no cover - defensive
            # A residual model failing must never take the forecast down with
            # it. Prophet's answer is still a good answer.
            logger.warning("XGBoost residual stage failed, using Prophet alone: %s", error)
            notes.append("Residual correction was unavailable; these are Prophet's figures alone.")

    # ------------------------------------------------- 4. Non-calendar uplifts
    weather = _weather_uplift(request.precipitation_mm)
    if weather > 0:
        notes.append(
            f"Adjusted upward by {weather:.0f} index points for forecast rainfall "
            f"of {request.precipitation_mm:.1f} mm."
        )

    slots: list[ForecastSlot] = []
    for i, slot in enumerate(synthetic.slot_starts()):
        uplift = _event_uplift(request.events, slot) + weather
        value = float(max(0.0, min(100.0, yhat[i] + uplift)))
        slots.append(
            ForecastSlot(
                slot_minutes=slot,
                demand_index=round(value),
                lower=round(max(0.0, min(100.0, lower[i] + uplift))),
                upper=round(max(0.0, min(100.0, upper[i] + uplift))),
            )
        )

    # Confidence rises with history and falls with forecast horizon.
    horizon_days = max(0, (target - date.today()).days)
    confidence = 60 if method == "prophet_only" else 75
    confidence += min(15, observation_count // (96 * 14))
    confidence -= min(25, horizon_days * 2)

    return ForecastResponse(
        city_code=request.city_code,
        target_date=request.target_date,
        slots=slots,
        method=method,  # type: ignore[arg-type]
        observations_used=observation_count,
        confidence=int(max(10, min(95, confidence))),
        notes=notes,
    )
