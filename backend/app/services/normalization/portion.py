"""Portion maths: turn "Rs 1,450 for 6 pcs" or "Rs 2,199 for a 12-inch pizza" into a fair unit price."""

from __future__ import annotations

import math
from typing import Any

SIZE_LABELS = {
    "small": "Small",
    "regular": "Regular",
    "medium": "Medium",
    "large": "Large",
    "family": "Family",
    "half": "Half",
    "full": "Full",
    "quarter": "Quarter",
    "single": "Single",
    "double": "Double",
    "triple": "Triple",
}


def unit_price(price: float, attrs: dict[str, Any] | None, category: str | None = None) -> tuple[float, str] | None:
    """Best available per-unit price, or None when the menu gives no countable portion."""
    attrs = attrs or {}
    price = float(price or 0)
    if price <= 0:
        return None
    if category == "pizza" and attrs.get("inches"):
        area = math.pi * (float(attrs["inches"]) / 2) ** 2
        return round(price / area * 100, 1), "per 100 sq in"
    if attrs.get("pieces") and int(attrs["pieces"]) > 1:
        return round(price / int(attrs["pieces"]), 1), "per piece"
    if attrs.get("serves") and int(attrs["serves"]) > 1:
        return round(price / int(attrs["serves"]), 1), "per person"
    if attrs.get("weight_g"):
        return round(price / float(attrs["weight_g"]) * 100, 1), "per 100 g"
    if attrs.get("volume_ml") and category in {"drink", "shake", "chai-coffee"}:
        return round(price / float(attrs["volume_ml"]) * 100, 1), "per 100 ml"
    return None


def portion_label(attrs: dict[str, Any] | None) -> str | None:
    attrs = attrs or {}
    parts: list[str] = []
    if attrs.get("size"):
        parts.append(SIZE_LABELS.get(attrs["size"], str(attrs["size"]).title()))
    if attrs.get("inches"):
        parts.append(f'{float(attrs["inches"]):g}"')
    if attrs.get("pieces"):
        parts.append(f"{attrs['pieces']} pcs")
    if attrs.get("serves"):
        parts.append(f"serves {attrs['serves']}")
    if attrs.get("weight_g"):
        g = float(attrs["weight_g"])
        parts.append(f"{g / 1000:g} kg" if g >= 1000 else f"{g:g} g")
    if attrs.get("volume_ml"):
        ml = float(attrs["volume_ml"])
        parts.append(f"{ml / 1000:g} L" if ml >= 1000 else f"{ml:g} ml")
    if attrs.get("cut"):
        parts.append(str(attrs["cut"]).title())
    return " · ".join(parts) or None
