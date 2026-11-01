from pathlib import Path

import yaml

from app.core.config import settings
from app.scrapers.base import BaseScraper, StoreConfig
from app.scrapers.html_generic import HtmlScraper
from app.scrapers.indolj import IndoljScraper
from app.scrapers.jsonld import JsonLdScraper
from app.scrapers.shopify import ShopifyScraper

ADAPTERS: dict[str, type[BaseScraper]] = {
    "shopify": ShopifyScraper,
    "html": HtmlScraper,
    "indolj": IndoljScraper,
    "jsonld": JsonLdScraper,
}


def load_store_configs(path: str | None = None, include_disabled: bool = False) -> list[StoreConfig]:
    data = yaml.safe_load(Path(path or settings.scraper_config_path).read_text()) or {}
    configs = []
    for entry in data.get("stores", []):
        known = {k: v for k, v in entry.items() if k in StoreConfig.__dataclass_fields__}
        cfg = StoreConfig(**known)
        if cfg.enabled or include_disabled:
            configs.append(cfg)
    return configs


def get_scraper(config: StoreConfig) -> BaseScraper:
    adapter = ADAPTERS.get(config.platform)
    if not adapter:
        raise ValueError(f"No scraper adapter for platform '{config.platform}'")
    return adapter(config)
