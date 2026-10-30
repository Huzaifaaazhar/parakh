"""Cross-store comparison: similar items, cheaper alternatives, same product elsewhere.

Similarity blends:
- semantic similarity from the vector store (name/category/description),
- attribute overlap (category, gender, colour, fabric, specs),
- title token overlap (catches the *same* model sold by different shops),
- price proximity (a 50k phone isn't a great "alternative" to a 5k one).
"""

import re
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.cache import cached
from app.core.errors import AppError
from app.models import Product
from app.services.normalization.normalizer import embedding_text
from app.services.product_service import get_product, serialize
from app.services.vector.store import get_vector_store

_TOKEN = re.compile(r"[a-z0-9]+")
_NOISE = {"the", "and", "with", "for", "new", "pc", "pcs", "piece", "men", "women", "kids", "boys", "girls"}
_SPEC_KEYS = ("ram", "storage", "battery_mah", "screen_inches", "wattage", "volume_ml", "pieces")


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN.findall(text.lower()) if t not in _NOISE and len(t) > 1}


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _audience_weight(base: Product, other: Product) -> float | None:
    """How compatible two items' audiences are: None = never compare, else a score multiplier.

    Children's items only ever match children's items. Men vs women never match
    (unisex matches both). An unknown audience is allowed against adult items but
    ranked below confirmed matches.
    """
    a, b = base.gender, other.gender
    if "kids" in (a, b):
        return 1.0 if a == b else None
    if a and b:
        return 1.0 if a == b or "unisex" in (a, b) else None
    if base.vertical != "fashion":
        return 1.0
    return 0.85


def _price_band(base: Product) -> tuple[float, float]:
    # Clothing alternatives should be in a realistic price range; gadgets vary more.
    return (0.4, 2.5) if base.vertical == "fashion" else (0.3, 3.0)


def _features(base: Product, other: Product) -> tuple[float, list[str], list[str]]:
    shared, diffs = [], []
    score = 0.0
    if base.category == other.category and base.category != "other":
        score += 0.3
        shared.append(f"Same category: {base.category}")
    if base.gender and base.gender == other.gender:
        score += 0.1
        shared.append(f"For {base.gender}")
    for attr, label, weight in (("color", "Colour", 0.15), ("fabric", "Fabric", 0.15)):
        a, b = getattr(base, attr), getattr(other, attr)
        if a and b:
            if a == b:
                score += weight
                shared.append(f"{label}: {a}")
            else:
                diffs.append(f"{label}: {b} vs {a}")
    battrs, oattrs = base.attributes or {}, other.attributes or {}
    for key in _SPEC_KEYS:
        if key in battrs and key in oattrs:
            if str(battrs[key]).lower() == str(oattrs[key]).lower():
                score += 0.05
                shared.append(f"{key.replace('_', ' ')}: {battrs[key]}")
            else:
                diffs.append(f"{key.replace('_', ' ')}: {oattrs[key]} vs {battrs[key]}")
    if base.brand_name.lower() != other.brand_name.lower():
        diffs.append(f"Brand: {other.brand_name}")
    if other.discount_percentage:
        shared_or_diff = f"On sale: {other.discount_percentage:.0f}% off"
        diffs.append(shared_or_diff)
    return min(score, 1.0), shared, diffs


def _candidates(db: Session, base: Product, k: int) -> dict[int, float]:
    where: dict[str, Any] = {"vertical": base.vertical, "in_stock": True}
    if base.category != "other":
        where["category"] = base.category
    # Keep children's and adult items in separate pools from the start, so the
    # candidate limit isn't spent on items that can never match.
    where["gender"] = "kids" if base.gender == "kids" else {"$ne": "kids"}
    try:
        hits = get_vector_store().query_by_id(base.id, embedding_text(base), k=k, where=where)
        sem = {h.product_id: max(0.0, h.score) for h in hits}
    except Exception:  # noqa: BLE001
        sem = {}
    # Always add a structured candidate pool so comparison works without a vector index.
    price = float(base.price)
    lo, hi = _price_band(base)
    stmt = select(Product.id).where(
        Product.is_active.is_(True),
        Product.in_stock.is_(True),
        Product.vertical == base.vertical,
        Product.id != base.id,
        Product.price.between(price * lo, price * hi),
        Product.gender == "kids" if base.gender == "kids" else or_(Product.gender.is_(None), Product.gender != "kids"),
    )
    if base.category != "other":
        stmt = stmt.where(Product.category == base.category)
    for pid in db.scalars(stmt.order_by(func.abs(Product.price - price)).limit(400)):
        sem.setdefault(pid, 0.0)
    return sem


@cached("compare:alternatives")
def find_alternatives(
    db: Session, *, product_id: int, limit: int = 12, cheaper_only: bool = False, other_brands_only: bool = True
) -> dict[str, Any]:
    base = get_product(db, product_id)
    sem = _candidates(db, base, k=max(60, limit * 6))
    if not sem:
        return {
            "base": serialize(base),
            "alternatives": [],
            "cheapest": None,
            "best_value": None,
            "summary": "No comparable products found yet.",
        }

    others = db.scalars(select(Product).where(Product.id.in_(list(sem)))).unique().all()
    base_tokens = _tokens(base.product_name)
    base_price = float(base.price)
    scored = []
    lo, hi = _price_band(base)
    for other in others:
        audience = _audience_weight(base, other)
        if audience is None:
            continue
        price = float(other.price)
        if base_price and not lo <= price / base_price <= hi:
            continue
        same_store = other.store_id == base.store_id
        title_sim = _jaccard(base_tokens, _tokens(other.product_name))
        same_brand = other.brand_name.lower() == base.brand_name.lower()
        same_color = not base.color or not other.color or base.color == other.color
        same_product = same_brand and not same_store and same_color and title_sim >= 0.7
        if other_brands_only and same_store:
            continue
        attr_score, shared, diffs = _features(base, other)
        ratio = min(price, base_price) / max(price, base_price) if price and base_price else 0
        similarity = 0.45 * sem.get(other.id, 0.0) + 0.25 * attr_score + 0.2 * title_sim + 0.1 * ratio
        similarity *= audience
        if same_product:
            similarity = max(similarity, 0.9)
        diff = round(price - base_price, 2)
        if cheaper_only and diff >= 0:
            continue
        scored.append(
            {
                "product": other,
                "similarity": round(min(similarity, 1.0), 3),
                "match_type": "same_product" if same_product else "similar",
                "price_difference": diff,
                "price_difference_pct": round(diff / base_price * 100, 1) if base_price else 0.0,
                "is_cheaper": diff < 0,
                "shared_features": shared,
                "differences": diffs,
            }
        )

    scored.sort(key=lambda a: (a["match_type"] != "same_product", -a["similarity"]))
    top = scored[:limit]
    cheapest = min(top, key=lambda a: float(a["product"].price), default=None)
    # Best value: similar enough (>= 0.35) and cheapest per unit of similarity.
    good = [a for a in top if a["similarity"] >= 0.35] or top
    best_value = min(good, key=lambda a: float(a["product"].price) / max(a["similarity"], 0.05), default=None)

    cheaper = [a for a in top if a["is_cheaper"]]
    same = [a for a in top if a["match_type"] == "same_product"]
    parts = [f"Found {len(top)} comparable item(s) for “{base.product_name}” ({base.store_name}, Rs {base_price:,.0f})."]
    if same:
        best_same = min(same, key=lambda a: float(a["product"].price))
        parts.append(
            f"The same product is listed at {len(same)} other store(s); lowest is Rs {float(best_same['product'].price):,.0f} at {best_same['product'].store_name}."
        )
    if cheaper:
        c = min(cheaper, key=lambda a: float(a["product"].price))
        parts.append(
            f"{len(cheaper)} cheaper option(s); the cheapest saves Rs {abs(c['price_difference']):,.0f} ({abs(c['price_difference_pct']):.0f}%) at {c['product'].store_name}."
        )
    elif top:
        parts.append("This is already the cheapest among similar items we track.")

    def out(a):
        return {**a, "product": serialize(a["product"])}

    return {
        "base": serialize(base),
        "alternatives": [out(a) for a in top],
        "cheapest": serialize(cheapest["product"]) if cheapest else None,
        "best_value": serialize(best_value["product"]) if best_value else None,
        "summary": " ".join(parts),
    }


def side_by_side(db: Session, product_ids: list[int]) -> dict[str, Any]:
    ids = list(dict.fromkeys(product_ids))
    if len(ids) < 2:
        raise AppError("Select at least two products to compare side by side")
    products = [get_product(db, pid) for pid in ids]

    def fmt_money(v: float) -> str:
        return f"Rs {float(v):,.0f}"

    rows: list[dict[str, Any]] = []

    def row(attribute: str, values: list[Any], best: str | None = None):
        best_index = None
        numeric = [v for v in values if isinstance(v, int | float)]
        if best and numeric:
            target = min(numeric) if best == "min" else max(numeric)
            best_index = values.index(target)
        rows.append(
            {
                "attribute": attribute,
                "values": [None if v is None else (fmt_money(v) if attribute in {"Price", "Original price"} else str(v)) for v in values],
                "best_index": best_index,
            }
        )

    row("Store", [p.store_name for p in products])
    row("Brand", [p.brand_name for p in products])
    row("Price", [float(p.price) for p in products], "min")
    row("Original price", [float(p.original_price) for p in products])
    row("Discount %", [round(p.discount_percentage or 0, 1) for p in products], "max")
    row("Category", [p.category for p in products])
    if any(p.gender for p in products):
        row("For", [p.gender for p in products])
    if any(p.color for p in products):
        row("Colour", [p.color for p in products])
    if any(p.fabric for p in products):
        row("Fabric", [p.fabric for p in products])
    keys = [k for k in _SPEC_KEYS if any(k in (p.attributes or {}) for p in products)]
    for key in keys:
        row(key.replace("_", " ").title(), [(p.attributes or {}).get(key) for p in products])
    row("In stock", ["Yes" if p.in_stock else "No" for p in products])

    cheapest = min(products, key=lambda p: float(p.price))
    spread = float(max(p.price for p in products)) - float(cheapest.price)
    summary = f"{cheapest.product_name} at {cheapest.store_name} is the cheapest ({fmt_money(cheapest.price)}); the price spread is {fmt_money(spread)}."
    return {"products": [serialize(p) for p in products], "rows": rows, "summary": summary}
