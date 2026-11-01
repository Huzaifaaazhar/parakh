"""Generic adapter for restaurant sites that publish their menu as schema.org Product data.

Tossdown sites (e.g. Bundu Khan) embed every menu item as JSON-LD `Product` with an `Offer`
price, so we can read the menu from the page HTML without running any scripts.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from typing import Any

from app.scrapers.base import BaseScraper
from app.services.normalization.normalizer import RawProduct

_LD_RE = re.compile(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", re.S | re.I)


def products_from_html(html: str) -> list[dict[str, Any]]:
    """Every schema.org Product in the page's JSON-LD, in menu order, de-duplicated by URL."""
    found: dict[str, dict[str, Any]] = {}

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, dict):
            if node.get("@type") == "Product" and node.get("name"):
                found.setdefault(node.get("url") or node["name"], node)
            for value in node.values():
                if isinstance(value, (dict, list)):
                    walk(value)

    for block in _LD_RE.findall(html):
        try:
            walk(json.loads(block))
        except ValueError:
            continue
    return list(found.values())


def _offer(node: dict[str, Any]) -> dict[str, Any]:
    offer = node.get("offers") or {}
    if isinstance(offer, list):
        offer = offer[0] if offer else {}
    return offer if isinstance(offer, dict) else {}


class JsonLdScraper(BaseScraper):
    def iter_products(self) -> Iterator[RawProduct]:
        pages = [self.config.website] + list(self.config.listing_urls)
        seen = 0
        for url in pages:
            html = self.fetcher.get(url).text
            for node in products_from_html(html):
                offer = _offer(node)
                if not offer.get("price"):
                    continue
                link = node.get("url") or url
                ext = re.sub(r"\W+", "-", link.rstrip("/").rsplit("/", 1)[-1])[:110] or node["name"]
                image = node.get("image")
                if isinstance(image, list):
                    image = image[0] if image else None
                seen += 1
                yield RawProduct(
                    external_id=ext,
                    title=node["name"],
                    url=link,
                    price=offer.get("price"),
                    original_price=offer.get("highPrice") or offer.get("price"),
                    description=node.get("description"),
                    image_url=image if isinstance(image, str) else None,
                    in_stock="OutOfStock" not in str(offer.get("availability", "")),
                )
        self.complete = seen > 0
