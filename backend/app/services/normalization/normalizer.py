"""Turn a raw scraped menu item into a clean, comparable dish record."""

import hashlib
import html
import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.services.normalization.taxonomy import detect_category, detect_gender, detect_portion, detect_protein

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


_JUNK_BRANDS = {
    "default",
    "vendor",
    "my store",
    "pret",
    "unstitched",
    "stitched",
    "sale",
    "new",
    "new arrivals",
    "eid",
    "winter",
    "summer",
    "essentials",
}


_SEASON_CODE_RE = re.compile(r"^[A-Za-z]{1,4}[_\- ]?\d{2,4}$")


def is_generic_brand(brand: str | None) -> bool:
    """Shopify "vendor" is often a section name ("Men", "Bags", "Pret") rather than a brand."""
    if not brand or len(brand) > 60:
        return True
    lower = brand.lower().strip()
    if _SEASON_CODE_RE.match(brand.strip()):  # "WN_26", "SU-25", "FW2024"
        return True
    if lower in _JUNK_BRANDS or detect_gender(lower) or detect_category(lower)[1] != "other":
        return True
    return False


def compute_discount(price: float, original: float) -> float:
    if original and original > price > 0:
        return round((original - price) / original * 100, 1)
    return 0.0


def normalize(
    raw: RawProduct,
    *,
    store_name: str,
    allowed_verticals: list[str] | None = None,
    default_gender: str | None = None,
    cuisines: list[str] | None = None,
) -> dict[str, Any] | None:
    """Return a dict ready for the Product model, or None if the record is unusable."""
    price = parse_price(raw.price)
    if price is None or price <= 0:
        return None
    original = parse_price(raw.original_price) or price
    if original < price:  # some stores send compare_at < price, or 0
        original = price

    title = clean_title(raw.title)
    description = clean_text(raw.description, limit=4000)
    section = clean_text(raw.extra.get("menu_section") or raw.product_type, 80)
    size_label = clean_text(raw.extra.get("size"), 60)
    # Title first; the menu section ("BBQ", "CLASSIC BURGERS") rescues vague names like "Tooso Special";
    # the description is last because deal descriptions list every item in the box.
    vertical, category = detect_category(title, section, description, allowed=allowed_verticals or ["food"])
    if category != "deal" and re.search(r"(?<![a-z])(deal|combo|platter|bucket|meal)(?![a-z])", section or "", re.I):
        category = "deal"
    # Extras and sauces: anything in an "Add Ons"/"Dips" section, a bare "... Sauce", or "Extra X" when X
    # isn't itself a dish ("Extra Olives" is an add-on, "Extra Cheese Pizza" is a pizza).
    addon_section = re.search(r"(?<![a-z])(extras?|add[- ]?ons?|dips?|sauces?|toppings?)(?![a-z])", section or "", re.I)
    addon_title = re.fullmatch(r"[\w &'.-]{0,30}\b(sauce|dip|mayo)\.?", title, re.I) or (
        re.match(r"(extra|add[- ]?on)\b", title, re.I) and detect_category(title)[1] == "other"
    )
    if addon_section or addon_title:
        category = "add-on"

    # A pizza place names its pizzas by flavour ("Afghani (Large)"); a mandi house its mandi by meat.
    # Pizza places name pizzas after toppings ("Creamy Tikka (Large)"), so a sized topping-named item is a pizza there.
    pizza_toppings = {"other", "tikka", "boti", "kabab", "bbq-platter", "chargha", "steak", "seafood", "salad", "daal-veg"}
    if cuisines and category in pizza_toppings:
        hint = next((c for c in ("pizza", "mandi") if c in cuisines), None)
        sized = detect_portion(f"{title} {size_label or ''}")
        if hint == "pizza" and (sized.get("inches") or sized.get("size") or re.search(r"crust|flavou?r", f"{title} {section}", re.I)):
            category = "pizza"
        elif hint == "mandi" and category == "other" and re.search(r"mutton|chicken|beef|lamb|family", title, re.I):
            category = "mandi"

    attributes: dict[str, Any] = {}
    protein = detect_protein(title, size_label) or detect_protein(section)
    if protein and category not in {"drink", "shake", "chai-coffee", "dessert", "ice-cream", "fries", "bread"}:
        attributes["protein"] = protein
    portion = {**detect_portion(description if category == "deal" else None), **detect_portion(title), **detect_portion(size_label)}
    attributes.update(portion)
    if category == "deal" and description:
        # "1 Club Sandwich + 4 Pcs Crispy Chicken + 5 Drinks" -> 3 parts
        parts = [p for p in re.split(r"\s*(?:\+|,|&|\band\b)\s*", description) if len(p.strip()) > 2]
        attributes["deal_parts"] = len(parts)
    if cut := re.search(r"(?<![a-z])(leg|chest|thigh|breast|boneless)(?![a-z])", f"{title} {size_label or ''}", re.I):
        attributes["cut"] = cut.group(1).lower()
    if section:
        attributes["menu_section"] = section
    if size_label:
        attributes["size_label"] = size_label
    gender = None

    brand = clean_text(raw.brand, 160) or store_name
    if is_generic_brand(brand):
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
        "fabric": None,
        "color": None,
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
