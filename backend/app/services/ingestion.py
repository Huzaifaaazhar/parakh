"""Persist normalised scrape results and detect changes.

For every product seen in a run we:
- insert it (event: new_item) or update it in place,
- append a PriceHistory row when price/stock changed,
- emit price_drop / price_increase / back_in_stock events.
Products previously active for the store but missing from a *complete* run
are marked out of stock (event: out_of_stock).
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.cache import cache
from app.core.logging import get_logger
from app.db.base import utcnow
from app.models import PriceHistory, Product, ProductEvent, ScrapeRun, Store
from app.scrapers.base import StoreConfig
from app.services.normalization.normalizer import RawProduct, normalize

log = get_logger(__name__)

MIN_DROP_PCT = 1.0  # ignore sub-1% price jitter


@dataclass
class IngestStats:
    seen: int = 0
    new: int = 0
    updated: int = 0
    price_drops: int = 0
    out_of_stock: int = 0
    skipped: int = 0
    changed_ids: set[int] = field(default_factory=set)


def get_or_create_store(db: Session, cfg: StoreConfig) -> Store:
    store = db.scalar(select(Store).where(Store.slug == cfg.slug))
    if store is None:
        store = Store(slug=cfg.slug, name=cfg.name, website=cfg.website, platform=cfg.platform, verticals=cfg.verticals)
        db.add(store)
        db.flush()
    else:
        store.name, store.website, store.platform, store.verticals = cfg.name, cfg.website, cfg.platform, cfg.verticals
    if cfg.logo_url:
        store.logo_url = cfg.logo_url
    return store


def _f(value: Any) -> float:
    return float(value or 0)


def _apply_record(
    db: Session, store: Store, record: dict[str, Any], existing: Product | None, run_id: int | None, stats: IngestStats, now: datetime
) -> None:
    if existing is None:
        product = Product(store_id=store.id, first_seen_at=now, last_updated=now, **record)
        db.add(product)
        db.flush()
        db.add(
            PriceHistory(
                product_id=product.id,
                price=record["price"],
                original_price=record["original_price"],
                in_stock=record["in_stock"],
                recorded_at=now,
            )
        )
        db.add(ProductEvent(product_id=product.id, event_type="new_item", new_price=record["price"], run_id=run_id, created_at=now))
        stats.new += 1
        stats.changed_ids.add(product.id)
        return

    product = existing
    old_price, new_price = _f(product.price), _f(record["price"])
    old_stock, new_stock = product.in_stock, record["in_stock"]
    price_changed = abs(old_price - new_price) >= 0.01 or abs(_f(product.original_price) - _f(record["original_price"])) >= 0.01
    content_changed = product.content_hash != record["content_hash"] or not product.is_active

    if price_changed or old_stock != new_stock:
        db.add(
            PriceHistory(
                product_id=product.id, price=new_price, original_price=record["original_price"], in_stock=new_stock, recorded_at=now
            )
        )

    if old_price > 0 and new_price < old_price:
        drop = round((old_price - new_price) / old_price * 100, 1)
        if drop >= MIN_DROP_PCT:
            db.add(
                ProductEvent(
                    product_id=product.id,
                    event_type="price_drop",
                    old_price=old_price,
                    new_price=new_price,
                    drop_percentage=drop,
                    run_id=run_id,
                    created_at=now,
                )
            )
            stats.price_drops += 1
    elif new_price > old_price and old_price > 0:
        db.add(
            ProductEvent(
                product_id=product.id, event_type="price_increase", old_price=old_price, new_price=new_price, run_id=run_id, created_at=now
            )
        )

    if old_stock and not new_stock:
        db.add(ProductEvent(product_id=product.id, event_type="out_of_stock", old_price=old_price, run_id=run_id, created_at=now))
        stats.out_of_stock += 1
    elif not old_stock and new_stock:
        db.add(ProductEvent(product_id=product.id, event_type="back_in_stock", new_price=new_price, run_id=run_id, created_at=now))

    for key, value in record.items():
        setattr(product, key, value)
    product.is_active = True
    product.last_updated = now
    if price_changed:
        product.last_price_change_at = now
    if price_changed or content_changed or old_stock != new_stock:
        stats.updated += 1
        stats.changed_ids.add(product.id)


def ingest_products(
    db: Session,
    cfg: StoreConfig,
    raw_products: Iterable[RawProduct],
    run: ScrapeRun | None = None,
    complete: bool | Callable[[], bool] = True,
    batch_size: int = 200,
) -> IngestStats:
    store = get_or_create_store(db, cfg)
    stats = IngestStats()
    now = utcnow()
    existing = {p.external_id: p for p in db.scalars(select(Product).where(Product.store_id == store.id))}
    seen_ids: set[str] = set()
    run_id = run.id if run else None

    for raw in raw_products:
        stats.seen += 1
        try:
            record = normalize(raw, store_name=cfg.name, allowed_verticals=cfg.verticals, default_gender=cfg.default_gender)
        except Exception as exc:  # noqa: BLE001
            log.warning("[%s] normalisation failed for %s: %s", cfg.slug, raw.external_id, exc)
            record = None
        if record is None:
            stats.skipped += 1
            continue
        if record["external_id"] in seen_ids:
            continue
        seen_ids.add(record["external_id"])
        _apply_record(db, store, record, existing.get(record["external_id"]), run_id, stats, now)
        if stats.seen % batch_size == 0:
            db.flush()

    # Only infer "gone/out of stock" when the scrape covered the whole catalogue.
    is_complete = complete() if callable(complete) else complete
    if is_complete and seen_ids:
        for ext_id, product in existing.items():
            if ext_id not in seen_ids and product.is_active:
                if product.in_stock:
                    db.add(
                        ProductEvent(
                            product_id=product.id, event_type="out_of_stock", old_price=product.price, run_id=run_id, created_at=now
                        )
                    )
                    stats.out_of_stock += 1
                    db.add(
                        PriceHistory(
                            product_id=product.id,
                            price=product.price,
                            original_price=product.original_price,
                            in_stock=False,
                            recorded_at=now,
                        )
                    )
                product.in_stock = False
                product.is_active = False
                stats.changed_ids.add(product.id)

    store.last_scraped_at = now
    if run:
        run.items_seen, run.items_new, run.items_updated = stats.seen, stats.new, stats.updated
        run.price_drops, run.out_of_stock = stats.price_drops, stats.out_of_stock
    db.flush()
    cache.invalidate_all()
    log.info(
        "[%s] ingested seen=%s new=%s updated=%s drops=%s oos=%s skipped=%s",
        cfg.slug,
        stats.seen,
        stats.new,
        stats.updated,
        stats.price_drops,
        stats.out_of_stock,
        stats.skipped,
    )
    return stats
