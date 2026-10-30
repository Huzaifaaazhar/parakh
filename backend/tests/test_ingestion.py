from sqlalchemy import select

from app.models import PriceHistory, Product, ProductEvent
from app.scrapers.base import StoreConfig
from app.services.ingestion import ingest_products
from app.services.normalization.normalizer import RawProduct

CFG = StoreConfig("ingest-test", "Ingest Test", "https://ingest.pk", verticals=["fashion"])


def raw(ext: str, price: float, original: float | None = None, in_stock: bool = True) -> RawProduct:
    return RawProduct(ext, f"Men Cotton Kurta {ext}", f"https://ingest.pk/p/{ext}", price=price, original_price=original, in_stock=in_stock)


def events(db, product_id: int) -> list[str]:
    return [e.event_type for e in db.scalars(select(ProductEvent).where(ProductEvent.product_id == product_id).order_by(ProductEvent.id))]


def test_new_items_then_price_drop_and_stock_changes(db):
    stats = ingest_products(db, CFG, [raw("a", 3000), raw("b", 2000), raw("c", 1500)])
    assert stats.new == 3
    a = db.scalar(select(Product).where(Product.external_id == "a"))
    assert a.category == "kurta" and a.gender == "men"

    # Second run: "a" drops 20%, "b" sells out, "c" disappears from the catalogue.
    stats = ingest_products(db, CFG, [raw("a", 2400, 3000), raw("b", 2000, in_stock=False)])
    assert stats.price_drops == 1
    assert stats.out_of_stock == 2
    db.refresh(a)
    assert float(a.price) == 2400 and a.discount_percentage == 20.0
    assert events(db, a.id) == ["new_item", "price_drop"]
    drop = db.scalar(select(ProductEvent).where(ProductEvent.product_id == a.id, ProductEvent.event_type == "price_drop"))
    assert drop.drop_percentage == 20.0 and float(drop.old_price) == 3000
    assert len(db.scalars(select(PriceHistory).where(PriceHistory.product_id == a.id)).all()) == 2

    c = db.scalar(select(Product).where(Product.external_id == "c"))
    assert not c.is_active and not c.in_stock

    # Third run: "b" is back.
    ingest_products(db, CFG, [raw("a", 2400, 3000), raw("b", 2000), raw("c", 1500)])
    b = db.scalar(select(Product).where(Product.external_id == "b"))
    assert events(db, b.id)[-1] == "back_in_stock"
    db.refresh(c)
    assert c.is_active and c.in_stock


def test_incomplete_run_does_not_mark_missing_items(db):
    cfg = StoreConfig("partial-test", "Partial", "https://partial.pk", verticals=["fashion"])
    ingest_products(db, cfg, [raw("x", 1000), raw("y", 1000)])
    stats = ingest_products(db, cfg, [raw("x", 1000)], complete=lambda: False)
    assert stats.out_of_stock == 0
    y = db.scalar(select(Product).where(Product.external_id == "y", Product.brand_name == "Partial"))
    assert y.is_active and y.in_stock


def test_small_jitter_is_not_a_price_drop(db):
    cfg = StoreConfig("jitter-test", "Jitter", "https://jitter.pk", verticals=["fashion"])
    ingest_products(db, cfg, [raw("j", 1000)])
    stats = ingest_products(db, cfg, [raw("j", 995)])
    assert stats.price_drops == 0
