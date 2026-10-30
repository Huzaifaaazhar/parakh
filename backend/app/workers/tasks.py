"""Background jobs. Scraping only ever happens here — never in a user request."""

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.base import utcnow
from app.db.session import session_scope
from app.models import Notification, ProductEvent, ScrapeRun, WishlistItem
from app.scrapers.registry import get_scraper, load_store_configs
from app.services.indexing import index_products
from app.services.ingestion import get_or_create_store, ingest_products
from app.workers.celery_app import celery_app

log = get_logger(__name__)


def run_store_scrape(slug: str) -> dict:
    """Scrape one store end-to-end. Usable from Celery or the CLI."""
    configs = {c.slug: c for c in load_store_configs()}
    cfg = configs.get(slug)
    if not cfg:
        raise ValueError(f"Store '{slug}' is not configured or disabled")

    with session_scope() as db:
        store = get_or_create_store(db, cfg)
        run = ScrapeRun(store_id=store.id, status="running")
        db.add(run)
        db.flush()
        run_id = run.id

    changed: list[int] = []
    try:
        scraper = get_scraper(cfg)
        with session_scope() as db:
            run = db.get(ScrapeRun, run_id)
            stats = ingest_products(db, cfg, scraper.iter_products(), run=run, complete=lambda: scraper.complete)
            if stats.seen == 0:
                raise RuntimeError("Scrape returned no products (site down or layout changed?)")
            run.status, run.finished_at = "success", utcnow()
            changed = sorted(stats.changed_ids)
    except Exception as exc:
        log.exception("[%s] scrape failed", slug)
        with session_scope() as db:
            run = db.get(ScrapeRun, run_id)
            run.status, run.finished_at, run.error = "failed", utcnow(), str(exc)[:2000]
        raise

    return {"store": slug, "run_id": run_id, "changed": len(changed), "changed_ids": changed}


def generate_price_alerts() -> int:
    """Turn unprocessed price-drop events into notifications for users watching those products."""
    created = 0
    with session_scope() as db:
        events = (
            db.scalars(
                select(ProductEvent).where(ProductEvent.processed.is_(False), ProductEvent.event_type.in_(["price_drop", "back_in_stock"]))
            )
            .unique()
            .all()
        )
        for ev in events:
            watchers = (
                db.scalars(select(WishlistItem).where(WishlistItem.product_id == ev.product_id, WishlistItem.notify.is_(True)))
                .unique()
                .all()
            )
            for w in watchers:
                price = float(ev.new_price or ev.product.price)
                if ev.event_type == "price_drop" and w.target_price and price > float(w.target_price):
                    continue
                if ev.event_type == "price_drop":
                    msg = f"{ev.product.product_name} dropped {ev.drop_percentage or 0:.0f}% to Rs {price:,.0f} at {ev.product.store_name}"
                else:
                    msg = f"{ev.product.product_name} is back in stock at {ev.product.store_name} (Rs {price:,.0f})"
                db.add(Notification(user_id=w.user_id, product_id=ev.product_id, kind=ev.event_type, message=msg))
                created += 1
            ev.processed = True
    return created


@celery_app.task(bind=True, max_retries=2, default_retry_delay=600, name="app.workers.tasks.scrape_store")
def scrape_store(self, slug: str) -> dict:
    try:
        result = run_store_scrape(slug)
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise self.retry(exc=exc) from exc
    if result["changed_ids"]:
        index_products_task.delay(product_ids=result["changed_ids"])
    notify_price_alerts.delay()
    return {k: v for k, v in result.items() if k != "changed_ids"}


@celery_app.task(name="app.workers.tasks.scrape_all_stores")
def scrape_all_stores() -> list[str]:
    slugs = [c.slug for c in load_store_configs()]
    for i, slug in enumerate(slugs):
        # Stagger stores so we're polite and don't saturate the worker pool.
        scrape_store.apply_async(args=[slug], countdown=i * 20)
    log.info("Queued scrapes for %d stores", len(slugs))
    return slugs


@celery_app.task(name="app.workers.tasks.index_products_task")
def index_products_task(product_ids: list[int] | None = None) -> int:
    with session_scope() as db:
        return index_products(db, product_ids)


@celery_app.task(name="app.workers.tasks.notify_price_alerts")
def notify_price_alerts() -> int:
    return generate_price_alerts()
