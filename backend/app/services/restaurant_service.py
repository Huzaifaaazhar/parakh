"""Restaurants, their menus, reviews (with photos/videos), offers and home-page banner ads."""

from __future__ import annotations

import statistics
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError, NotFoundError
from app.db.base import utcnow
from app.models import AdBanner, Product, Review, Store
from app.services.normalization.taxonomy import CATEGORY_LABELS

PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic"}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}
MAX_MEDIA_PER_REVIEW = 6


# ---------------------------------------------------------------- restaurants
def _menu_stats(db: Session, store_ids: list[int]) -> dict[int, dict[str, Any]]:
    stats: dict[int, dict[str, Any]] = {sid: {"prices": [], "dishes": Counter(), "cover": None} for sid in store_ids}
    rows = db.execute(
        select(Product.store_id, Product.price, Product.category, Product.image_url).where(
            Product.store_id.in_(store_ids), Product.is_active.is_(True)
        )
    ).all()
    for sid, price, category, image in rows:
        s = stats[sid]
        s["prices"].append(float(price))
        if category not in {"other", "drink"}:
            s["dishes"][category] += 1
        if image and not s["cover"] and category not in {"drink", "deal"}:
            s["cover"] = image
    reviews = db.execute(
        select(Review.store_id, func.count(Review.id), func.avg(Review.rating))
        .where(Review.store_id.in_(store_ids), Review.is_published.is_(True), Review.source == "parakh")
        .group_by(Review.store_id)
    ).all()
    for sid, n, avg in reviews:
        stats[sid]["review_count"] = n
        stats[sid]["parakh_rating"] = round(float(avg), 1) if avg else None
    all_reviews = db.execute(
        select(Review.store_id, Review.media).where(Review.store_id.in_(store_ids), Review.is_published.is_(True))
    ).all()
    for sid, media in all_reviews:
        stats[sid]["media_count"] = stats[sid].get("media_count", 0) + len(media or [])
        stats[sid]["all_reviews"] = stats[sid].get("all_reviews", 0) + 1
    return stats


def summarize(store: Store, s: dict[str, Any]) -> dict[str, Any]:
    prices = s.get("prices") or []
    return {
        **{
            c: getattr(store, c)
            for c in (
                "id",
                "slug",
                "name",
                "website",
                "platform",
                "verticals",
                "logo_url",
                "last_scraped_at",
                "cuisines",
                "cities",
                "offers",
                "rating",
                "rating_count",
                "price_level",
                "address",
                "maps_url",
            )
        },
        "menu_items": len(prices),
        "dishes": [CATEGORY_LABELS.get(c, c) for c, _ in s.get("dishes", Counter()).most_common(5)],
        "min_price": min(prices) if prices else None,
        "median_price": round(statistics.median(prices)) if prices else None,
        "cover_image": s.get("cover"),
        "review_count": s.get("all_reviews", 0),
        "parakh_rating": s.get("parakh_rating"),
        "media_count": s.get("media_count", 0),
    }


def list_restaurants(db: Session, *, city: str | None = None, cuisine: str | None = None, q: str | None = None) -> list[dict]:
    stores = list(db.scalars(select(Store).where(Store.is_active.is_(True)).order_by(Store.name)))
    if city:
        stores = [s for s in stores if city.lower() in [c.lower() for c in (s.cities or [])]]
    if cuisine:
        stores = [s for s in stores if cuisine.lower() in [c.lower() for c in (s.cuisines or [])]]
    if q:
        stores = [s for s in stores if q.lower() in s.name.lower()]
    stats = _menu_stats(db, [s.id for s in stores]) if stores else {}
    out = [summarize(s, stats[s.id]) for s in stores]
    return [r for r in out if r["menu_items"]]


def get_store(db: Session, slug: str) -> Store:
    store = db.scalar(select(Store).where(Store.slug == slug))
    if not store:
        raise NotFoundError(f"Restaurant '{slug}' not found")
    return store


_ACRONYMS = {"BBQ", "XL", "XXL", "KFC", "OPTP", "BOGO", "PK", "2PC", "3PC"}


def _section_name(name: str) -> str:
    """'CLASSIC BURGERS' -> 'Classic Burgers', but keep short acronyms: 'BBQ', 'BBQ BOTI' -> 'BBQ Boti'."""
    name = name.strip().rstrip(".")
    if not name.isupper():
        return name
    return " ".join(w if w in _ACRONYMS else w.capitalize() for w in name.split())


def restaurant_detail(db: Session, slug: str) -> dict[str, Any]:
    from app.services.product_service import serialize

    store = get_store(db, slug)
    stats = _menu_stats(db, [store.id])[store.id]
    items = db.scalars(select(Product).where(Product.store_id == store.id, Product.is_active.is_(True)).order_by(Product.id)).unique().all()
    sections: dict[str, list] = {}
    for p in items:
        name = (p.attributes or {}).get("menu_section") or CATEGORY_LABELS.get(p.category, "More")
        sections.setdefault(_section_name(name), []).append(serialize(p))
    reviews = list_reviews(db, store_id=store.id, limit=30)
    breakdown = Counter(str(round(r["rating"])) for r in reviews)
    return {
        "restaurant": summarize(store, stats),
        "sections": [{"name": k, "items": v} for k, v in sections.items()],
        "reviews": reviews,
        "rating_breakdown": {k: breakdown.get(k, 0) for k in ("5", "4", "3", "2", "1")},
    }


# ---------------------------------------------------------------- reviews
def review_out(r: Review) -> dict[str, Any]:
    return {
        "id": r.id,
        "store_id": r.store_id,
        "restaurant_name": r.store.name if r.store else None,
        "restaurant_slug": r.store.slug if r.store else None,
        "product_id": r.product_id,
        "dish_name": r.product.product_name if r.product else None,
        "source": r.source,
        "author_name": r.author_name,
        "author_url": r.author_url,
        "author_photo": r.author_photo,
        "rating": r.rating,
        "text": r.text,
        "media": r.media or [],
        "visited_branch": r.visited_branch,
        "verified": r.verified,
        "helpful": r.helpful,
        "created_at": r.created_at,
    }


def list_reviews(
    db: Session,
    *,
    store_id: int | None = None,
    product_id: int | None = None,
    with_media: bool = False,
    source: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    stmt = select(Review).where(Review.is_published.is_(True))
    if store_id:
        stmt = stmt.where(Review.store_id == store_id)
    if product_id:
        stmt = stmt.where(Review.product_id == product_id)
    if source:
        stmt = stmt.where(Review.source == source)
    rows = db.scalars(stmt.order_by(Review.created_at.desc()).limit(500 if with_media else limit)).unique().all()
    if with_media:
        rows = [r for r in rows if r.media][:limit]
    return [review_out(r) for r in rows]


def save_media(upload_name: str, content_type: str, data: bytes) -> dict[str, str]:
    """Store one uploaded photo/video and return its media entry."""
    ext = PHOTO_TYPES.get(content_type) or VIDEO_TYPES.get(content_type)
    if not ext:
        raise AppError(f"{upload_name}: only JPG, PNG, WebP, HEIC photos and MP4, WebM, MOV videos are accepted")
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise AppError(f"{upload_name}: files must be under {settings.max_upload_mb} MB")
    folder = Path(settings.media_dir) / "reviews"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    (folder / name).write_bytes(data)
    return {"type": "video" if content_type in VIDEO_TYPES else "photo", "url": f"{settings.media_url_prefix}/reviews/{name}"}


def create_review(
    db: Session,
    *,
    slug: str,
    user: Any,
    rating: float,
    text: str | None,
    product_id: int | None,
    visited_branch: str | None,
    media: list[dict[str, str]],
) -> dict[str, Any]:
    store = get_store(db, slug)
    if not 1 <= rating <= 5:
        raise AppError("Rating must be between 1 and 5")
    if not (text and text.strip()) and not media:
        raise AppError("Write a few words or add a photo or video")
    if len(media) > MAX_MEDIA_PER_REVIEW:
        raise AppError(f"Up to {MAX_MEDIA_PER_REVIEW} photos or videos per review")
    if product_id:
        product = db.get(Product, product_id)
        if not product or product.store_id != store.id:
            raise AppError("That dish isn't on this restaurant's menu")
    review = Review(
        store_id=store.id,
        product_id=product_id,
        user_id=user.id,
        source="parakh",
        author_name=user.name or user.email.split("@")[0],
        rating=float(rating),
        text=(text or "").strip()[:4000] or None,
        media=media,
        visited_branch=(visited_branch or "").strip()[:200] or None,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review_out(review)


# ---------------------------------------------------------------- offers / deals
def offers(db: Session, *, city: str | None = None, limit: int = 24) -> dict[str, Any]:
    from app.services.product_service import serialize

    rests = {r["id"]: r for r in list_restaurants(db, city=city)}
    restaurant_offers = [{"restaurant": r, "offer": o} for r in rests.values() for o in (r.get("offers") or [])]
    restaurant_offers.sort(key=lambda x: -(x["offer"].get("percent") or 0))
    base = select(Product).where(Product.is_active.is_(True), Product.store_id.in_(list(rests) or [-1]))
    deals = db.scalars(base.where(Product.category == "deal").limit(600)).unique().all()
    # Best value first: price per item in the box when we can count them, else plain price.
    deals = sorted(deals, key=lambda p: float(p.price) / max((p.attributes or {}).get("deal_parts") or 1, 1))
    discounted = (
        db.scalars(base.where(Product.discount_percentage > 0).order_by(Product.discount_percentage.desc()).limit(limit)).unique().all()
    )
    return {
        "restaurant_offers": restaurant_offers,
        "deal_items": [serialize(p) for p in deals[:limit]],
        "discounted": [serialize(p) for p in discounted],
    }


# ---------------------------------------------------------------- banner ads
def banner_out(b: AdBanner) -> dict[str, Any]:
    return {
        "id": b.id,
        "kind": b.kind,
        "eyebrow": b.eyebrow,
        "title": b.title,
        "subtitle": b.subtitle,
        "image_url": b.image_url,
        "video_url": b.video_url,
        "cta_label": b.cta_label,
        "link_url": b.link_url,
        "restaurant_slug": b.store.slug if b.store else None,
        "restaurant_name": b.store.name if b.store else None,
    }


def active_banners(db: Session, now: datetime | None = None, limit: int = 6) -> list[dict[str, Any]]:
    now = now or utcnow()
    stmt = (
        select(AdBanner)
        .where(
            AdBanner.is_active.is_(True),
            or_(AdBanner.starts_at.is_(None), AdBanner.starts_at <= now),
            or_(AdBanner.ends_at.is_(None), AdBanner.ends_at > now),
        )
        # Paid placements first, then our own featured picks.
        .order_by((AdBanner.kind == "sponsored").desc(), AdBanner.priority.desc(), AdBanner.id.desc())
        .limit(limit)
    )
    return [banner_out(b) for b in db.scalars(stmt).unique()]


def upsert_banner(db: Session, data: dict[str, Any], banner_id: int | None = None) -> dict[str, Any]:
    banner = db.get(AdBanner, banner_id) if banner_id else AdBanner()
    if banner is None:
        raise NotFoundError("Banner not found")
    slug = data.pop("store_slug", None)
    if slug:
        banner.store_id = get_store(db, slug).id
    for k, v in data.items():
        setattr(banner, k, v)
    if banner.starts_at and banner.ends_at and banner.ends_at <= banner.starts_at:
        raise AppError("ends_at must be after starts_at")
    db.add(banner)
    db.commit()
    db.refresh(banner)
    return banner_out(banner)


def record_banner_click(db: Session, banner_id: int) -> None:
    banner = db.get(AdBanner, banner_id)
    if banner:
        banner.clicks = (banner.clicks or 0) + 1
        db.commit()


__all__ = [
    "active_banners",
    "create_review",
    "list_restaurants",
    "list_reviews",
    "offers",
    "record_banner_click",
    "restaurant_detail",
    "save_media",
    "upsert_banner",
]
