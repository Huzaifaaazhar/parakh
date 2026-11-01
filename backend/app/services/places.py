"""Google Places API (New) integration: ratings, address, Google reviews, and restaurant discovery.

Uses the official API only (https://developers.google.com/maps/documentation/places/web-service),
never scraped Google Maps pages. Needs GOOGLE_MAPS_API_KEY with the Places API (New) enabled.

Google's terms we follow:
- place IDs may be stored indefinitely; other place content is refreshed on every sync;
- at most the five reviews the API returns, shown unedited with the author's name/link;
- the UI shows "Google" attribution next to anything that came from here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.db.base import utcnow
from app.models import Review, Store

log = get_logger(__name__)

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELDS = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.priceLevel",
    "places.googleMapsUri",
    "places.websiteUri",
    "places.location",
    "places.nationalPhoneNumber",
    "places.primaryType",
    "places.reviews",
]
PRICE_LEVELS = {
    "PRICE_LEVEL_INEXPENSIVE": "Rs",
    "PRICE_LEVEL_MODERATE": "Rs Rs",
    "PRICE_LEVEL_EXPENSIVE": "Rs Rs Rs",
    "PRICE_LEVEL_VERY_EXPENSIVE": "Rs Rs Rs Rs",
}


class PlacesNotConfigured(RuntimeError):
    pass


@dataclass
class Place:
    id: str
    name: str
    address: str | None
    rating: float | None
    rating_count: int | None
    price_level: str | None
    maps_url: str | None
    website: str | None
    phone: str | None
    lat: float | None
    lng: float | None
    reviews: list[dict[str, Any]]

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Place:
        loc = raw.get("location") or {}
        return cls(
            id=raw["id"],
            name=(raw.get("displayName") or {}).get("text") or "",
            address=raw.get("formattedAddress"),
            rating=raw.get("rating"),
            rating_count=raw.get("userRatingCount"),
            price_level=PRICE_LEVELS.get(raw.get("priceLevel") or ""),
            maps_url=raw.get("googleMapsUri"),
            website=raw.get("websiteUri"),
            phone=raw.get("nationalPhoneNumber"),
            lat=loc.get("latitude"),
            lng=loc.get("longitude"),
            reviews=raw.get("reviews") or [],
        )


def search(query: str, *, max_results: int = 10, client: httpx.Client | None = None) -> list[Place]:
    key = settings.google_maps_api_key
    if not key:
        raise PlacesNotConfigured("Set GOOGLE_MAPS_API_KEY to use Google Places")
    body = {
        "textQuery": query,
        "languageCode": settings.google_places_language,
        "regionCode": settings.google_places_region,
        "pageSize": max(1, min(max_results, 20)),
        "includedType": "restaurant",
    }
    headers = {"X-Goog-Api-Key": key, "X-Goog-FieldMask": ",".join(FIELDS)}
    http = client or httpx.Client(timeout=20)
    try:
        resp = http.post(SEARCH_URL, json=body, headers=headers)
        resp.raise_for_status()
    finally:
        if client is None:
            http.close()
    return [Place.from_api(p) for p in resp.json().get("places", [])]


def best_match(store: Store, places: list[Place]) -> Place | None:
    """The result named after the restaurant (as whole words), most-reviewed first (usually the flagship branch).

    "Tooso Clifton" matches Tooso; "Toosoon Bakery" does not.
    """
    name = re.sub(r"[^a-z0-9 ]", "", store.name.lower()).strip()
    if not name:
        return None
    pattern = re.compile(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])")
    hits = [p for p in places if pattern.search(re.sub(r"[^a-z0-9 ]", "", p.name.lower()))]
    return max(hits, key=lambda p: p.rating_count or 0, default=None)


def sync_store(db: Session, store: Store, *, client: httpx.Client | None = None) -> bool:
    """Refresh one restaurant's Google facts and its (up to five) Google reviews."""
    city = (store.cities or ["Pakistan"])[0]
    places = search(f"{store.name} restaurant {city}", client=client)
    place = best_match(store, places)
    if not place:
        log.info("[%s] no Google Places match", store.slug)
        return False
    store.google_place_id = place.id
    store.rating, store.rating_count, store.price_level = place.rating, place.rating_count, place.price_level
    store.address, store.phone, store.maps_url = place.address, place.phone, place.maps_url
    store.lat, store.lng = place.lat, place.lng
    store.google_synced_at = utcnow()

    # Replace, never accumulate: Google reviews are shown as the API currently returns them.
    db.execute(delete(Review).where(Review.store_id == store.id, Review.source == "google"))
    for r in place.reviews[:5]:
        author = r.get("authorAttribution") or {}
        text = (r.get("originalText") or r.get("text") or {}).get("text")
        db.add(
            Review(
                store_id=store.id,
                source="google",
                external_id=r.get("name"),
                author_name=author.get("displayName") or "Google user",
                author_url=author.get("uri"),
                author_photo=author.get("photoUri"),
                rating=float(r.get("rating") or 0) or 1.0,
                text=text,
                media=[],
                created_at=_parse_time(r.get("publishTime")) or utcnow(),
            )
        )
    db.flush()
    return True


def _parse_time(value: str | None):
    if not value:
        return None
    from datetime import datetime

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def sync_all(db: Session, slugs: list[str] | None = None) -> dict[str, bool]:
    stmt = select(Store).where(Store.is_active.is_(True))
    if slugs:
        stmt = stmt.where(Store.slug.in_(slugs))
    results = {}
    with httpx.Client(timeout=20) as client:
        for store in db.scalars(stmt):
            try:
                results[store.slug] = sync_store(db, store, client=client)
                db.commit()
            except PlacesNotConfigured:
                raise
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                log.warning("[%s] Places sync failed: %s", store.slug, exc)
                results[store.slug] = False
    return results


def discover(city: str, queries: list[str] | None = None, per_query: int = 20) -> list[Place]:
    """Find restaurants in a city (deduplicated by place id) to grow the restaurant list."""
    queries = queries or ["restaurants", "bbq restaurant", "burger", "pizza", "biryani", "cafe", "karahi", "fast food"]
    found: dict[str, Place] = {}
    with httpx.Client(timeout=20) as client:
        for q in queries:
            for p in search(f"{q} in {city}", max_results=per_query, client=client):
                found.setdefault(p.id, p)
    return sorted(found.values(), key=lambda p: -(p.rating_count or 0))
