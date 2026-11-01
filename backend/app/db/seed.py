"""Deterministic demo menus so the app is usable before the first scrape.

Runs two simulated scrape passes through the real ingestion pipeline:
pass 1 sets "last week's" prices, pass 2 applies sales and price drops, so
price history, price-drop events and new-item events are all populated.
"""

import random
from datetime import timedelta

from app.core.logging import get_logger
from app.db.base import Base, utcnow
from app.db.session import engine, session_scope
from app.models import AdBanner, PriceHistory, ProductEvent, Review, Store
from app.scrapers.base import StoreConfig
from app.services.indexing import index_products
from app.services.ingestion import apply_store_meta, ingest_products
from app.services.normalization.normalizer import RawProduct

log = get_logger(__name__)

# Fictional restaurants, clearly marked "(demo)", so offline demo prices can never be mistaken
# for a real restaurant's menu. Real data comes from `python -m app.cli scrape`.
STORES = {
    "tikka-house": StoreConfig(
        "tikka-house",
        "Tikka House (demo)",
        "https://example.com/tikka-house",
        platform="demo",
        verticals=["food"],
        cuisines=["bbq", "desi"],
        cities=["Lahore", "Karachi"],
    ),
    "grill-yard": StoreConfig(
        "grill-yard",
        "Grill Yard (demo)",
        "https://example.com/grill-yard",
        platform="demo",
        verticals=["food"],
        cuisines=["bbq", "burgers"],
        cities=["Karachi"],
    ),
    "karahi-point": StoreConfig(
        "karahi-point",
        "Karahi Point (demo)",
        "https://example.com/karahi-point",
        platform="demo",
        verticals=["food"],
        cuisines=["desi", "biryani"],
        cities=["Lahore", "Islamabad"],
    ),
    "burger-yard": StoreConfig(
        "burger-yard",
        "Burger Yard (demo)",
        "https://example.com/burger-yard",
        platform="demo",
        verticals=["food"],
        cuisines=["burgers"],
        cities=["Lahore", "Karachi"],
    ),
    "bun-studio": StoreConfig(
        "bun-studio",
        "Bun Studio (demo)",
        "https://example.com/bun-studio",
        platform="demo",
        verticals=["food"],
        cuisines=["burgers", "fried chicken"],
        cities=["Islamabad", "Karachi"],
    ),
    "slice-studio": StoreConfig(
        "slice-studio",
        "Slice Studio (demo)",
        "https://example.com/slice-studio",
        platform="demo",
        verticals=["food"],
        cuisines=["pizza"],
        cities=["Lahore", "Karachi"],
    ),
    "oven-works": StoreConfig(
        "oven-works",
        "Oven Works (demo)",
        "https://example.com/oven-works",
        platform="demo",
        verticals=["food"],
        cuisines=["pizza"],
        cities=["Islamabad"],
    ),
    "chai-station": StoreConfig(
        "chai-station",
        "Chai Station (demo)",
        "https://example.com/chai-station",
        platform="demo",
        verticals=["food"],
        cuisines=["cafe", "desserts"],
        cities=["Lahore"],
    ),
}

DESI = ["tikka-house", "grill-yard", "karahi-point"]
BURGER = ["burger-yard", "bun-studio", "grill-yard"]
PIZZA = ["slice-studio", "oven-works"]
CAFE = ["chai-station", "karahi-point", "burger-yard"]

# (stores, title, base price, menu section, description)
MENU: list[tuple[list[str], str, float, str, str | None]] = [
    (DESI, "Chicken Tikka (Leg)", 520, "BBQ", None),
    (DESI, "Chicken Tikka (Chest)", 580, "BBQ", None),
    (DESI, "Beef Tikka Boti (8 pcs)", 1150, "BBQ", None),
    (DESI, "Malai Boti (8 pcs)", 980, "BBQ", None),
    (DESI, "Seekh Kabab (4 pcs)", 760, "BBQ", None),
    (DESI, "Chicken Karahi (Half)", 1450, "Karahi", None),
    (DESI, "Chicken Karahi (Full)", 2650, "Karahi", None),
    (DESI, "Mutton Karahi (Half)", 2900, "Karahi", None),
    (DESI, "Chicken Biryani (Single)", 450, "Rice", None),
    (DESI, "Beef Nihari (Single)", 690, "Curries", None),
    (DESI, "Garlic Naan", 120, "Tandoor", None),
    (DESI, "BBQ Platter (Serves 4)", 4200, "Platters", "Chicken tikka + 8 pcs malai boti + 8 pcs seekh kabab + 4 naan"),
    (BURGER, "Zinger Burger", 690, "Burgers", None),
    (BURGER, "Beef Smash Burger (Double)", 1290, "Burgers", None),
    (BURGER, "Crispy Chicken Wings (6 pcs)", 650, "Sides", None),
    (BURGER, "Loaded Fries", 590, "Sides", None),
    (BURGER, "Zinger Burger Meal", 990, "Deals", "Zinger burger + regular fries + soft drink"),
    (PIZZA, 'Chicken Tikka Pizza (Small 7")', 790, "Pizza", None),
    (PIZZA, 'Chicken Tikka Pizza (Medium 10")', 1450, "Pizza", None),
    (PIZZA, 'Chicken Tikka Pizza (Large 13")', 2250, "Pizza", None),
    (PIZZA, 'Pepperoni Pizza (Large 13")', 2490, "Pizza", None),
    (PIZZA, "Family Pizza Deal", 3290, "Deals", "2 large pizzas + garlic bread + 1.5 ltr drink"),
    (CAFE, "Doodh Patti", 220, "Hot Beverages", None),
    (CAFE, "Chocolate Shake", 590, "Shakes", None),
    (CAFE, "Molten Lava Cake", 650, "Desserts", None),
    (PIZZA + BURGER, "Soft Drink 1.5 Ltr", 280, "Beverages", None),
]


def _raw(rng: random.Random, store_slug: str, idx: int, title: str, price: float, section: str, description: str | None) -> RawProduct:
    cfg = STORES[store_slug]
    handle = title.lower().replace(" ", "-").replace("/", "-").replace('"', "")[:80]
    return RawProduct(
        external_id=f"demo-{store_slug}-{idx}",
        title=title,
        url=f"{cfg.website}/menu/{handle}",
        price=price,
        original_price=price,
        description=description,
        product_type=section,
        tags=[section],
        image_url=None,
        in_stock=rng.random() > 0.03,
        extra={"menu_section": section},
    )


def build_catalogue(seed: int = 42) -> dict[str, list[RawProduct]]:
    rng = random.Random(seed)
    per_store: dict[str, list[RawProduct]] = {s: [] for s in STORES}
    for idx, (stores, title, base, section, description) in enumerate(MENU):
        for slug in dict.fromkeys(stores):
            # Each restaurant prices the same dish a little differently.
            price = round(base * rng.uniform(0.85, 1.2) / 10) * 10
            per_store[slug].append(_raw(rng, slug, idx, title, price, section, description))
    return per_store


def apply_sales(per_store: dict[str, list[RawProduct]], seed: int = 7) -> None:
    rng = random.Random(seed)
    for products in per_store.values():
        for p in products:
            roll = rng.random()
            if roll < 0.2:  # limited-time offer: menu price stays, price drops
                p.original_price = p.price
                p.price = round(float(p.price) * (1 - rng.choice([0.1, 0.15, 0.2, 0.25])))
            elif roll < 0.3:  # menu price cut
                p.price = round(float(p.price) * rng.uniform(0.85, 0.95))
            elif roll < 0.4:  # menu price increase
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
        _seed_extras(db)
        if index:
            index_products(db, None)
    return total


def _seed_extras(db) -> None:
    """Demo offers, one featured banner and a few demo reviews so every page has something to show."""
    from sqlalchemy import select

    stores = {s.slug: s for s in db.scalars(select(Store))}
    offer = {"id": "demo-1", "title": "20% off", "detail": "On delivery orders, whole menu", "percent": 20.0, "channels": ["delivery"]}
    apply_store_meta(stores["tikka-house"], STORES["tikka-house"], {"offers": [offer]})
    apply_store_meta(
        stores["slice-studio"], STORES["slice-studio"], {"offers": [{**offer, "id": "demo-2", "title": "15% off", "percent": 15.0}]}
    )
    db.add(
        AdBanner(
            store_id=stores["tikka-house"].id,
            kind="featured",
            eyebrow="Featured offer",
            title="20% off at Tikka House",
            subtitle="Delivery orders, whole menu (demo data)",
            cta_label="See the menu",
            priority=1,
        )
    )
    for slug, rating, text in (
        ("tikka-house", 5, "Tikka was smoky and juicy, chest piece was big. (demo review)"),
        ("tikka-house", 4, "Good karahi, a bit oily. (demo review)"),
        ("burger-yard", 3, "Zinger was crispy but the bun was dry. (demo review)"),
    ):
        db.add(Review(store_id=stores[slug].id, source="parakh", author_name="Demo diner", rating=rating, text=text, media=[]))
    db.flush()
