"""HTTP fetching for scrapers.

Uses Scrapling (https://github.com/Huzaifaaazhar/Scrapling) by default:
- `Fetcher` for fast HTTP with browser TLS fingerprints,
- `StealthyFetcher` / `DynamicFetcher` (Playwright) for JS-heavy or protected sites.
Falls back to plain httpx if Scrapling isn't installed, so tests and
minimal deployments still work.
"""

import json
import time
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


class FetchError(Exception):
    pass


@dataclass
class FetchResult:
    url: str
    status: int
    text: str
    page: Any = None  # Scrapling Response (supports .css()) when available

    def json(self) -> Any:
        try:
            return json.loads(self.text)
        except json.JSONDecodeError as exc:
            raise FetchError(f"Invalid JSON from {self.url}: {exc}") from exc

    def css(self, selector: str):
        if self.page is None:
            from scrapling.parser import Selector

            self.page = Selector(self.text, url=self.url)
        return self.page.css(selector)


class Fetcher:
    def __init__(self, mode: str | None = None, retries: int = 3, delay: float | None = None):
        self.mode = mode or settings.scraper_fetcher
        self.retries = retries
        self.delay = settings.scraper_request_delay if delay is None else delay
        self._last_request = 0.0

    def _throttle(self) -> None:
        wait = self.delay - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()

    def _scrapling(self, url: str) -> FetchResult:
        import scrapling.fetchers as sf

        if self.mode == "stealth":
            page = sf.StealthyFetcher.fetch(url, headless=True, network_idle=True)
        elif self.mode == "dynamic":
            # DynamicFetcher (Playwright) — older Scrapling releases call it PlayWrightFetcher.
            dynamic = getattr(sf, "DynamicFetcher", None) or sf.PlayWrightFetcher
            page = dynamic.fetch(url, headless=True, network_idle=True)
        else:
            page = sf.Fetcher.get(url, timeout=settings.scraper_timeout, stealthy_headers=True)
        body = page.body
        text = body.decode(page.encoding or "utf-8", errors="replace") if isinstance(body, bytes) else str(body)
        return FetchResult(url=url, status=page.status, text=text, page=page)

    def _httpx(self, url: str) -> FetchResult:
        import httpx

        resp = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=settings.scraper_timeout, follow_redirects=True)
        return FetchResult(url=str(resp.url), status=resp.status_code, text=resp.text)

    def get(self, url: str) -> FetchResult:
        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            self._throttle()
            try:
                if self.mode == "httpx":
                    result = self._httpx(url)
                else:
                    try:
                        result = self._scrapling(url)
                    except (ImportError, AttributeError) as exc:
                        log.warning("Scrapling unavailable (%s); falling back to httpx", exc)
                        self.mode = "httpx"
                        result = self._httpx(url)
                if result.status == 429 or result.status >= 500:
                    raise FetchError(f"HTTP {result.status} for {url}")
                return result
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                backoff = 2**attempt
                log.warning("Fetch failed (%s/%s) %s: %s; retrying in %ss", attempt, self.retries, url, exc, backoff)
                time.sleep(backoff)
        raise FetchError(f"Giving up on {url}: {last_error}")
