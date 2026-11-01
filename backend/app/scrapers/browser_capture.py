"""Load a restaurant's own ordering site in headless Chromium and keep the JSON it fetches.

Most Pakistani restaurant sites are single-page apps on shared ordering platforms (Indolj,
Blinkco, ...). The menu is not in the HTML: the page asks the platform's API for it with a
short-lived token the page itself obtains. Rather than replicate that handshake we do what a
visitor's browser does: open the page and read the responses it receives.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


@dataclass
class Capture:
    url: str
    responses: dict[str, list[Any]] = field(default_factory=dict)  # pattern name -> parsed JSON bodies
    html: str = ""

    def first(self, name: str) -> Any:
        items = self.responses.get(name) or []
        return items[0] if items else None


def capture_json(url: str, patterns: dict[str, str], *, settle_ms: int = 3500, timeout_ms: int = 45000) -> Capture:
    """Open `url` and collect JSON responses whose URL matches each named regex."""
    from playwright.sync_api import sync_playwright

    compiled = {name: re.compile(p) for name, p in patterns.items()}
    cap = Capture(url=url)
    launch: dict[str, Any] = {"headless": True}
    if settings.browser_executable:
        launch["executable_path"] = settings.browser_executable
    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch)
        try:
            page = browser.new_page(user_agent=USER_AGENT, viewport={"width": 1280, "height": 900})

            def on_response(resp: Any) -> None:
                for name, rx in compiled.items():
                    if not rx.search(resp.url):
                        continue
                    try:
                        cap.responses.setdefault(name, []).append(json.loads(resp.body()))
                    except Exception:  # non-JSON or body already gone
                        pass

            page.on("response", on_response)
            try:
                page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            except Exception as exc:  # slow trackers keep the network busy; the menu usually arrived
                log.info("capture_goto_timeout", url=url, error=str(exc)[:120])
            page.wait_for_timeout(settle_ms)
            page.mouse.wheel(0, 3000)
            page.wait_for_timeout(1500)
            cap.html = page.content()
        finally:
            browser.close()
    return cap
