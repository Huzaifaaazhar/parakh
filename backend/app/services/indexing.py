from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models import Product
from app.services.normalization.normalizer import embedding_text
from app.services.vector.store import LeannVectorStore, get_vector_store, product_metadata

log = get_logger(__name__)


def index_products(db: Session, product_ids: Iterable[int] | None = None, batch_size: int = 256) -> int:
    """Embed products into the vector store. `None` means reindex everything."""
    store = get_vector_store()
    stmt = select(Product).order_by(Product.id)
    if product_ids is not None:
        ids = list(product_ids)
        if not ids:
            return 0
        stmt = stmt.where(Product.id.in_(ids))

    if isinstance(store, LeannVectorStore):
        # LEANN builds the whole index at once.
        rows = db.scalars(select(Product).where(Product.is_active.is_(True))).all()
        store.rebuild([(p.id, embedding_text(p), product_metadata(p)) for p in rows])
        return len(rows)

    total = 0
    batch: list[Product] = []
    inactive: list[int] = []

    def flush() -> None:
        nonlocal total
        if batch:
            store.upsert([p.id for p in batch], [embedding_text(p) for p in batch], [product_metadata(p) for p in batch])
            total += len(batch)
            batch.clear()

    for product in db.scalars(stmt).yield_per(batch_size):
        if not product.is_active:
            inactive.append(product.id)
            continue
        batch.append(product)
        if len(batch) >= batch_size:
            flush()
    flush()
    if inactive:
        store.delete(inactive)
    log.info("Indexed %s products (%s removed)", total, len(inactive))
    return total
