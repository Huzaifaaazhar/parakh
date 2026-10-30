import json

from app.scrapers.base import StoreConfig
from app.scrapers.fetch import FetchResult
from app.scrapers.html_generic import HtmlScraper
from app.scrapers.registry import load_store_configs
from app.scrapers.shopify import ShopifyScraper, parse_shopify_product


def shopify_item(pid: int, title: str = "Men Black Polo", price: str = "1990.00", compare: str | None = "2990.00", available: bool = True):
    return {
        "id": pid,
        "title": title,
        "handle": f"item-{pid}",
        "vendor": "Outfitters",
        "product_type": "Polo",
        "body_html": "<p>Cotton polo</p>",
        "tags": ["Men", "Summer"],
        "images": [{"src": f"https://cdn.shopify.com/{pid}.jpg"}],
        "options": [{"name": "Size", "values": ["S", "M", "L"]}, {"name": "Color", "values": ["Black"]}],
        "variants": [
            {"price": "2490.00", "compare_at_price": None, "available": available},
            {"price": price, "compare_at_price": compare, "available": available},
        ],
    }


class FakeFetcher:
    def __init__(self, pages: dict[int, list[dict]]):
        self.pages = pages
        self.urls: list[str] = []

    def get(self, url: str) -> FetchResult:
        self.urls.append(url)
        page = int(url.split("page=")[1])
        return FetchResult(url=url, status=200, text=json.dumps({"products": self.pages.get(page, [])}))


def test_parse_shopify_product_uses_cheapest_variant():
    raw = parse_shopify_product(shopify_item(1), "https://outfitters.com.pk")
    assert raw.price == "1990.00" and raw.original_price == "2990.00"
    assert raw.url == "https://outfitters.com.pk/products/item-1"
    assert raw.options == {"size": ["S", "M", "L"], "color": ["Black"]}
    assert raw.in_stock


def test_shopify_pagination_and_completeness(monkeypatch):
    monkeypatch.setattr("app.scrapers.shopify.settings.scraper_page_size", 2)
    fetcher = FakeFetcher({1: [shopify_item(1), shopify_item(2)], 2: [shopify_item(3)]})
    scraper = ShopifyScraper(StoreConfig("s", "S", "https://s.pk"), fetcher=fetcher)
    items = list(scraper.iter_products())
    assert [i.external_id for i in items] == ["1", "2", "3"]
    assert scraper.complete
    assert len(fetcher.urls) == 2


def test_shopify_page_limit_is_incomplete(monkeypatch):
    monkeypatch.setattr("app.scrapers.shopify.settings.scraper_page_size", 1)
    fetcher = FakeFetcher({1: [shopify_item(1)], 2: [shopify_item(2)], 3: [shopify_item(3)]})
    scraper = ShopifyScraper(StoreConfig("s", "S", "https://s.pk", max_pages=2), fetcher=fetcher)
    assert len(list(scraper.iter_products())) == 2
    assert not scraper.complete


def test_shopify_all_unavailable_page_means_unknown_stock():
    fetcher = FakeFetcher({1: [shopify_item(i, available=False) for i in range(25)]})
    items = list(ShopifyScraper(StoreConfig("s", "S", "https://s.pk"), fetcher=fetcher).iter_products())
    assert all(i.in_stock for i in items)


def test_html_scraper_with_selectors():
    html = """
    <html><body>
      <div class="tile"><a href="/p/1"><h3 class="name">Women Lawn Kurta</h3></a>
        <span class="now">Rs. 2,450</span><span class="was">Rs. 3,500</span><img src="/i/1.jpg"></div>
      <div class="tile"><a href="/p/2"><h3 class="name">Men Kurta</h3></a><span class="now">Rs. 3,000</span></div>
      <div class="tile"><h3 class="name">Broken (no link)</h3></div>
    </body></html>"""

    class HtmlFetcher:
        def get(self, url):
            return FetchResult(url=url, status=200, text=html)

    cfg = StoreConfig(
        "h",
        "H",
        "https://h.pk",
        platform="html",
        listing_urls=["https://h.pk/c/all"],
        selectors={
            "item": ".tile",
            "title": ".name::text",
            "url": "a::attr(href)",
            "price": ".now::text",
            "original_price": ".was::text",
            "image": "img::attr(src)",
        },
    )
    scraper = HtmlScraper(cfg, fetcher=HtmlFetcher())
    items = list(scraper.iter_products())
    assert [i.title for i in items] == ["Women Lawn Kurta", "Men Kurta"]
    assert items[0].url == "https://h.pk/p/1" and items[0].original_price == "Rs. 3,500"
    assert items[0].image_url == "https://h.pk/i/1.jpg"
    assert scraper.complete


def test_store_config_loads():
    configs = load_store_configs()
    slugs = {c.slug for c in configs}
    assert {"outfitters", "telemart", "audionic"} <= slugs
    assert "example-html-store" not in slugs  # disabled
    assert all(c.platform in {"shopify", "html"} for c in configs)
