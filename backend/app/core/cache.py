"""Response cache: Redis when reachable, in-process TTL dict otherwise.

Keys are namespaced with a "generation" counter. Ingestion bumps the
generation, which invalidates every cached read in one O(1) operation.
"""

import functools
import hashlib
import json
import threading
import time
from collections.abc import Callable
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

_GEN_KEY = "parakh:cache:generation"


class _MemoryBackend:
    def __init__(self) -> None:
        self._data: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> str | None:
        with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            expires, value = item
            if expires and expires < time.time():
                self._data.pop(key, None)
                return None
            return value

    def set(self, key: str, value: str, ttl: int | None = None) -> None:
        with self._lock:
            self._data[key] = ((time.time() + ttl) if ttl else 0, value)

    def incr(self, key: str) -> int:
        with self._lock:
            current = int(self._data.get(key, (0, "0"))[1]) + 1
            self._data[key] = (0, str(current))
            return current

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


class Cache:
    def __init__(self) -> None:
        self._redis = None
        self._memory = _MemoryBackend()
        self._redis_checked_at = 0.0

    def _backend(self):
        if self._redis is not None:
            return self._redis
        # Retry Redis at most every 30s so a down Redis doesn't slow every request.
        if time.time() - self._redis_checked_at < 30:
            return self._memory
        self._redis_checked_at = time.time()
        try:
            import redis

            client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.5, socket_timeout=0.5, decode_responses=True)
            client.ping()
            self._redis = client
            log.info("Cache using Redis at %s", settings.redis_url)
            return client
        except Exception as exc:  # noqa: BLE001 - any failure means "use memory"
            log.debug("Redis unavailable (%s); using in-memory cache", exc)
            return self._memory

    def _safe(self, fn: Callable[..., Any], *args: Any, default: Any = None) -> Any:
        try:
            return fn(*args)
        except Exception as exc:  # noqa: BLE001
            log.warning("Cache operation failed: %s", exc)
            self._redis = None
            return default

    def generation(self) -> str:
        return str(self._safe(lambda: self._backend().get(_GEN_KEY), default=None) or "0")

    def invalidate_all(self) -> None:
        self._safe(lambda: self._backend().incr(_GEN_KEY))

    def get_json(self, key: str) -> Any | None:
        raw = self._safe(lambda: self._backend().get(key))
        return json.loads(raw) if raw else None

    def set_json(self, key: str, value: Any, ttl: int | None = None) -> None:
        payload = json.dumps(value, default=str)
        ttl = ttl or settings.cache_ttl_seconds
        backend = self._backend()
        if backend is self._memory:
            self._safe(lambda: self._memory.set(key, payload, ttl))
        else:
            self._safe(lambda: backend.set(key, payload, ex=ttl))

    def make_key(self, namespace: str, params: dict[str, Any]) -> str:
        digest = hashlib.sha1(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()
        return f"parakh:{self.generation()}:{namespace}:{digest}"


cache = Cache()


def cached(namespace: str, ttl: int | None = None):
    """Cache a function's JSON-serialisable result keyed by its kwargs.

    The wrapped function must be called with keyword arguments only (besides
    an optional leading `db` session, which is excluded from the key).
    """

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if not settings.cache_enabled:
                return fn(*args, **kwargs)
            key = cache.make_key(namespace, kwargs)
            hit = cache.get_json(key)
            if hit is not None:
                return hit
            result = fn(*args, **kwargs)
            cache.set_json(key, result, ttl)
            return result

        return wrapper

    return decorator
