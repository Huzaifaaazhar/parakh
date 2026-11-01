"""Product listing, filtering, hybrid (keyword + semantic) search and facets."""

import math
from statistics import median
from typing import Any

from sqlalchemy import Select, String, and_, cast, func, or_, select
from sqlalchemy.orm import Session

from app.core.cache import cached
from app.core.errors import NotFoundError
from app.core.logging import get_logger
from app.models import Product, Store
from app.schemas.product import ProductDetail, ProductOut, ProductQuery
from app.services.normalization.normalizer import is_generic_brand
from app.services.query_parser import SearchFilters, parse_query
from app.services.vector.store import get_vector_store

log = get_logger(__name__)

MAX_CANDIDATES = 1500


def serialize(p: Product) -> dict[str, Any]:
    return ProductOut.model_validate(p).model_dump(mode="json")


def apply_filters(stmt: Select, q: ProductQuery) -> Select:
    conds = [Product.is_active.is_(True)]
    if q.vertical:
        conds.append(Product.vertical == q.vertical)
    if q.category:
        conds.append(Product.category == q.category)
    if q.gender:
        # "men" should also include unisex items.
        conds.append(Product.gender.in_([q.gender, "unisex"]) if q.gender in {"men", "women"} else Product.gender == q.gender)
    if q.brand:
        conds.append(func.lower(Product.brand_name).in_([b.lower() for b in q.brand]))
    if q.store:
        conds.append(Store.slug.in_(q.store))
    if q.color:
        conds.append(Product.color == q.color.lower())
    if q.fabric:
        conds.append(Product.fabric == q.fabric.lower())
    if q.protein:
        conds.append(Product.attributes["protein"].as_string() == q.protein.lower())
    if q.city:
        # cities is a JSON list; matching the quoted name in its text form works on SQLite and Postgres.
        city = q.city.strip().title().replace('"', "")
        conds.append(Product.store_id.in_(select(Store.id).where(cast(Store.cities, String).like(f'%"{city}"%'))))
    if q.min_price is not None:
        conds.append(Product.price >= q.min_price)
    if q.max_price is not None:
        conds.append(Product.price <= q.max_price)
    if q.on_sale:
        conds.append(Product.discount_percentage > 0)
    if q.min_discount:
        conds.append(Product.discount_percentage >= q.min_discount)
    if q.in_stock is not None:
        conds.append(Product.in_stock.is_(q.in_stock))
    if q.store:
        stmt = stmt.join(Store, Store.id == Product.store_id)
    return stmt.where(and_(*conds))


def apply_sort(stmt: Select, sort: str) -> Select:
    order = {
        "price_asc": [Product.price.asc()],
        "price_desc": [Product.price.desc()],
        "discount": [Product.discount_percentage.desc(), Product.price.asc()],
        "newest": [Product.first_seen_at.desc()],
    }.get(sort, [Product.last_updated.desc()])
    return stmt.order_by(*order, Product.id.desc())


def _page(items: list[dict], total: int, page: int, page_size: int) -> dict[str, Any]:
    return {"items": items, "total": total, "page": page, "page_size": page_size, "pages": max(1, math.ceil(total / page_size))}


@cached("products:list")
def list_products(db: Session, *, query: dict[str, Any]) -> dict[str, Any]:
    q = ProductQuery(**query)
    if q.q:
        return search_products(db, query=query)
    base = apply_filters(select(Product), q)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    if q.sort == "value":
        rows = db.scalars(base.limit(MAX_CANDIDATES)).unique().all()
        ranked = rank_by_value(rows)
        start = (q.page - 1) * q.page_size
        return _page([serialize(p) for p in ranked[start : start + q.page_size]], total, q.page, q.page_size)
    rows = db.scalars(apply_sort(base, q.sort).offset((q.page - 1) * q.page_size).limit(q.page_size)).unique().all()
    return _page([serialize(p) for p in rows], total, q.page, q.page_size)


def get_product(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if not product:
        raise NotFoundError(f"Product {product_id} not found")
    return product


def get_product_detail(db: Session, product_id: int) -> dict[str, Any]:
    product = get_product(db, product_id)
    detail = ProductDetail.model_validate(product)
    prices = [float(h.price) for h in product.price_history] or [float(product.price)]
    detail.lowest_price, detail.highest_price = min(prices), max(prices)
    return detail.model_dump(mode="json")


@cached("brands", ttl=3600)
def known_brands(db: Session) -> list[str]:
    brands = db.scalars(select(Product.brand_name).distinct()).all()
    stores = db.scalars(select(Store.name)).all()
    return sorted({b for b in [*brands, *stores] if b and len(b) > 1 and not is_generic_brand(b)})


def rank_by_value(products: list[Product]) -> list[Product]:
    """Best value = big discount AND cheap relative to similar items."""
    by_cat: dict[str, list[float]] = {}
    for p in products:
        by_cat.setdefault(p.category, []).append(float(p.price))
    medians = {c: median(v) for c, v in by_cat.items()}

    def score(p: Product) -> float:
        med = medians.get(p.category) or float(p.price) or 1
        relative = 1 - float(p.price) / med  # positive when cheaper than median
        return 0.6 * (p.discount_percentage or 0) / 100 + 0.4 * max(-1.0, min(1.0, relative))

    return sorted(products, key=score, reverse=True)


def filters_to_query(f: SearchFilters, overrides: dict[str, Any]) -> ProductQuery:
    data = {
        "vertical": f.vertical,
        "category": f.category,
        "gender": f.gender,
        "brand": [f.brand] if f.brand else None,
        "color": f.color,
        "fabric": f.fabric,
        "protein": f.protein,
        "min_price": f.min_price,
        "max_price": f.max_price,
        "on_sale": f.on_sale,
        "sort": f.sort,
    }
    for key, value in overrides.items():
        if value not in (None, [], "", False) or key in {"page", "page_size"}:
            data[key] = value
    if overrides.get("sort") in (None, "relevance") and f.sort != "relevance":
        data["sort"] = f.sort
    return ProductQuery(**{k: v for k, v in data.items() if k in ProductQuery.model_fields})


def _keyword_condition(keywords: list[str]):
    clauses = []
    for word in keywords[:6]:
        stem = word[:-1] if word.endswith("s") and len(word) > 3 else word
        like = f"%{stem}%"
        clauses.append(or_(Product.product_name.ilike(like), Product.brand_name.ilike(like), Product.description.ilike(like)))
    return or_(*clauses) if clauses else None


def semantic_scores(text: str, q: ProductQuery, k: int = 300) -> dict[int, float]:
    where: dict[str, Any] = {}
    if q.vertical:
        where["vertical"] = q.vertical
    if q.category:
        where["category"] = q.category
    price: dict[str, float] = {}
    if q.min_price is not None:
        price["$gte"] = float(q.min_price)
    if q.max_price is not None:
        price["$lte"] = float(q.max_price)
    if price:
        where["price"] = price
    try:
        hits = get_vector_store().query(text, k=k, where=where or None)
    except Exception as exc:  # noqa: BLE001 - search must degrade, not fail
        log.warning("Semantic search unavailable: %s", exc)
        return {}
    return {h.product_id: h.score for h in hits}


@cached("products:search")
def search_products(db: Session, *, query: dict[str, Any]) -> dict[str, Any]:
    raw_q = (query.get("q") or "").strip()
    parsed = parse_query(raw_q, known_brands(db))
    q = filters_to_query(parsed, {k: v for k, v in query.items() if k != "q"})

    # Remove words already captured as structured filters to avoid double-filtering.
    consumed = {x for x in (parsed.category, parsed.color, parsed.fabric, parsed.gender, parsed.protein) if x}
    consumed |= set(parsed.consumed_words)
    consumed |= {w for x in consumed for w in x.split("-")}
    if parsed.brand:
        consumed |= set(parsed.brand.lower().split())
    keywords = [w for w in parsed.keywords if w not in consumed and w.rstrip("s") not in consumed]

    sem = semantic_scores(raw_q, q) if raw_q else {}
    base = apply_filters(select(Product), q)
    kw_cond = _keyword_condition(keywords)
    if kw_cond is not None:
        cond = or_(kw_cond, Product.id.in_(list(sem))) if sem else kw_cond
        base = base.where(cond)
    rows = db.scalars(base.limit(MAX_CANDIDATES)).unique().all()

    def relevance(p: Product) -> float:
        name = p.product_name.lower()
        kw_hits = sum(1 for w in keywords if w in name or w in p.brand_name.lower())
        return sem.get(p.id, 0.0) + 0.25 * kw_hits

    if q.sort == "value":
        rows = rank_by_value(list(rows))
    elif q.sort == "relevance" or q.sort not in {"price_asc", "price_desc", "discount", "newest"}:
        rows = sorted(rows, key=relevance, reverse=True)
    else:
        key = {
            "price_asc": lambda p: float(p.price),
            "price_desc": lambda p: -float(p.price),
            "discount": lambda p: (-(p.discount_percentage or 0), float(p.price)),
            "newest": lambda p: -p.first_seen_at.timestamp(),
        }[q.sort]
        rows = sorted(rows, key=key)

    total = len(rows)
    start = (q.page - 1) * q.page_size
    result = _page([serialize(p) for p in rows[start : start + q.page_size]], total, q.page, q.page_size)
    result.update({"query": raw_q, "parsed_filters": {**parsed.as_dict(), "keywords": keywords}, "semantic": bool(sem)})
    return result


@cached("facets", ttl=900)
def _city_counts(db: Session) -> list[dict[str, Any]]:
    counter: dict[str, int] = {}
    for store in db.scalars(select(Store).where(Store.is_active.is_(True))):
        for city in store.cities or []:
            counter[city] = counter.get(city, 0) + 1
    return [{"value": c, "count": n} for c, n in sorted(counter.items(), key=lambda x: -x[1])]


def facets(db: Session, *, vertical: str | None = None) -> dict[str, Any]:
    base = [Product.is_active.is_(True)]
    if vertical:
        base.append(Product.vertical == vertical)

    def counts(col, limit: int = 60):
        rows = db.execute(
            select(col, func.count()).where(*base, col.is_not(None)).group_by(col).order_by(func.count().desc()).limit(limit)
        ).all()
        return [{"value": str(v), "count": c} for v, c in rows]

    store_rows = db.execute(
        select(Store.slug, func.count())
        .join(Product, Product.store_id == Store.id)
        .where(*base)
        .group_by(Store.slug)
        .order_by(func.count().desc())
    ).all()
    pmin, pmax = db.execute(select(func.min(Product.price), func.max(Product.price)).where(*base)).one()
    return {
        "verticals": counts(Product.vertical),
        "categories": counts(Product.category),
        "brands": counts(Product.brand_name, 100),
        "stores": [{"value": s, "count": c} for s, c in store_rows],
        "genders": counts(Product.gender),
        "colors": counts(Product.color),
        "proteins": counts(Product.attributes["protein"].as_string()),
        "cities": _city_counts(db),
        "price_min": float(pmin or 0),
        "price_max": float(pmax or 0),
    }
