"""
CityFlow AI — ML service.

WHAT THIS SERVICE IS
The forecasting and optimisation brain. The Next.js application owns the users,
the database and every screen; this service owns the two things that genuinely
need Python: fitting a demand model, and solving a city-wide scheduling problem.

WHAT IT DELIBERATELY IS NOT
It has no database, no sessions, and no memory between requests. It never sees
an email address, a name or a CityFlow ID — a commuter reaches it as an opaque
`ref` string. Keeping it stateless means it scales by running more copies, and
keeps the number of places that hold personal data at exactly one.

IT IS ALSO OPTIONAL
If this service is down, the web application falls back to its own TypeScript
demand model and keeps working with a visible notice. That is why the whole
thing can be deployed on a free tier without the product becoming fragile.
"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.cache import Cache
from app.config import get_settings
from app.schemas import ForecastRequest, ForecastResponse, OptimizeRequest, OptimizeResponse
from app.services import forecast as forecast_service
from app.services import optimizer as optimizer_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("cityflow.ml")

settings = get_settings()

if settings.environment == "production" and not settings.api_key:
    raise RuntimeError(
        "CITYFLOW_API_KEY must be set when CITYFLOW_ENVIRONMENT=production. "
        "Refusing to start an unauthenticated service in production."
    )

app = FastAPI(
    title="CityFlow AI — ML service",
    description="Demand forecasting (Prophet + XGBoost) and departure-time optimisation (OR-Tools).",
    version="1.0.0",
)

# The web application is the only intended caller. CORS is closed by default
# because nothing should be calling this from a browser at all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

cache = Cache(settings.redis_url, settings.cache_ttl_seconds)


def require_key(x_cityflow_key: str | None) -> None:
    """Shared-secret check. A blank configured key disables the check entirely."""
    if not settings.api_key:
        return
    if x_cityflow_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-CityFlow-Key header.")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """
    Request logging.

    Logs method, path, status and duration — never the body, which carries
    travel patterns. Duration is here because a forecast that has quietly gone
    from 2 to 30 seconds is the failure that shows up as "the dashboard is
    broken" long before it shows up as an error.
    """
    started = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - started) * 1000
    logger.info("%s %s -> %s in %.0fms", request.method, request.url.path, response.status_code, elapsed)
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, error: Exception):
    """
    Never leak a stack trace to a caller.

    The full trace goes to the log where an operator can find it; the caller
    gets a message it can show a person without exposing internals.
    """
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "The forecasting service could not complete this request."},
    )


@app.get("/health")
def health() -> dict:
    """Liveness probe. Deliberately unauthenticated so a load balancer can call it."""
    return {
        "status": "ok",
        "service": settings.service_name,
        "environment": settings.environment,
        "cache": "connected" if cache.enabled else "disabled",
    }


@app.post("/forecast", response_model=ForecastResponse)
def post_forecast(
    request: ForecastRequest,
    x_cityflow_key: str | None = Header(default=None),
) -> ForecastResponse:
    """Predicted demand for every 15-minute slot of one day."""
    require_key(x_cityflow_key)

    key = Cache.key("forecast", request.model_dump(mode="json"))
    cached = cache.get(key)
    if cached:
        return ForecastResponse(**cached)

    result = forecast_service.forecast(request)
    cache.set(key, result.model_dump(mode="json"))
    return result


@app.post("/optimize", response_model=OptimizeResponse)
def post_optimize(
    request: OptimizeRequest,
    x_cityflow_key: str | None = Header(default=None),
) -> OptimizeResponse:
    """
    Assign every flexible trip to a departure slot so the day's peak is as low
    as it can be without asking anyone to do something they did not agree to.
    """
    require_key(x_cityflow_key)

    if len(request.commuters) > settings.max_commuters:
        raise HTTPException(
            status_code=413,
            detail=(
                f"This request carries {len(request.commuters)} trips; the limit is "
                f"{settings.max_commuters}. Split it by city or by corridor."
            ),
        )

    # Not cached: the result depends on the exact set of trips, which changes
    # whenever anybody confirms a plan. A stale schedule is worse than a slow one.
    return optimizer_service.optimize(request, settings)
