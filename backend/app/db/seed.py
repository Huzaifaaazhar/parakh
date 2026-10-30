"""Deterministic demo catalogue so the app is usable before the first scrape.

Runs two simulated scrape passes through the real ingestion pipeline:
pass 1 sets "last week's" prices, pass 2 applies sales and price drops, so
price history, price-drop events and new-item events are all populated.
"""

import random
from datetime import timedelta

from app.core.logging import get_logger
from app.db.base import Base, utcnow
from app.db.session import engine, session_scope
from app.models import PriceHistory, ProductEvent
from app.scrapers.base import StoreConfig
from app.services.indexing import index_products
from app.services.ingestion import ingest_products
from app.services.normalization.normalizer import RawProduct

log = get_logger(__name__)

STORES = {
    "outfitters": StoreConfig("outfitters", "Outfitters", "https://outfitters.com.pk", verticals=["fashion"]),
    "gul-ahmed": StoreConfig("gul-ahmed", "Gul Ahmed", "https://www.gulahmedshop.com", verticals=["fashion", "home"]),
    "junaid-jamshed": StoreConfig("junaid-jamshed", "J.", "https://www.junaidjamshed.com", verticals=["fashion", "beauty"]),
    "beechtree": StoreConfig("beechtree", "Beechtree", "https://beechtree.pk", verticals=["fashion"]),
    "engine": StoreConfig("engine", "Engine", "https://engine.com.pk", verticals=["fashion"]),
    "bonanza-satrangi": StoreConfig("bonanza-satrangi", "Bonanza Satrangi", "https://bonanzasatrangi.com", verticals=["fashion"]),
    "servis": StoreConfig("servis", "Servis", "https://www.servis.pk", verticals=["fashion"]),
    "ndure": StoreConfig("ndure", "Ndure", "https://www.ndure.com", verticals=["fashion"]),
    "telemart": StoreConfig("telemart", "Telemart", "https://www.telemart.pk", verticals=["electronics", "home", "beauty", "fashion"]),
    "vmart": StoreConfig("vmart", "Vmart", "https://www.vmart.pk", verticals=["electronics"]),
    "audionic": StoreConfig("audionic", "Audionic", "https://www.audionic.co", verticals=["electronics"]),
    "ronin": StoreConfig("ronin", "Ronin", "https://www.ronin.pk", verticals=["electronics"]),
    "saeed-ghani": StoreConfig("saeed-ghani", "Saeed Ghani", "https://www.saeedghani.pk", verticals=["beauty"]),
    "alkaram": StoreConfig("alkaram", "Alkaram Studio", "https://www.alkaramstudio.com", verticals=["fashion", "home"]),
}

COLORS = ["Black", "White", "Navy Blue", "Maroon", "Beige", "Olive Green", "Sky Blue", "Mustard", "Grey", "Pink", "Teal", "Off White"]

# (stores, title template, base price range, tags)
FASHION = [
    (
        ["gul-ahmed", "junaid-jamshed", "bonanza-satrangi", "alkaram", "beechtree"],
        "{color} Embroidered Lawn Kurta",
        (2200, 5200),
        ["women", "kurta"],
    ),
    (
        ["gul-ahmed", "junaid-jamshed", "beechtree", "alkaram"],
        "{color} Printed Lawn Unstitched 3 Piece Suit",
        (3500, 8900),
        ["women", "unstitched"],
    ),
    (["junaid-jamshed", "bonanza-satrangi", "gul-ahmed"], "Men {color} Wash and Wear Kameez Shalwar", (3800, 7500), ["men"]),
    (["junaid-jamshed", "engine", "bonanza-satrangi"], "Men {color} Cotton Kurta", (2500, 5500), ["men", "kurta"]),
    (["outfitters", "engine", "beechtree"], "Men {color} Oxford Casual Shirt", (2400, 5999), ["men", "shirt"]),
    (["outfitters", "engine"], "Men {color} Graphic T-Shirt", (1290, 2990), ["men", "t-shirt"]),
    (["outfitters", "beechtree", "engine"], "Women {color} Basic T-Shirt", (1190, 2690), ["women"]),
    (["outfitters", "engine"], "Men {color} Slim Fit Jeans", (3290, 6990), ["men", "jeans"]),
    (["beechtree", "outfitters"], "Women {color} Wide Leg Trousers", (1990, 4290), ["women"]),
    (["outfitters", "engine", "bonanza-satrangi"], "Kids Boys {color} Polo T-Shirt", (990, 1990), ["kids"]),
    (["beechtree", "bonanza-satrangi"], "Kids Girls {color} Printed Frock", (1490, 3290), ["kids"]),
    (["servis", "ndure", "outfitters"], "Men {color} Running Sneakers", (3499, 8999), ["men", "sneakers"]),
    (["servis", "ndure"], "Women {color} Casual Sandals", (1799, 3999), ["women", "sandals"]),
    (["servis", "ndure"], "Men {color} Leather Peshawari Chappal", (2999, 5499), ["men"]),
    (["outfitters", "engine"], "Men {color} Fleece Hoodie", (3490, 6990), ["men", "winter"]),
    (["gul-ahmed", "alkaram"], "{color} Khaddar Shawl", (1990, 4990), ["women", "winter"]),
]

ELECTRONICS = [
    # Same model at several shops -> "same_product" comparisons
    (["telemart", "vmart"], "Samsung Galaxy A15 8GB/256GB Smartphone - {color}", (52999, 58999), "Samsung", ["mobile"]),
    (["telemart", "vmart"], "Infinix Hot 40i 8GB/128GB Smartphone - {color}", (31999, 35999), "Infinix", ["mobile"]),
    (["telemart", "vmart"], "Xiaomi Redmi 13C 6GB/128GB Smartphone - {color}", (33999, 37999), "Xiaomi", ["mobile"]),
    (["telemart", "vmart", "ronin"], "Lenovo LP40 Pro TWS Earbuds - {color}", (2799, 3999), "Lenovo", ["audio"]),
    (["audionic"], "Audionic Airbud 625 TWS Earbuds - {color}", (3999, 5999), "Audionic", ["audio"]),
    (["ronin"], "Ronin R-520 Wireless Earbuds - {color}", (3495, 5495), "Ronin", ["audio"]),
    (["audionic", "telemart"], "Audionic Solo X Bluetooth Speaker 10W", (4999, 7999), "Audionic", ["audio"]),
    (["ronin", "vmart"], "Ronin R-6600 Power Bank 20000mAh", (4495, 6495), "Ronin", ["power"]),
    (["telemart", "vmart"], "Anker PowerCore 10000mAh Power Bank", (5999, 7499), "Anker", ["power"]),
    (["telemart", "vmart"], "HP 15s Core i5 12th Gen 8GB/512GB SSD Laptop 15.6 inch", (159999, 179999), "HP", ["computer"]),
    (["telemart"], "Dell Inspiron 3520 Core i5 8GB/512GB SSD Laptop 15.6 inch", (164999, 184999), "Dell", ["computer"]),
    (["telemart", "vmart", "ronin"], "Zero Lifestyle Smart Watch with Bluetooth Calling - {color}", (6999, 11999), "Zero", ["wearable"]),
    (["telemart", "vmart"], "Philips Air Fryer 4.1L 1400W", (24999, 32999), "Philips", ["kitchen"]),
]

BEAUTY_HOME = [
    (["saeed-ghani", "junaid-jamshed"], "Rose Water Face Toner 120ml", (450, 950), None, ["skincare"]),
    (["saeed-ghani"], "Vitamin C Brightening Serum 30ml", (1250, 2450), None, ["skincare"]),
    (["junaid-jamshed", "saeed-ghani"], "Oud Eau De Parfum 100ml for Men", (2990, 6500), None, ["fragrance", "men"]),
    (["junaid-jamshed"], "Floral Eau De Parfum 100ml for Women", (2990, 6500), None, ["fragrance", "women"]),
    (["gul-ahmed", "alkaram"], "{color} Cotton Bed Sheet Set King Size", (3990, 8990), None, ["bedding"]),
    (["alkaram", "gul-ahmed"], "{color} Bath Towel Set of 2", (1490, 2990), None, ["towels"]),
]


def _raw(rng: random.Random, store_slug: str, idx: int, title: str, price: float, brand: str | None, tags: list[str]) -> RawProduct:
    cfg = STORES[store_slug]
    handle = title.lower().replace(" ", "-").replace("/", "-")[:80]
    return RawProduct(
        external_id=f"demo-{store_slug}-{idx}",
        title=title,
        url=f"{cfg.website}/products/{handle}",
        price=price,
        original_price=price,
        brand=brand or cfg.name,
        description=f"{title}. Quality product from {brand or cfg.name}, available online at {cfg.name}.",
        tags=tags,
        image_url=None,
        in_stock=rng.random() > 0.05,
    )


def build_catalogue(seed: int = 42) -> dict[str, list[RawProduct]]:
    rng = random.Random(seed)
    per_store: dict[str, list[RawProduct]] = {s: [] for s in STORES}
    counter = 0
    for stores, template, (lo, hi), tags in FASHION:
        for color in rng.sample(COLORS, 4):
            for slug in stores:
                counter += 1
                price = round(rng.uniform(lo, hi) / 10) * 10 - 10
                per_store[slug].append(_raw(rng, slug, counter, template.format(color=color), price, None, tags))
    for stores, template, (lo, hi), brand, tags in ELECTRONICS + BEAUTY_HOME:
        colors = rng.sample(["Black", "White", "Blue", "Green"], 2) if "{color}" in template else [None]
        for color in colors:
            base = rng.uniform(lo, hi)
            for slug in stores:
                counter += 1
                # Same product, slightly different price at each shop.
                price = round(base * rng.uniform(0.94, 1.06) / 10) * 10 - 1
                title = template.format(color=color) if color else template
                per_store[slug].append(_raw(rng, slug, counter, title, price, brand, tags))
    return per_store


def apply_sales(per_store: dict[str, list[RawProduct]], seed: int = 7) -> None:
    rng = random.Random(seed)
    for products in per_store.values():
        for p in products:
            roll = rng.random()
            if roll < 0.35:  # on sale: compare-at stays, price drops
                p.original_price = p.price
                p.price = round(float(p.price) * (1 - rng.choice([0.1, 0.2, 0.25, 0.3, 0.4, 0.5])))
            elif roll < 0.45:  # silent price cut (no compare-at)
                p.price = round(float(p.price) * rng.uniform(0.85, 0.95))
            elif roll < 0.5:
                p.price = round(float(p.price) * 1.08)


def seed_demo(reset: bool = True, index: bool = True) -> int:
    import app.models  # noqa: F401

    if reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    catalogue = build_catalogue()
    with session_scope() as db:
        for slug, products in catalogue.items():
            ingest_products(db, STORES[slug], products)
        # Backdate pass-1 so it reads as last week's scrape.
        week_ago = utcnow() - timedelta(days=7)
        for row in db.query(PriceHistory).all():
            row.recorded_at = week_ago
        for ev in db.query(ProductEvent).all():
            ev.created_at = week_ago
            ev.processed = True
    apply_sales(catalogue)
    total = 0
    with session_scope() as db:
        for slug, products in catalogue.items():
            ingest_products(db, STORES[slug], products)
            total += len(products)
        if index:
            index_products(db, None)
    return total
