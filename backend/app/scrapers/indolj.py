"""Indolj ordering platform (used by Tooso, Burger Lab, California Pizza, Ginsoy, Student Biryani...).

The restaurant's site loads three things we keep:
- StructuredMenu: categories -> items, each with one price per size ("Half"/"Full", "Chicken"/"Beef")
- GetMerchantOffers: restaurant-wide offers ("20% flat on delivery orders")
- GetAreasCityWise: delivery areas, which tell us the cities it serves
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from app.scrapers.base import BaseScraper
from app.scrapers.browser_capture import capture_json
from app.services.normalization.normalizer import RawProduct, clean_text

PATTERNS = {
    "menu": r"WebApiV2/StructuredMenu",
    "offers": r"WebApiV2/GetMerchantOffers",
    "areas": r"WebApiV2/GetAreasCityWise",
}


def _num(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def parse_offer(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Turn one Indolj offer row into our restaurant-offer shape."""
    if not raw or str(raw.get("active", "1")) != "1" or raw.get("current_status", "active") != "active":
        return None
    pct = _num(raw.get("offer_percentage"))
    flat = _num(raw.get("offer_price")) if raw.get("discount_type") != "percentage" else None
    if not pct and not flat:
        return None
    channels = []
    try:
        channels = json.loads(raw.get("trans_type") or "[]")
    except (TypeError, ValueError):
        pass
    headline = f"{pct:g}% off" if pct else f"Rs {flat:,.0f} off"
    return {
        "id": str(raw.get("offers_id") or headline),
        "title": headline,
        "detail": clean_text(raw.get("custom_msg"), 200) or "On the whole menu",
        "percent": pct,
        "amount": flat,
        "max_discount": _num(raw.get("max_offer_price")),
        "channels": channels,
        "valid_from": raw.get("valid_from"),
        "valid_to": raw.get("valid_to"),
        "hours": [raw.get("offer_from"), raw.get("offer_to")],
    }


def parse_cities(areas_payload: Any) -> tuple[list[str], int]:
    details = (areas_payload or {}).get("details") or {}
    areas = details.get("areas") or {}
    cities: set[str] = set()
    count = 0
    for rows in areas.values() if isinstance(areas, dict) else []:
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            count += 1
            if row.get("city_name"):
                cities.add(row["city_name"].strip().title())
    return sorted(cities), count


def iter_menu(menu_payload: Any, base_url: str) -> Iterator[RawProduct]:
    details = (menu_payload or {}).get("details") or {}
    for cat in details.values() if isinstance(details, dict) else []:
        if not isinstance(cat, dict):
            continue
        cat_name = clean_text(cat.get("title")) or ""
        if cat_name.lower() in {"popular items", "new arrival", "new arrivals", "best sellers"}:
            continue  # duplicates of items listed under their real category
        detail = cat.get("categoryDetail") if isinstance(cat.get("categoryDetail"), dict) else {}
        if str(detail.get("out_of_stock", "False")).lower() == "true":
            continue
        items = cat.get("items") or {}
        for item in items.values() if isinstance(items, dict) else []:
            if not isinstance(item, dict):
                continue
            name = clean_text(item.get("item_name"))
            if not name:
                continue
            prices = [p for p in (item.get("prices") or []) if isinstance(p, dict)]
            sized = [p for p in prices if (p.get("size") or "").strip()]
            image = item.get("item_photo_webp") or item.get("photo")
            if image and "placholde" in image:
                image = None
            url = f"{base_url.rstrip('/')}/product/{item.get('item_slug') or item.get('item_id')}-{item.get('item_id')}"
            for p in prices:
                price = _num(p.get("price"))
                if not price:
                    continue
                size = (p.get("size") or "").strip()
                discounted = _num(p.get("discounted_price"))
                title = f"{name} ({size})" if size and len(sized) > 1 else (f"{name} {size}" if size else name)
                yield RawProduct(
                    external_id=f"{item.get('item_id')}-{p.get('size_id') or 0}",
                    title=title,
                    url=url,
                    price=discounted if discounted and discounted < price else price,
                    original_price=price,
                    description=item.get("item_description"),
                    product_type=cat_name,
                    tags=[cat_name] + ([size] if size else []),
                    image_url=image,
                    in_stock=True,
                    extra={"menu_section": cat_name, "size": size or None, "item_id": item.get("item_id")},
                )


class IndoljScraper(BaseScraper):
    def iter_products(self) -> Iterator[RawProduct]:
        cap = capture_json(self.config.website, PATTERNS)
        menu = cap.first("menu")
        if not menu or not menu.get("details"):
            raise RuntimeError(f"No menu captured from {self.config.website}")
        offers = []
        for resp in cap.responses.get("offers", []):
            details = (resp or {}).get("details") if isinstance(resp, dict) else None
            for row in details if isinstance(details, list) else [details]:
                if isinstance(row, dict) and (offer := parse_offer(row)):
                    offers.append(offer)
        cities, area_count = parse_cities(cap.first("areas"))
        self.meta.update({"offers": offers, "cities": cities or self.config.extra.get("cities", []), "delivery_areas": area_count})
        yield from iter_menu(menu, self.config.website)
        self.complete = True
