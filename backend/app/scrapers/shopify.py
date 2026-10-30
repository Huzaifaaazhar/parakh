"""Adapter for Shopify storefronts.

Most Pakistani brands (Outfitters, Gul Ahmed, Junaid Jamshed, Beechtree,
Telemart, Audionic, ...) run on Shopify, which exposes a public, paginated
`/products.json` listing with full product details (variants, prices,
compare-at prices, stock, images). One listing request returns up to 250
products with their details, so no separate detail-page crawl is needed.
"""

from collections.abc import Iterator
from typing import Any
from urllib.parse import urljoin

from app.core.config import settings
from app.core.logging import get_logger
from app.scrapers.base import BaseScraper
from app.scrapers.fetch import FetchError
from app.services.normalization.normalizer import RawProduct, parse_price

log = get_logger(__name__)


def parse_shopify_product(item: dict[str, Any], base_url: str, assume_in_stock: bool = False) -> RawProduct | None:
    variants = item.get("variants") or []
    if not variants:
        return None
    available = [v for v in variants if v.get("available", True)]
    pool = available or variants
    # Cheapest variant represents the listing; its compare_at_price is the "was" price.
    cheapest = min(pool, key=lambda v: parse_price(v.get("price")) or float("inf"))
    images = item.get("images") or []
    image_url = images[0].get("src") if images else None
    tags = item.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    options = {
        (opt.get("name") or "").lower(): [str(v) for v in opt.get("values", [])]
        for opt in item.get("options") or []
        if opt.get("name") and opt.get("name").lower() != "title"
    }
    handle = item.get("handle")
    return RawProduct(
        external_id=str(item.get("id")),
        title=item.get("title") or "",
        url=urljoin(base_url, f"/products/{handle}") if handle else base_url,
        price=cheapest.get("price"),
        original_price=cheapest.get("compare_at_price"),
        brand=item.get("vendor"),
        description=item.get("body_html"),
        product_type=item.get("product_type"),
        tags=list(tags),
        image_url=image_url,
        in_stock=assume_in_stock or bool(available),
        options=options,
        extra={"handle": handle, "variant_count": len(variants)},
    )


class ShopifyScraper(BaseScraper):
    def _listing_urls(self) -> list[str]:
        base = self.config.website.rstrip("/")
        if self.config.collections:
            return [f"{base}/collections/{c}/products.json" for c in self.config.collections]
        return [f"{base}/products.json"]

    def iter_products(self) -> Iterator[RawProduct]:
        max_pages = self.config.max_pages or settings.scraper_max_pages
        seen: set[str] = set()
        listings_done = 0
        listings = self._listing_urls()
        for listing in listings:
            for page in range(1, max_pages + 1):
                url = f"{listing}?limit={settings.scraper_page_size}&page={page}"
                try:
                    result = self.fetcher.get(url)
                except FetchError as exc:
                    log.error("[%s] listing fetch failed: %s", self.config.slug, exc)
                    break
                if result.status != 200:
                    log.warning("[%s] HTTP %s on %s", self.config.slug, result.status, url)
                    break
                products = (result.json() or {}).get("products") or []
                if not products:
                    listings_done += 1
                    break
                # Some storefronts report every variant unavailable to clients they
                # treat as bots. A large page with *nothing* in stock means "unknown",
                # not "sold out" — don't let it flip the whole catalogue out of stock.
                stock_unknown = len(products) >= 20 and not any(
                    v.get("available", True) for item in products for v in item.get("variants") or []
                )
                if stock_unknown:
                    log.warning("[%s] page %s reports no stock at all; treating availability as unknown", self.config.slug, page)
                for item in products:
                    try:
                        raw = parse_shopify_product(item, self.config.website, assume_in_stock=stock_unknown)
                    except Exception as exc:  # noqa: BLE001 - one bad item shouldn't kill the run
                        log.warning("[%s] skipping malformed product %s: %s", self.config.slug, item.get("id"), exc)
                        continue
                    if raw and raw.external_id not in seen:
                        seen.add(raw.external_id)
                        yield raw
                if len(products) < settings.scraper_page_size:
                    listings_done += 1
                    break
        self.complete = listings_done == len(listings)
