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


def test_restaurant_config_loads():
    configs = load_store_configs()
    slugs = {c.slug for c in configs}
    assert {"tooso", "burger-lab", "bundu-khan", "student-biryani"} <= slugs
    assert "ginsoy" not in slugs  # disabled
    assert all(c.platform in {"indolj", "jsonld"} for c in configs)
    assert all(c.verticals == ["food"] and c.cuisines for c in configs)


INDOLJ_MENU = {
    "code": "2",
    "details": {
        "805": {
            "title": "BBQ",
            "categoryDetail": {"out_of_stock": "False"},
            "items": {
                "11": {
                    "item_id": "11",
                    "item_slug": "Chicken-Tikka",
                    "item_name": "Chicken Tikka",
                    "item_description": "",
                    "photo": "https://assets.indolj.io/upload/tikka.jpg",
                    "prices": [
                        {"price": 740, "size": "Chest", "size_id": 1, "discounted_price": False},
                        {"price": 700, "size": "Leg", "size_id": 2, "discounted_price": 630},
                    ],
                },
                "12": None,
            },
        },
        "900": {"title": "Popular Items", "items": {"11": {"item_id": "11", "item_name": "Chicken Tikka", "prices": [{"price": 740}]}}},
        "901": {
            "title": "Sold out",
            "categoryDetail": {"out_of_stock": "True"},
            "items": {"13": {"item_name": "X", "prices": [{"price": 1}]}},
        },
    },
}


def test_indolj_menu_parsing():
    from app.scrapers.indolj import iter_menu, parse_cities, parse_offer

    items = list(iter_menu(INDOLJ_MENU, "https://www.tooso.pk"))
    assert [i.title for i in items] == ["Chicken Tikka (Chest)", "Chicken Tikka (Leg)"]
    leg = items[1]
    assert leg.price == 630 and leg.original_price == 700  # discounted size
    assert leg.external_id == "11-2" and leg.extra["size"] == "Leg" and leg.product_type == "BBQ"
    assert leg.url == "https://www.tooso.pk/product/Chicken-Tikka-11"

    offer = parse_offer(
        {
            "offers_id": "190",
            "active": "1",
            "current_status": "active",
            "offer_percentage": "20.0000",
            "discount_type": "percentage",
            "custom_msg": "On Delivery Orders",
            "trans_type": '["delivery"]',
            "valid_to": "2027-07-14",
        }
    )
    assert offer["title"] == "20% off" and offer["channels"] == ["delivery"] and offer["detail"] == "On Delivery Orders"
    assert parse_offer({"active": "0", "offer_percentage": "20"}) is None
    areas = {"details": {"areas": {"1": [{"city_name": "karachi"}, {"city_name": "Karachi"}, None], "2": [{"city_name": "lahore"}]}}}
    assert parse_cities(areas) == (["Karachi", "Lahore"], 3)


def test_jsonld_menu_parsing():
    from app.scrapers.jsonld import JsonLdScraper

    html = """<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
      {"@type":"ListItem","item":{"@type":"Product","name":"Chicken Karahi (Half)","url":"https://bk.pk/product/karahi-1",
       "image":"https://static.tossdown.com/k.webp","offers":{"@type":"Offer","price":"1890.00","availability":"https://schema.org/InStock"}}},
      {"@type":"ListItem","item":{"@type":"Product","name":"Fish Cracker","url":"https://bk.pk/product/fish-2",
       "offers":{"@type":"Offer","price":"620.00","availability":"https://schema.org/OutOfStock"}}},
      {"@type":"ListItem","item":{"@type":"Product","name":"No price"}}]}</script>"""

    class Fake:
        def get(self, url):
            return FetchResult(url=url, status=200, text=html)

    scraper = JsonLdScraper(StoreConfig("bk", "BK", "https://bk.pk", platform="jsonld", verticals=["food"]), fetcher=Fake())
    items = list(scraper.iter_products())
    assert [(i.title, i.price, i.in_stock) for i in items] == [
        ("Chicken Karahi (Half)", "1890.00", True),
        ("Fish Cracker", "620.00", False),
    ]
    assert items[0].external_id == "karahi-1" and items[0].image_url.endswith("k.webp")
    assert scraper.complete


def test_places_best_match_prefers_flagship():
    from app.models import Store
    from app.services.places import Place, best_match

    def place(name, count):
        return Place(f"id-{count}", name, None, 4.2, count, None, None, None, None, None, None, [])

    store = Store(slug="tooso", name="Tooso", website="", platform="indolj")
    match = best_match(store, [place("Tooso - DHA", 900), place("Tooso Clifton", 2400), place("Toosoon Bakery", 5000)])
    assert match.name == "Tooso Clifton"
    assert best_match(store, [place("Kolachi", 9000)]) is None
