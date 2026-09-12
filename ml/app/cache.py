"""
Optional Redis cache.

Forecasting is the expensive call: fitting Prophet on ninety days of 15-minute
data takes a second or two, and the answer for a given city and day does not
change between requests. Caching it is the difference between a dashboard that
feels instant and one that does not.

DEGRADES TO NOTHING, DELIBERATELY
Redis is optional. With no CITYFLOW_REDIS_URL the cache is a no-op and every
call recomputes. A cache that takes the service down when it is unavailable is
worse than no cache, so every operation here swallows connection errors and
reports a miss.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class Cache:
    def __init__(self, url: str, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._client = None

        if not url:
            logger.info("No CITYFLOW_REDIS_URL set — running without a cache.")
            return

        try:
            import redis

            self._client = redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
            self._client.ping()
            logger.info("Cache connected.")
        except Exception as error:
            logger.warning("Redis unavailable (%s) — running without a cache.", error)
            self._client = None

    @property
    def enabled(self) -> bool:
        return self._client is not None

    @staticmethod
    def key(prefix: str, payload: dict[str, Any]) -> str:
        """A stable key for a request body. Sorted so key order cannot matter."""
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return f"cityflow:{prefix}:{hashlib.sha256(blob.encode()).hexdigest()[:32]}"

    def get(self, key: str) -> dict[str, Any] | None:
        if self._client is None:
            return None
        try:
            raw = self._client.get(key)
            return json.loads(raw) if raw else None
        except Exception as error:
            logger.warning("Cache read failed: %s", error)
            return None

    def set(self, key: str, value: dict[str, Any]) -> None:
        if self._client is None:
            return
        try:
            self._client.setex(key, self._ttl, json.dumps(value, separators=(",", ":")))
        except Exception as error:
            logger.warning("Cache write failed: %s", error)
