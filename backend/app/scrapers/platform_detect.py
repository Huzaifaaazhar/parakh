"""Guess which menu adapter a restaurant website can use from its home page."""

from __future__ import annotations

import httpx

from app.scrapers.jsonld import products_from_html

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
MARKERS = {
    "indolj": "indolj",  # menu via headless capture (supported)
    "blinkco": "blinkco",  # menu behind a location picker (not yet supported)
    "tossdown": "tossdown",
    "shopify": "cdn.shopify.com",
}


def detect_platform(url: str, timeout: float = 15) -> str | None:
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        html = httpx.get(url, timeout=timeout, follow_redirects=True, headers={"User-Agent": USER_AGENT}).text
    except httpx.HTTPError:
        return None
    lower = html.lower()
    if products_from_html(html):
        return "jsonld"  # menu embedded as schema.org products (supported)
    for name, marker in MARKERS.items():
        if marker in lower:
            return name
    return None
