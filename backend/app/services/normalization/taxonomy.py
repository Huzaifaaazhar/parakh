"""Dish taxonomy shared by the scrapers, search parser, comparison and agents.

Every restaurant names things differently ("Chicken Tikka (Leg)", "Tikka Boti 6 pcs",
"Zinger Stacker", "Make it a Meal"). We map menu titles onto a small set of comparable
dishes. Order matters: the first matching rule wins, so specific dishes come before broad
ones (a "zinger paratha roll" is a roll, not a burger; a "tikka pizza" is a pizza, not tikka;
a "chicken burger meal" is a deal, not a single burger).
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class CategoryRule:
    vertical: str
    category: str
    keywords: tuple[str, ...]


def _r(category: str, *keywords: str) -> CategoryRule:
    return CategoryRule("food", category, keywords)


CATEGORY_RULES: tuple[CategoryRule, ...] = (
    # --- Bundles first: a "burger meal" is priced as a bundle, so it compares with bundles ---
    _r(
        "deal", "deal", "combo", "make it a meal", "meal box", "family meal", "bucket", "platter", "value box", "midnight deal", "lunch box"
    ),
    # --- Drinks & desserts before mains: "chocolate shake" is not "chocolate cake" and "tikka" never appears ---
    _r("shake", "shake", "milkshake", "frappe", "smoothie", "freakshake"),
    _r("drink", "iced tea", "ice tea"),  # before chai: iced tea is a cold drink
    _r(
        "chai-coffee",
        "dodh patti",
        "dudh patti",
        "hot beverage",
        "hot drink",
        "chai",
        "doodh patti",
        "karak",
        "kashmiri tea",
        "green tea",
        "tea",
        "coffee",
        "latte",
        "cappuccino",
        "espresso",
        "americano",
        "mocha",
        "macchiato",
        "flat white",
        "hot chocolate",
    ),
    _r(
        "drink",
        "beverage",
        "mocktail",
        "cooler",
        "drinks",
        "sting",
        "perrier",
        "cola",
        "iced tea",
        "ice tea",
        "soft drink",
        "pepsi",
        "coke",
        "coca cola",
        "7up",
        "7 up",
        "sprite",
        "fanta",
        "mirinda",
        "dew",
        "water",
        "mineral water",
        "lemonade",
        "mojito",
        "margarita",
        "juice",
        "lassi",
        "soda",
        "iced tea",
        "slush",
        "cold drink",
    ),
    _r("ice-cream", "ice cream", "sundae", "gelato", "kulfi", "scoop", "cone", "falooda"),
    _r(
        "dessert",
        "biscuit",
        "tart",
        "creme brulee",
        "zarda",
        "mithai",
        "jalebi",
        "brownie",
        "cheesecake",
        "cake",
        "pastry",
        "kheer",
        "gulab jamun",
        "rasmalai",
        "ras malai",
        "halwa",
        "gajar halwa",
        "rabri",
        "pudding",
        "lava",
        "donut",
        "doughnut",
        "waffle",
        "crepe",
        "tiramisu",
        "mousse",
        "kunafa",
        "kunafeh",
        "baklava",
        "trifle",
        "cookie",
        "cupcake",
        "muffin",
        "croissant",
    ),
    # --- Pizza before anything a pizza might be topped with ---
    _r("pizza", "pizza", "calzone"),
    # --- Rolls / wraps / shawarma before burgers and tikka ("zinger roll", "tikka roll") ---
    _r("starter", "spring roll", "spring rolls"),  # before rolls: a spring roll is a starter
    _r("shawarma", "shawarma", "shawerma"),
    _r("roll-wrap", "paratha roll", "roll paratha", "roll", "wrap", "tortilla", "burrito", "taco", "frankie"),
    _r("burger", "burger", "zinger", "stacker", "smash", "slider", "patty melt", "krunch"),
    _r("sandwich", "sando", "sandwich", "club", "sub", "panini", "melt", "toastie", "hot dog", "hotdog"),
    # --- BBQ: tikka vs boti vs kabab are different things on a Pakistani menu ---
    # Rice and karahi before BBQ: a "tikka biryani" is biryani, a "tikka karahi" is karahi.
    _r("biryani", "biryani", "biriyani"),
    _r("pulao", "pulao", "pilaf", "yakhni pulao"),
    _r("karahi", "karahi", "karhai", "kadai", "kadhai"),
    _r("boti", "boti", "malai boti", "reshmi boti", "behari boti", "bihari boti", "tikka boti", "shashlik"),
    _r("chargha", "chargha", "charga", "steam roast", "whole chicken"),
    _r("tikka", "tikka", "chicken leg piece", "leg tikka", "chest tikka"),
    _r("kabab", "seekh kabab", "seekh", "kabab", "kebab", "chapli", "shami", "gola kabab", "reshmi kabab", "lab e shireen", "dhaga kabab"),
    _r("sajji", "sajji", "lamb roast", "raan"),
    _r("mandi", "mandi", "kabsa", "madfoon"),
    _r("bbq-platter", "ribs", "grilled", "steam roast", "bbq", "barbecue", "grill", "grilled platter", "mix grill", "mixed grill"),
    # --- Curries & rice ---
    _r("handi", "handi", "makhni", "makhani", "butter chicken", "jalfrezi", "achar gosht", "achari"),
    _r("nihari", "nehari", "nahari", "nihari"),
    _r("haleem", "haleem", "daleem"),
    _r("qorma", "qorma", "korma", "salan", "curry", "paya", "kofta", "keema", "qeema"),
    _r("daal-veg", "channa", "chanay", "daal", "dal", "chana", "palak", "saag", "bhindi", "aloo", "mix sabzi", "vegetable", "paneer"),
    # --- Chinese ---
    _r(
        "chinese",
        "manchurian",
        "chow mein",
        "chowmein",
        "fried rice",
        "egg fried rice",
        "szechuan",
        "schezwan",
        "kung pao",
        "chilli dry",
        "chili dry",
        "with chilies",
        "with almonds",
        "sweet and sour",
        "sweet & sour",
        "dumpling",
        "dimsum",
        "dim sum",
        "noodles",
        "chopsuey",
        "chop suey",
        "spring roll",
        "wonton",
    ),
    _r("rice", "rice bowl", "with rice", "masala rice", "plain rice", "rice"),
    _r("soup", "soup", "hot and sour", "hot & sour", "corn soup", "yakhni"),
    # --- Fried chicken & sides ---
    _r("wings", "drum stick", "wings", "wing", "hot shots", "drumstick", "drummet"),
    _r(
        "fried-chicken",
        "broast",
        "fried chicken",
        "crispy chicken",
        "chicken piece",
        "pieces",
        "strips",
        "nuggets",
        "tenders",
        "popcorn chicken",
        "fillet",
        "hot and crispy",
        "hot & crispy",
    ),
    _r("fries", "fries", "chips", "wedges", "nachos", "loaded fries", "masala fries"),
    # --- Western mains ---
    _r(
        "pasta",
        "pasta",
        "fettuccine",
        "fettucine",
        "spaghetti",
        "penne",
        "lasagna",
        "lasagne",
        "alfredo",
        "mac and cheese",
        "mac n cheese",
        "ravioli",
        "arrabbiata",
    ),
    _r("steak", "steak", "tenderloin", "ribeye", "sirloin", "t-bone", "chicken steak", "fajita"),
    _r("seafood", "fish", "prawn", "prawns", "shrimp", "calamari", "lobster", "finger fish"),
    _r("bread", "naan", "roti", "paratha", "kulcha", "chapati", "puri", "taftan", "sheermal", "garlic bread"),
    _r("salad", "salad", "raita", "coleslaw", "hummus", "fattoush", "tabbouleh"),
    _r(
        "starter",
        "starter",
        "appetizer",
        "samosa",
        "pakora",
        "spring roll",
        "dynamite",
        "bites",
        "poppers",
        "cheese balls",
        "mozzarella sticks",
    ),
    _r("breakfast", "omelette", "omelet", "halwa puri", "anda", "egg", "pancake", "french toast", "breakfast"),
)

VERTICALS = ("food", "other")
CATEGORIES_BY_VERTICAL: dict[str, list[str]] = {}
for _rule in CATEGORY_RULES:
    CATEGORIES_BY_VERTICAL.setdefault(_rule.vertical, [])
    if _rule.category not in CATEGORIES_BY_VERTICAL[_rule.vertical]:
        CATEGORIES_BY_VERTICAL[_rule.vertical].append(_rule.category)
ALL_CATEGORIES = {r.category: r.vertical for r in CATEGORY_RULES}

# Shown in the UI and used by the assistant ("tikka" -> "Tikka").
CATEGORY_LABELS = {
    "deal": "Deals & platters",
    "add-on": "Extras & sauces",
    "rice": "Rice bowls",
    "shake": "Shakes",
    "chai-coffee": "Chai & coffee",
    "drink": "Drinks",
    "ice-cream": "Ice cream",
    "dessert": "Desserts",
    "pizza": "Pizza",
    "shawarma": "Shawarma",
    "roll-wrap": "Rolls & wraps",
    "burger": "Burgers",
    "sandwich": "Sandwiches",
    "tikka": "Tikka",
    "boti": "Boti",
    "kabab": "Kababs",
    "sajji": "Sajji",
    "chargha": "Chargha",
    "mandi": "Mandi",
    "bbq-platter": "BBQ",
    "karahi": "Karahi",
    "handi": "Handi",
    "nihari": "Nihari",
    "haleem": "Haleem",
    "qorma": "Qorma & curries",
    "daal-veg": "Daal & sabzi",
    "biryani": "Biryani",
    "pulao": "Pulao",
    "chinese": "Chinese",
    "soup": "Soups",
    "wings": "Wings",
    "fried-chicken": "Fried chicken",
    "fries": "Fries & sides",
    "pasta": "Pasta",
    "steak": "Steaks",
    "seafood": "Fish & seafood",
    "bread": "Naan & roti",
    "salad": "Salads",
    "starter": "Starters",
    "breakfast": "Breakfast",
    "other": "Other",
}

# --- Protein: chicken tikka and beef tikka are not the same dish ---
# Checked in order: seafood and red meat first, then unmistakably vegetarian dishes ("paneer tikka"),
# then chicken (which also claims "tikka", "zinger", "broast"), then weak veg words ("with vegetables").
PROTEINS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("prawn", ("prawn", "prawns", "shrimp", "jhinga")),
    ("fish", ("fish", "salmon", "finger fish", "machli")),
    ("mutton", ("mutton", "lamb", "goat", "bakra", "raan")),
    ("beef", ("beef", "bong", "nalli", "veal")),
    ("veg", ("paneer", "falafel", "daal", "dal", "chana", "channa", "aloo", "mushroom", "veggie", "vegetarian")),
    (
        "chicken",
        ("chicken", "murgh", "malai boti", "reshmi", "chicken boti", "zinger", "broast", "chargha", "tikka", "wings", "nuggets", "strips"),
    ),
    ("veg", ("veg", "vegetable")),
)

# --- Portion words ---
SIZE_WORDS: dict[str, str] = {
    "personal": "small",
    "mini": "small",
    "small": "small",
    "regular": "regular",
    "medium": "medium",
    "large": "large",
    "jumbo": "family",
    "family": "family",
    "xl": "family",
    "party": "family",
    "half": "half",
    "full": "full",
    "quarter": "quarter",
    "qtr": "quarter",
    "single": "single",
    "double": "double",
    "triple": "triple",
}


def _compile_words(words: tuple[str, ...]) -> re.Pattern:
    escaped = sorted((re.escape(w) for w in words), key=len, reverse=True)
    # Optional plural suffix so "burgers"/"kababs" match "burger"/"kabab".
    return re.compile(r"(?<![a-z0-9])(" + "|".join(escaped) + r")(?:s|es)?(?![a-z0-9])", re.IGNORECASE)


_CATEGORY_PATTERNS = [(rule, _compile_words(rule.keywords)) for rule in CATEGORY_RULES]
_PROTEIN_PATTERNS = [(p, _compile_words(words)) for p, words in PROTEINS]
_SIZE_RE = _compile_words(tuple(SIZE_WORDS))
_PIECES_RE = re.compile(r"(\d{1,3})\s*(?:-|\s)?(?:pcs?|pieces?|pc's|nos|x)\b|\b(?:x|×)\s*(\d{1,2})\b|\((\d{1,2})\)", re.I)
_INCH_RE = re.compile(r"(\d{1,2}(?:\.\d)?)\s*(?:\"|”|''|inch(?:es)?|in\b)", re.I)
_SERVES_RE = re.compile(r"(?:serves|for|feeds)\s*(\d{1,2})\s*(?:people|persons|person|pax)?\b|(\d{1,2})\s*(?:persons?|people|pax)\b", re.I)
_GRAMS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|kgs|gm|gms|g|grams?)\b", re.I)
_ML_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(ml|ltr|liters?|litres?|l)\b", re.I)


def detect_category(*texts: str | None, allowed: list[str] | None = None) -> tuple[str, str]:
    """Return (vertical, dish) for the given texts, searched in priority order (title first)."""
    for text in texts:
        if not text:
            continue
        for rule, pattern in _CATEGORY_PATTERNS:
            if allowed and rule.vertical not in allowed:
                continue
            if pattern.search(text):
                return rule.vertical, rule.category
    return ("food", "other") if not allowed or "food" in allowed else ("other", "other")


def detect_protein(*texts: str | None) -> str | None:
    blob = " ".join(t for t in texts if t)
    if not blob:
        return None
    for protein, pattern in _PROTEIN_PATTERNS:
        if pattern.search(blob):
            return protein
    return None


def detect_portion(text: str | None) -> dict:
    """Pieces, size word, pizza inches, serves N, grams and ml from a menu title or size label."""
    if not text:
        return {}
    out: dict = {}
    if m := _PIECES_RE.search(text):
        n = int(next(g for g in m.groups() if g))
        if 0 < n <= 60:
            out["pieces"] = n
    if m := _INCH_RE.search(text):
        inches = float(m.group(1))
        if 5 <= inches <= 24:
            out["inches"] = inches
    if m := _SIZE_RE.search(text):
        out["size"] = SIZE_WORDS[m.group(1).lower()]
    if m := _SERVES_RE.search(text):
        n = int(m.group(1) or m.group(2))
        if 0 < n <= 30:
            out["serves"] = n
    if m := _GRAMS_RE.search(text):
        grams = float(m.group(1)) * (1000 if m.group(2).lower().startswith("kg") else 1)
        if 20 <= grams <= 10000:
            out["weight_g"] = grams
    if m := _ML_RE.search(text):
        unit = m.group(2).lower()
        ml = float(m.group(1)) * (1 if unit == "ml" else 1000)
        if 50 <= ml <= 5000:
            out["volume_ml"] = ml
    return out


def find_categories_in_text(text: str) -> list[tuple[str, str]]:
    """All (vertical, dish) pairs mentioned in free text (used by the query parser)."""
    found: list[tuple[str, str]] = []
    for rule, pattern in _CATEGORY_PATTERNS:
        if pattern.search(text) and (rule.vertical, rule.category) not in found:
            found.append((rule.vertical, rule.category))
    return found


# --- Not used for food; kept so older callers keep working ---
def detect_gender(*texts: str | None) -> str | None:
    return None


def detect_color(*texts: str | None) -> str | None:
    return None


def detect_fabric(*texts: str | None) -> str | None:
    return None
