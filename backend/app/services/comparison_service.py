"""Dish comparison across restaurants: the same dish, priced fairly, side by side.

Two menu items are only compared when they are the same dish (tikka with tikka, never
tikka with a tikka pizza), the same protein (chicken vs beef never match) and a compatible
portion (half karahi vs half karahi; a 12" pizza vs 10-14"). Price is then compared per
piece / per person / per 100 sq in of pizza where the menus say how much you get.

Similarity blends semantic similarity (vector store), shared portion facts, title overlap
and price proximity.
"""

import re
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.cache import cached
from app.core.errors import AppError
from app.models import Product
from app.services.normalization.normalizer import embedding_text
from app.services.normalization.portion import portion_label
from app.services.normalization.taxonomy import CATEGORY_LABELS
from app.services.product_service import get_product, serialize
from app.services.vector.store import get_vector_store

_TOKEN = re.compile(r"[a-z0-9]+")
_NOISE = {"the", "and", "with", "for", "new", "pc", "pcs", "piece", "pieces", "special", "chicken", "beef", "mutton"}
# Size classes that must agree when both menus state them.
_STRICT_SIZES = {"half", "full", "quarter"}
_SIZE_CLASS = {"small": 1, "single": 1, "regular": 2, "medium": 2, "large": 3, "double": 3, "family": 4, "triple": 4}


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN.findall(text.lower()) if t not in _NOISE and len(t) > 1}


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def dish_weight(base: Product, other: Product) -> float | None:
    """None = these two should never be compared; otherwise a 0-1 multiplier on similarity."""
    if base.category != other.category:
        return None
    ba, oa = base.attributes or {}, other.attributes or {}
    weight = 1.0
    if ba.get("protein") and oa.get("protein"):
        if ba["protein"] != oa["protein"]:
            return None
    elif ba.get("protein") or oa.get("protein"):
        weight *= 0.85
    bs, os_ = ba.get("size"), oa.get("size")
    if bs and os_:
        if bs in _STRICT_SIZES or os_ in _STRICT_SIZES:
            if bs != os_:
                return None
        elif abs(_SIZE_CLASS.get(bs, 2) - _SIZE_CLASS.get(os_, 2)) > 1:
            return None
        elif bs != os_:
            weight *= 0.8
    elif bs or os_:
        weight *= 0.85
    if base.category == "pizza" and ba.get("inches") and oa.get("inches"):
        if abs(float(ba["inches"]) - float(oa["inches"])) > 2:
            return None
    if ba.get("cut") and oa.get("cut") and ba["cut"] != oa["cut"]:
        weight *= 0.9  # leg vs chest tikka: same dish, different piece
    if base.category == "deal":
        bp, op = ba.get("deal_parts") or 1, oa.get("deal_parts") or 1
        if max(bp, op) / max(min(bp, op), 1) > 2.5:  # a 2-item combo vs a 10-item platter
            return None
    if base.category == "other" and _jaccard(_tokens(base.product_name), _tokens(other.product_name)) < 0.3:
        return None
    return weight


def _price_band(base: Product) -> tuple[float, float]:
    # Portions vary a lot between restaurants; deals vary most.
    return (0.25, 4.0) if base.category == "deal" else (0.35, 2.8)


def _features(base: Product, other: Product) -> tuple[float, list[str], list[str]]:
    shared, diffs = [], []
    score = 0.0
    ba, oa = base.attributes or {}, other.attributes or {}
    if base.category != "other":
        score += 0.4
        shared.append(f"Same dish: {CATEGORY_LABELS.get(base.category, base.category)}")
    if ba.get("protein") and ba.get("protein") == oa.get("protein"):
        score += 0.2
        shared.append(f"{str(ba['protein']).title()}")
    for key, label in (("size", "Size"), ("pieces", "Pieces"), ("inches", "Size"), ("serves", "Serves"), ("cut", "Piece")):
        a, b = ba.get(key), oa.get(key)
        if a and b:
            if str(a) == str(b):
                score += 0.1
                shared.append(f"{label}: {portion_label({key: a})}")
            else:
                diffs.append(f"{label}: {portion_label({key: b})} vs {portion_label({key: a})}")
    if base.unit_price and other.unit_price and base.unit_label == other.unit_label:
        d = other.unit_price - base.unit_price
        if abs(d) >= 1:
            diffs.append(f"Rs {abs(d):,.0f} {'less' if d < 0 else 'more'} {base.unit_label}")
    if other.store_rating:
        shared.append(f"Rated {other.store_rating:.1f} on Google")
    if other.discount_percentage:
        diffs.append(f"On offer: {other.discount_percentage:.0f}% off")
    return min(score, 1.0), shared, diffs


def _candidates(db: Session, base: Product, k: int) -> dict[int, float]:
    where: dict[str, Any] = {"vertical": base.vertical, "in_stock": True, "category": base.category}
    try:
        hits = get_vector_store().query_by_id(base.id, embedding_text(base), k=k, where=where)
        sem = {h.product_id: max(0.0, h.score) for h in hits}
    except Exception:  # noqa: BLE001
        sem = {}
    # Always add a structured pool so comparison works without a vector index.
    price = float(base.price)
    lo, hi = _price_band(base)
    stmt = select(Product.id).where(
        Product.is_active.is_(True),
        Product.in_stock.is_(True),
        Product.category == base.category,
        Product.id != base.id,
        Product.price.between(price * lo, price * hi),
    )
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
        fit = dish_weight(base, other)
        if fit is None:
            continue
        price = float(other.price)
        if base_price and not lo <= price / base_price <= hi:
            continue
        same_store = other.store_id == base.store_id
        title_sim = _jaccard(base_tokens, _tokens(other.product_name))
        # "Same dish" = same dish, protein and portion at another restaurant: the headline comparison.
        same_product = not same_store and fit == 1.0 and base.category != "other"
        if other_brands_only and same_store:
            continue
        attr_score, shared, diffs = _features(base, other)
        ratio = min(price, base_price) / max(price, base_price) if price and base_price else 0
        similarity = 0.45 * sem.get(other.id, 0.0) + 0.25 * attr_score + 0.2 * title_sim + 0.1 * ratio
        similarity *= fit
        if same_product:
            similarity = max(similarity, 0.9)
        diff = round(price - base_price, 2)
        if cheaper_only and diff >= 0:
            continue
        scored.append(
            {
                "product": other,
                "similarity": round(min(similarity, 1.0), 3),
                "match_type": "same_dish" if same_product else "similar",
                "price_difference": diff,
                "price_difference_pct": round(diff / base_price * 100, 1) if base_price else 0.0,
                "is_cheaper": diff < 0,
                "shared_features": shared,
                "differences": diffs,
            }
        )

    scored.sort(key=lambda a: (a["match_type"] != "same_dish", -a["similarity"]))
    top = scored[:limit]
    cheapest = min(top, key=lambda a: float(a["product"].price), default=None)
    # Best value: compare per piece / person / sq in when every candidate states it, else price per similarity.
    good = [a for a in top if a["similarity"] >= 0.35] or top
    unit_ok = [a for a in good if a["product"].unit_price and a["product"].unit_label == base.unit_label]
    if base.unit_price and len(unit_ok) >= 2:
        best_value = min(unit_ok, key=lambda a: a["product"].unit_price)
    else:
        best_value = min(good, key=lambda a: float(a["product"].price) / max(a["similarity"], 0.05), default=None)

    cheaper = [a for a in top if a["is_cheaper"]]
    same = [a for a in top if a["match_type"] == "same_dish"]
    dish = CATEGORY_LABELS.get(base.category, base.category).lower()
    parts = [f"Compared “{base.product_name}” ({base.store_name}, Rs {base_price:,.0f}) with {len(top)} {dish} item(s) elsewhere."]
    if same:
        best_same = min(same, key=lambda a: float(a["product"].price))
        parts.append(
            f"{len(same)} restaurant(s) serve the same dish and portion; the lowest is Rs {float(best_same['product'].price):,.0f} at {best_same['product'].store_name}."
        )
    if cheaper:
        c = min(cheaper, key=lambda a: float(a["product"].price))
        parts.append(
            f"{len(cheaper)} cheaper option(s); the cheapest saves Rs {abs(c['price_difference']):,.0f} ({abs(c['price_difference_pct']):.0f}%) at {c['product'].store_name}."
        )
    elif top:
        parts.append("This is already the cheapest like-for-like option we track.")

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
                "values": [None if v is None else (fmt_money(v) if attribute in {"Price", "Menu price"} else str(v)) for v in values],
                "best_index": best_index,
            }
        )

    row("Restaurant", [p.store_name for p in products])
    row("Dish", [CATEGORY_LABELS.get(p.category, p.category) for p in products])
    if any(p.protein for p in products):
        row("Protein", [p.protein.title() if p.protein else None for p in products])
    if any(p.portion for p in products):
        row("Portion", [p.portion for p in products])
    row("Price", [float(p.price) for p in products], "min")
    labels = {p.unit_label for p in products}
    if len(labels) == 1 and None not in labels:
        unit_values = [p.unit_price for p in products]
        row(f"Price {labels.pop()}", unit_values, "min")
        rows[-1]["values"] = [fmt_money(v) if v is not None else None for v in unit_values]
    if any(p.is_on_sale for p in products):
        row("Menu price", [float(p.original_price) for p in products])
        row("Discount %", [round(p.discount_percentage or 0, 1) for p in products], "max")
    if any(p.store_rating for p in products):
        row("Google rating", [p.store_rating for p in products], "max")
    if any((p.attributes or {}).get("menu_section") for p in products):
        row("On the menu under", [(p.attributes or {}).get("menu_section") for p in products])
    row("Available", ["Yes" if p.in_stock else "No" for p in products])

    cheapest = min(products, key=lambda p: float(p.price))
    spread = float(max(p.price for p in products)) - float(cheapest.price)
    summary = f"{cheapest.product_name} at {cheapest.store_name} is the cheapest ({fmt_money(cheapest.price)}); the price spread is {fmt_money(spread)}."
    if len({p.category for p in products}) > 1:
        summary += " These are different dishes, so compare portions before price."
    return {"products": [serialize(p) for p in products], "rows": rows, "summary": summary}
