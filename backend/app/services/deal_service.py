"""Sales aggregation and price-drop tracking across every store."""

from datetime import timedelta
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.cache import cached
from app.db.base import utcnow
from app.models import Product, ProductEvent, Store
from app.schemas.product import ProductQuery
from app.services.product_service import apply_filters, serialize


@cached("deals")
def get_deals(db: Session, *, query: dict[str, Any]) -> dict[str, Any]:
    q = ProductQuery(**{**query, "on_sale": True})
    stmt = apply_filters(select(Product), q)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {
        "price_asc": [Product.price.asc()],
        "price_desc": [Product.price.desc()],
        "newest": [Product.last_price_change_at.desc().nulls_last()],
        # Savings in rupees, not just %: 50% off 20k beats 60% off 500.
        "savings": [(Product.original_price - Product.price).desc()],
    }.get(q.sort, [Product.discount_percentage.desc(), (Product.original_price - Product.price).desc()])
    rows = db.scalars(stmt.order_by(*order, Product.id).offset((q.page - 1) * q.page_size).limit(q.page_size)).unique().all()
    return {"items": [serialize(p) for p in rows], "total": total, "page": q.page, "page_size": q.page_size}


@cached("price_drops")
def get_price_drops(
    db: Session, *, days: int = 7, limit: int = 50, vertical: str | None = None, min_drop: float = 1.0
) -> list[dict[str, Any]]:
    since = utcnow() - timedelta(days=days)
    stmt = (
        select(ProductEvent)
        .join(Product, Product.id == ProductEvent.product_id)
        .where(
            ProductEvent.event_type == "price_drop",
            ProductEvent.created_at >= since,
            ProductEvent.drop_percentage >= min_drop,
            Product.is_active.is_(True),
            # Only drops that still hold (price hasn't bounced back up).
            Product.price <= ProductEvent.new_price,
        )
        .order_by(ProductEvent.drop_percentage.desc(), ProductEvent.created_at.desc())
        .limit(limit * 3)
    )
    if vertical:
        stmt = stmt.where(Product.vertical == vertical)
    seen: set[int] = set()
    drops = []
    for ev in db.scalars(stmt).unique():
        if ev.product_id in seen:
            continue
        seen.add(ev.product_id)
        old, new = float(ev.old_price or 0), float(ev.new_price or 0)
        drops.append(
            {
                "product": serialize(ev.product),
                "old_price": old,
                "new_price": new,
                "drop_amount": round(old - new, 2),
                "drop_percentage": ev.drop_percentage or 0.0,
                "detected_at": ev.created_at.isoformat(),
            }
        )
        if len(drops) >= limit:
            break
    return drops


@cached("stores:summary")
def store_sale_summaries(db: Session, *, vertical: str | None = None) -> list[dict[str, Any]]:
    conds = [Product.is_active.is_(True)]
    if vertical:
        conds.append(Product.vertical == vertical)
    on_sale = case((Product.discount_percentage > 0, 1), else_=0)
    rows = db.execute(
        select(
            Store,
            func.count(Product.id),
            func.sum(on_sale),
            func.max(Product.discount_percentage),
            func.avg(case((Product.discount_percentage > 0, Product.discount_percentage))),
        )
        .join(Product, Product.store_id == Store.id)
        .where(*conds)
        .group_by(Store.id)
    ).all()
    out = []
    for store, total, sale, max_disc, avg_disc in rows:
        sale = int(sale or 0)
        out.append(
            {
                "id": store.id,
                "slug": store.slug,
                "name": store.name,
                "website": store.website,
                "platform": store.platform,
                "verticals": store.verticals or [],
                "logo_url": store.logo_url,
                "last_scraped_at": store.last_scraped_at.isoformat() if store.last_scraped_at else None,
                "total_products": int(total),
                "on_sale": sale,
                "sale_share": round(sale / total * 100, 1) if total else 0.0,
                "max_discount": round(float(max_disc or 0), 1),
                "avg_discount": round(float(avg_disc or 0), 1),
            }
        )
    return sorted(out, key=lambda s: (s["on_sale"] > 0, s["sale_share"]), reverse=True)


@cached("sales:overview")
def sales_overview(db: Session, *, vertical: str | None = None) -> dict[str, Any]:
    conds = [Product.is_active.is_(True)]
    if vertical:
        conds.append(Product.vertical == vertical)
    total = db.scalar(select(func.count()).where(*conds)) or 0
    on_sale = db.scalar(select(func.count()).where(*conds, Product.discount_percentage > 0)) or 0
    avg = db.scalar(select(func.avg(Product.discount_percentage)).where(*conds, Product.discount_percentage > 0)) or 0
    by_vertical = dict(
        db.execute(select(Product.vertical, func.count()).where(*conds, Product.discount_percentage > 0).group_by(Product.vertical)).all()
    )
    top = get_deals(db, query={"vertical": vertical, "page_size": 12})
    return {
        "total_products": total,
        "total_on_sale": on_sale,
        "average_discount": round(float(avg), 1),
        "stores": store_sale_summaries(db, vertical=vertical),
        "by_vertical": {k: int(v) for k, v in by_vertical.items()},
        "top_deals": top["items"],
        "recent_price_drops": get_price_drops(db, days=14, limit=12, vertical=vertical),
    }
