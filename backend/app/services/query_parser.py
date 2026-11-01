"""Rule-based natural-language query -> structured filters.

Used by GET /products/search and as the no-LLM fallback for the agents.
Handles PKR price expressions ("under 800", "below 2k", "1-2k", "around 1500"),
dishes ("tikka", "zinger", "biryani"), protein ("beef", "mutton"), restaurant names
and intent words ("deal", "offer", "cheapest", "best value").
"""

import re
from dataclasses import asdict, dataclass, field

from app.services.normalization.taxonomy import detect_protein, find_categories_in_text

_NUM = r"(\d+(?:[.,]\d+)?)\s*(k|thousand|lac|lakh)?"
_UNDER = re.compile(rf"(?:under|below|less than|upto|up to|within|max|maximum|<|budget(?: of)?)\s*(?:rs\.?|pkr)?\s*{_NUM}", re.I)
_OVER = re.compile(rf"(?:over|above|more than|from|min|minimum|>|starting)\s*(?:rs\.?|pkr)?\s*{_NUM}", re.I)
_BETWEEN = re.compile(rf"(?:between\s*)?(?:rs\.?|pkr)?\s*{_NUM}\s*(?:-|to|and)\s*(?:rs\.?|pkr)?\s*{_NUM}", re.I)
_AROUND = re.compile(rf"(?:around|about|approx(?:imately)?|~)\s*(?:rs\.?|pkr)?\s*{_NUM}", re.I)
_STOPWORDS = {
    "best",
    "good",
    "cheap",
    "cheapest",
    "show",
    "me",
    "find",
    "i",
    "want",
    "need",
    "looking",
    "for",
    "a",
    "an",
    "the",
    "some",
    "any",
    "under",
    "below",
    "above",
    "over",
    "between",
    "and",
    "to",
    "in",
    "of",
    "with",
    "on",
    "rs",
    "pkr",
    "price",
    "prices",
    "please",
    "sale",
    "sales",
    "deal",
    "deals",
    "discount",
    "discounted",
    "value",
    "budget",
    "what",
    "are",
    "is",
    "there",
    "buy",
    "top",
    "latest",
    "new",
    "items",
    "products",
    "less",
    "than",
    "around",
    "about",
    "upto",
    "up",
    "within",
    "from",
    "that",
    "this",
    "those",
    "these",
    "can",
    "you",
    "get",
    "affordable",
    "options",
    "option",
    "k",
    "offer",
    "offers",
    "off",
    "combo",
    "combos",
    "near",
    "restaurant",
    "restaurants",
    "food",
}


def _to_pkr(num: str, unit: str | None) -> float:
    value = float(num.replace(",", ""))
    unit = (unit or "").lower()
    if unit in {"k", "thousand"}:
        value *= 1_000
    elif unit in {"lac", "lakh"}:
        value *= 100_000
    return value


@dataclass
class SearchFilters:
    text: str = ""
    vertical: str | None = None
    category: str | None = None
    gender: str | None = None
    brand: str | None = None
    color: str | None = None
    fabric: str | None = None
    protein: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    on_sale: bool = False
    in_stock: bool = True
    sort: str = "relevance"  # relevance|price_asc|price_desc|discount|newest|value
    keywords: list[str] = field(default_factory=list)
    consumed_words: list[str] = field(default_factory=list)  # words turned into filters (not re-matched as text)

    def as_dict(self) -> dict:
        return asdict(self)


def parse_query(query: str, known_brands: list[str] | None = None) -> SearchFilters:
    q = query.strip()
    lower = q.lower()
    f = SearchFilters(text=q)

    if m := _BETWEEN.search(lower):
        a, b = _to_pkr(m.group(1), m.group(2)), _to_pkr(m.group(3), m.group(4) or m.group(2))
        # "2-5k" -> 2000-5000
        if m.group(4) and not m.group(2) and a < 100:
            a = _to_pkr(m.group(1), m.group(4))
        if a >= 100 or b >= 100:
            f.min_price, f.max_price = min(a, b), max(a, b)
    if f.max_price is None and (m := _UNDER.search(lower)):
        f.max_price = _to_pkr(m.group(1), m.group(2))
    if f.min_price is None and (m := _OVER.search(lower)):
        value = _to_pkr(m.group(1), m.group(2))
        if value >= 100:
            f.min_price = value
    if f.min_price is None and f.max_price is None and (m := _AROUND.search(lower)):
        target = _to_pkr(m.group(1), m.group(2))
        f.min_price, f.max_price = round(target * 0.8), round(target * 1.2)

    # "deal(s)"/"combo" ask for bundles; "offer"/"discount"/"off" ask for reduced prices.
    categories = [c for c in find_categories_in_text(lower) if c[1] != "deal"]
    if re.search(r"\b(deals?|combos?|platters?|meal box|bucket)\b", lower):
        f.vertical, f.category = "food", "deal"  # "burger deals" = deals with a burger in them
    elif categories:
        f.vertical, f.category = categories[0]
    f.protein = detect_protein(lower) if f.category not in {"drink", "shake", "chai-coffee", "dessert", "ice-cream"} else None
    if f.protein == "chicken" and not re.search(r"\b(chicken|murgh)\b", lower):
        f.protein = None  # "tikka" alone shouldn't exclude beef tikka
    f.consumed_words = [w for w in re.findall(r"[a-z]+", lower) if w in {"chicken", "beef", "mutton", "fish", "prawn", "veg", "murgh"}]

    if known_brands:
        for brand in sorted(known_brands, key=len, reverse=True):
            if re.search(rf"(?<![a-z0-9]){re.escape(brand.lower())}(?![a-z0-9])", lower):
                f.brand = brand
                break

    if re.search(r"\b(sale|sales|discount|discounted|off|offer|offers)\b", lower):
        f.on_sale = True
        f.sort = "discount"
    if re.search(r"\b(cheapest|lowest price|low to high|cheap|affordable)\b", lower):
        f.sort = "price_asc"
    elif re.search(r"\b(best value|value for money|worth)\b", lower):
        f.sort = "value"
    elif re.search(r"\b(expensive|premium|high to low|luxury)\b", lower):
        f.sort = "price_desc"
    elif re.search(r"\b(new|latest|arrival|arrivals)\b", lower):
        f.sort = "newest"

    residual = re.sub(r"[\d.,]+\s*(k|thousand|lac|lakh)?", " ", lower)
    words = [w for w in re.findall(r"[a-z][a-z\-']+", residual) if w not in _STOPWORDS and len(w) > 1]
    f.keywords = words
    return f
