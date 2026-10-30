"""Turn a raw scraped record into a clean, comparable product dict."""

import hashlib
import html
import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.services.normalization.taxonomy import detect_category, detect_color, detect_fabric, detect_gender

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_PRICE_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
# Strip SKU-ish noise like "(WU3PSSW26R9O10)" or "- AL-T-856" from titles before display/embedding.
_SKU_RE = re.compile(r"\s*[\(\[]?\b(?=[A-Z0-9-]*\d)[A-Z0-9]{2,}(?:-[A-Z0-9]+){1,}\b[\)\]]?|\s*\((?=[A-Z0-9]*\d)[A-Z0-9]{6,}\)")

_SPEC_PATTERNS = {
    "ram": re.compile(r"(\d{1,2})\s?GB\s?(?:RAM)\b|(\d{1,2})\s?GB\s?/\s?\d{2,4}\s?GB", re.I),
    "storage": re.compile(r"(\d{2,4})\s?(GB|TB)\s?(?:ROM|storage|SSD|HDD)?\b(?!\s?RAM)", re.I),
    "battery_mah": re.compile(r"(\d{3,5})\s?mAh", re.I),
    "screen_inches": re.compile(r"(\d{1,2}(?:\.\d)?)\s?(?:\"|inch|inches|”)", re.I),
    "wattage": re.compile(r"(\d{1,4})\s?W\b"),
    "volume_ml": re.compile(r"(\d{1,4})\s?ml\b", re.I),
    "pieces": re.compile(r"(\d)\s?(?:pc|pcs|piece)\b", re.I),
}


@dataclass
class RawProduct:
    """Store-agnostic shape every scraper adapter produces."""

    external_id: str
    title: str
    url: str
    price: Any
    original_price: Any = None
    brand: str | None = None
    description: str | None = None
    product_type: str | None = None
    tags: list[str] = field(default_factory=list)
    image_url: str | None = None
    in_stock: bool = True
    options: dict[str, list[str]] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)


def clean_text(value: str | None, limit: int | None = None) -> str | None:
    if not value:
        return None
    text = html.unescape(_TAG_RE.sub(" ", value))
    text = _WS_RE.sub(" ", text).strip()
    if limit and len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text or None


def clean_title(title: str) -> str:
    title = clean_text(title) or ""
    stripped = _SKU_RE.sub("", title).strip(" -|")
    return stripped if len(stripped) >= 3 else title


def parse_price(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, int | float):
        return float(value) if value >= 0 else None
    match = _PRICE_RE.search(str(value).replace("Rs", "").replace("PKR", ""))
    if not match:
        return None
    raw = match.group(0).replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


def extract_specs(text: str) -> dict[str, Any]:
    specs: dict[str, Any] = {}
    for key, pattern in _SPEC_PATTERNS.items():
        m = pattern.search(text)
        if not m:
            continue
        groups = [g for g in m.groups() if g]
        if key == "storage" and len(groups) >= 2:
            specs[key] = f"{groups[0]}{groups[1].upper()}"
        elif key in {"ram"}:
            specs[key] = f"{groups[0]}GB"
        else:
            specs[key] = groups[0]
    return specs


def compute_discount(price: float, original: float) -> float:
    if original and original > price > 0:
        return round((original - price) / original * 100, 1)
    return 0.0


def normalize(raw: RawProduct, *, store_name: str, allowed_verticals: list[str] | None = None) -> dict[str, Any] | None:
    """Return a dict ready for the Product model, or None if the record is unusable."""
    price = parse_price(raw.price)
    if price is None or price <= 0:
        return None
    original = parse_price(raw.original_price) or price
    if original < price:  # some stores send compare_at < price, or 0
        original = price

    title = clean_title(raw.title)
    description = clean_text(raw.description, limit=4000)
    tags_text = " ".join(raw.tags)
    option_text = " ".join(" ".join(v) for v in raw.options.values())

    vertical, category = detect_category(title, raw.product_type, tags_text, description, allowed=allowed_verticals)
    if category == "other" and allowed_verticals:
        # The store sells something outside its declared verticals; trust the title.
        alt_vertical, alt_category = detect_category(title, raw.product_type, tags_text)
        if alt_category != "other":
            vertical, category = alt_vertical, alt_category

    gender = None
    if vertical in {"fashion", "beauty"}:
        gender = detect_gender(title, raw.product_type, tags_text, raw.url) or None

    attributes: dict[str, Any] = {}
    if vertical == "electronics":
        attributes.update(extract_specs(f"{title} {option_text} {description or ''}"))
    else:
        specs = extract_specs(title)
        attributes.update({k: v for k, v in specs.items() if k in {"pieces", "volume_ml"}})
    if raw.options:
        attributes["options"] = {k: v[:20] for k, v in raw.options.items()}
    if raw.product_type:
        attributes["source_type"] = clean_text(raw.product_type, 80)

    brand = clean_text(raw.brand, 160) or store_name
    # Shopify "vendor" is often the store itself, a warehouse code, or junk.
    if not brand or len(brand) > 60 or brand.lower() in {"default", "vendor", "my store"}:
        brand = store_name

    record = {
        "external_id": str(raw.external_id),
        "brand_name": brand,
        "product_name": title[:500],
        "description": description,
        "vertical": vertical,
        "category": category,
        "gender": gender,
        "price": round(price, 2),
        "original_price": round(original, 2),
        "discount_percentage": compute_discount(price, original),
        "currency": "PKR",
        "fabric": detect_fabric(title, tags_text, description) if vertical in {"fashion", "home"} else None,
        "color": detect_color(title, option_text, tags_text),
        "attributes": attributes,
        "tags": [t for t in (clean_text(t, 60) for t in raw.tags[:30]) if t],
        "image_url": raw.image_url,
        "product_url": raw.url,
        "in_stock": bool(raw.in_stock),
    }
    record["content_hash"] = hashlib.sha256(
        json.dumps({k: record[k] for k in ("product_name", "description", "category", "color", "fabric")}, sort_keys=True).encode()
    ).hexdigest()
    return record


def embedding_text(p: Any) -> str:
    """Text used to embed a product: name + category + key attributes + description."""
    get = (lambda k: p.get(k)) if isinstance(p, dict) else (lambda k: getattr(p, k, None))
    parts = [
        get("product_name"),
        f"{get('gender') or ''} {get('category')} {get('vertical')}".strip(),
        get("brand_name"),
        get("color"),
        get("fabric"),
    ]
    attrs = get("attributes") or {}
    parts.extend(f"{k} {v}" for k, v in attrs.items() if k not in {"options", "source_type"} and isinstance(v, str | int | float))
    desc = get("description")
    if desc:
        parts.append(desc[:400])
    return " | ".join(str(x) for x in parts if x)
