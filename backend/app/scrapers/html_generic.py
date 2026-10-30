"""Config-driven HTML adapter for non-Shopify stores, built on Scrapling selectors.

Each store supplies CSS selectors in stores.yaml, e.g.

    selectors:
      item: ".product-tile"
      title: ".product-name::text"
      url: "a::attr(href)"
      price: ".sales .value::text"
      original_price: ".strike-through .value::text"
      image: "img::attr(src)"
      next_page: "a.next::attr(href)"
      # optional detail-page selectors
      detail_description: ".product-description"

Set `fetcher: dynamic` for sites that render listings with JavaScript
(uses Scrapling's Playwright-backed DynamicFetcher).
"""

import hashlib
from collections.abc import Iterator
from urllib.parse import urljoin

from app.core.config import settings
from app.core.logging import get_logger
from app.scrapers.base import BaseScraper
from app.scrapers.fetch import FetchError
from app.services.normalization.normalizer import RawProduct

log = get_logger(__name__)


def _first(node, selector: str | None) -> str | None:
    if not selector:
        return None
    found = node.css(selector)
    if not found:
        return None
    value = found[0] if isinstance(found, list) else found.get() if hasattr(found, "get") else found
    if hasattr(value, "get_all_text"):
        value = value.get_all_text(strip=True)
    value = str(value).strip() if value is not None else None
    return value or None


class HtmlScraper(BaseScraper):
    def iter_products(self) -> Iterator[RawProduct]:
        sel = self.config.selectors
        if not sel.get("item") or not self.config.listing_urls:
            log.error("[%s] html adapter requires `selectors.item` and `listing_urls`", self.config.slug)
            return
        max_pages = self.config.max_pages or settings.scraper_max_pages
        complete = True
        for start_url in self.config.listing_urls:
            url: str | None = start_url
            pages = 0
            while url and pages < max_pages:
                pages += 1
                try:
                    page = self.fetcher.get(url)
                except FetchError as exc:
                    log.error("[%s] %s", self.config.slug, exc)
                    complete = False
                    break
                for node in page.css(sel["item"]):
                    raw = self._parse_item(node, page.url)
                    if raw:
                        if sel.get("detail_description"):
                            self._enrich_from_detail(raw)
                        yield raw
                nxt = _first(page, sel.get("next_page"))
                url = urljoin(page.url, nxt) if nxt else None
            if url:  # stopped by the page limit, not the end of the listing
                complete = False
        self.complete = complete

    def _parse_item(self, node, base_url: str) -> RawProduct | None:
        sel = self.config.selectors
        title = _first(node, sel.get("title"))
        href = _first(node, sel.get("url"))
        price = _first(node, sel.get("price"))
        if not (title and href and price):
            return None
        url = urljoin(base_url, href)
        image = _first(node, sel.get("image"))
        return RawProduct(
            external_id=hashlib.md5(url.encode()).hexdigest()[:24],
            title=title,
            url=url,
            price=price,
            original_price=_first(node, sel.get("original_price")),
            brand=_first(node, sel.get("brand")),
            image_url=urljoin(base_url, image) if image else None,
            in_stock=_first(node, sel.get("out_of_stock")) is None,
        )

    def _enrich_from_detail(self, raw: RawProduct) -> None:
        try:
            detail = self.fetcher.get(raw.url)
            raw.description = _first(detail, self.config.selectors.get("detail_description"))
        except FetchError as exc:
            log.debug("[%s] detail fetch failed for %s: %s", self.config.slug, raw.url, exc)
