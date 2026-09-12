"""
Service configuration.

Every value is read from the environment with a working default, so the service
starts with no configuration at all during development and is fully tunable in
production without a code change.
"""

import sys
from functools import lru_cache

# ---------------------------------------------------------------------------
# Python version guard.
#
# Checked here, before anything else imports, because the failure without it is
# genuinely baffling: Pydantic raises a TypeError about unsupported operand
# types for `|` from deep inside its own model builder, which looks like a
# library bug rather than "your Python is too old".
# ---------------------------------------------------------------------------
if sys.version_info < (3, 10):
    raise RuntimeError(
        "CityFlow AI's ML service needs Python 3.10 or newer "
        f"(this is {sys.version_info.major}.{sys.version_info.minor}).\n"
        "\n"
        "The request models use `X | None` type unions, which Python only "
        "understands at runtime from 3.10 onwards.\n"
        "\n"
        "With conda:      conda create -n cityflow python=3.11 -y "
        "&& conda activate cityflow\n"
        "With Homebrew:   brew install python@3.11 "
        "&& python3.11 -m venv .venv && source .venv/bin/activate\n"
        "\n"
        "Then: pip install -r requirements.txt"
    )

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CITYFLOW_", env_file=".env", extra="ignore")

    # --- Service identity ----------------------------------------------------
    service_name: str = "cityflow-ml"
    environment: str = "development"

    # --- Security ------------------------------------------------------------
    # Shared secret the Next.js app sends in the X-CityFlow-Key header.
    #
    # The ML service holds no personal data and no database, but it is still an
    # endpoint that will happily burn CPU on request, so it is not left open.
    # Empty means "no auth", which is the correct default for local development
    # and is refused at startup when environment == "production".
    api_key: str = ""

    # --- Caching -------------------------------------------------------------
    redis_url: str = ""
    # Forecasts are stable within a day; five minutes matches the spec's TTL.
    cache_ttl_seconds: int = 300

    # --- Model behaviour -----------------------------------------------------
    # Days of synthetic history generated to give Prophet something to learn a
    # weekly seasonality from. See services/synthetic.py for why this exists.
    history_days: int = 90

    # Weight on flattening the peak, versus weight on not disrupting people.
    # Raising peak_weight smooths harder and moves more people further.
    peak_weight: int = 100
    disruption_weight: int = 1

    # Hard ceiling on how many commuters one optimisation request may carry.
    # CP-SAT is fast but not free, and an unbounded request is a denial of
    # service waiting to happen.
    max_commuters: int = 5000

    # Seconds CP-SAT may spend before returning the best solution so far.
    solver_timeout_seconds: float = 10.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
