from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.scrapers.fetch import Fetcher
from app.services.normalization.normalizer import RawProduct


@dataclass
class StoreConfig:
    slug: str
    name: str
    website: str
    platform: str = "shopify"
    verticals: list[str] = field(default_factory=lambda: ["fashion"])
    enabled: bool = True
    logo_url: str | None = None
    max_pages: int | None = None
    fetcher: str | None = None  # override global fetcher mode per store
    collections: list[str] = field(default_factory=list)  # optional Shopify collection handles
    selectors: dict[str, str] = field(default_factory=dict)  # for the generic HTML adapter
    listing_urls: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)


class BaseScraper(ABC):
    def __init__(self, config: StoreConfig, fetcher: Fetcher | None = None):
        self.config = config
        self.fetcher = fetcher or Fetcher(mode=config.fetcher)
        # Set to True only when the scraper walked the *entire* catalogue without
        # errors or page limits; ingestion uses it to decide what has disappeared.
        self.complete = False

    @abstractmethod
    def iter_products(self) -> Iterator[RawProduct]:
        """Yield raw products from listings (and detail pages if needed)."""
