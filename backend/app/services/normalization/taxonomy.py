"""Unified product taxonomy shared by the scrapers, search parser and agents.

Every store names things differently ("Kameez", "Shirt", "Top", "Lawn 3Pc").
We map raw titles / product types / tags onto a small canonical taxonomy:
vertical -> category. Order matters: the first matching rule wins, so more
specific rules (e.g. "kurta" before "shirt") come first.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class CategoryRule:
    vertical: str
    category: str
    keywords: tuple[str, ...]


CATEGORY_RULES: tuple[CategoryRule, ...] = (
    # --- Electronics (checked first: "phone case" shouldn't become fashion) ---
    # Accessories first so "Galaxy Watch Charger" / "AirPods Case" aren't classed as the device itself.
    CategoryRule(
        "electronics",
        "accessory",
        (
            "watch strap",
            "watch band strap",
            "smart watch strap",
            "screen protector",
            "tempered glass",
            "back cover",
            "phone case",
            "mobile cover",
            "charging case",
            "charging box",
            "watch charger",
            "case cover",
        ),
    ),
    CategoryRule("electronics", "charger-cable", ("charger", "charging cable", "usb cable", "type-c cable", "adapter", "wall plug")),
    CategoryRule("electronics", "smartwatch", ("smartwatch", "smart watch", "galaxy watch", "apple watch", "fitness band", "smart band")),
    CategoryRule("electronics", "earbuds", ("earbuds", "earbud", "airpods", "buds", "tws", "true wireless", "airdots")),
    CategoryRule("electronics", "tablet", ("tablet", "ipad", "galaxy tab")),  # before smartphone: "galaxy tab" vs "galaxy"
    CategoryRule(
        "electronics",
        "smartphone",
        (
            "smartphone",
            "mobile phone",
            "phone",
            "mobile",
            "iphone",
            "galaxy",
            "pixel",
            "redmi",
            "poco",
            "infinix",
            "tecno",
            "vivo",
            "oppo",
            "realme",
        ),
    ),
    CategoryRule("electronics", "laptop", ("laptop", "notebook pc", "macbook", "chromebook", "thinkpad", "ideapad", "vivobook")),
    CategoryRule("electronics", "headphones", ("headphone", "headphones", "headset", "earphone", "earphones", "handsfree")),
    CategoryRule("electronics", "speaker", ("speaker", "sound bar", "soundbar", "woofer")),
    CategoryRule("electronics", "power-bank", ("power bank", "powerbank")),
    CategoryRule("electronics", "television", ("led tv", "smart tv", "television", "android tv")),
    CategoryRule("electronics", "camera", ("camera", "webcam", "action cam", "dashcam")),
    CategoryRule("electronics", "gaming", ("gaming", "controller", "gamepad", "playstation", "xbox", "console")),
    CategoryRule(
        "electronics",
        "computer-accessory",
        (
            "keyboard",
            "mouse",
            "monitor",
            "microphone",
            "ssd",
            "usb hub",
            "router",
            "flash drive",
            "usb drive",
            "memory card",
            "printer",
            "photocopier",
            "scanner",
            "projector",
        ),
    ),
    CategoryRule(
        "electronics",
        "home-appliance",
        (
            "air fryer",
            "blender",
            "juicer",
            "steam iron",
            "dry iron",
            "kettle",
            "hair dryer",
            "hair straightener",
            "trimmer",
            "shaver",
            "vacuum",
            "fan",
            "heater",
            "air purifier",
            "food processor",
            "chopper",
        ),
    ),
    # --- Beauty ---
    CategoryRule("beauty", "fragrance", ("perfume", "fragrance", "eau de", "body mist", "attar", "edp", "edt")),
    CategoryRule(
        "beauty",
        "skincare",
        (
            "serum",
            "moisturizer",
            "moisturiser",
            "cleanser",
            "face wash",
            "sunscreen",
            "spf",
            "toner",
            "face cream",
            "night cream",
            "day cream",
            "foot care",
            "lotion",
            "face mask",
            "scrub",
            "body wash",
            "soap",
        ),
    ),
    CategoryRule(
        "beauty", "makeup", ("lipstick", "foundation", "mascara", "eyeliner", "blush", "concealer", "highlighter", "palette", "lip gloss")
    ),
    CategoryRule(
        "beauty", "haircare", ("shampoo", "conditioner", "hair oil", "hair mask", "hair serum", "hair food", "hair fall", "hair care")
    ),
    # --- Home ---
    CategoryRule("home", "bedding", ("bedsheet", "bed sheet", "duvet", "comforter", "pillow", "quilt", "bed set")),
    CategoryRule("home", "towels", ("towel", "bathrobe")),
    CategoryRule("home", "curtains", ("curtain", "blinds")),
    CategoryRule("home", "decor", ("cushion", "rug", "vase", "candle", "wall art", "table runner", "wall clock", "frame")),
    CategoryRule(
        "home",
        "kitchen",
        (
            "kitchen",
            "cookware",
            "utensil",
            "tray",
            "mop",
            "cleaning",
            "lunch box",
            "bottle",
            "mug",
            "dinner set",
            "storage box",
            "organizer",
        ),
    ),
    CategoryRule("home", "lighting", ("lamp", "night light", "led light", "bulb", "fairy light", "wall light")),
    # --- Fashion: footwear ---
    CategoryRule("fashion", "sneakers", ("sneaker", "sneakers", "trainer", "running shoe")),
    CategoryRule("fashion", "sandals", ("sandal", "sandals", "slipper", "slippers", "flip flop", "chappal", "slides", "peshawari")),
    CategoryRule("fashion", "heels", ("heel", "heels", "pump", "pumps", "stiletto", "wedge")),
    CategoryRule("fashion", "khussa", ("khussa", "kolhapuri")),
    CategoryRule(
        "fashion",
        "shoes",
        ("shoe", "shoes", "loafer", "loafers", "moccasin", "moccs", "oxfords", "derby", "boot", "boots", "court", "pumps"),
    ),
    # --- Fashion: eastern ---
    CategoryRule("fashion", "nightwear", ("nightwear", "night suit", "sleepwear", "lounge")),
    CategoryRule("fashion", "shalwar-kameez", ("shalwar kameez", "kameez shalwar", "shalwar suit", "kurta pajama", "kurta shalwar")),
    CategoryRule("fashion", "unstitched", ("unstitched", "un-stitched", "un stitched")),
    CategoryRule(
        "fashion",
        "suit",
        (
            "3 piece",
            "3-piece",
            "3pc",
            "3 pc",
            "2 piece",
            "2-piece",
            "2pc",
            "2 pc",
            "three piece",
            "two piece",
            "co-ord",
            "co ord",
            "coord",
            "suit",
        ),
    ),
    CategoryRule("fashion", "kurta", ("kurta", "kurti", "kameez", "tunic")),
    CategoryRule("fashion", "waistcoat", ("waistcoat", "waist coat", "vest coat", "prince coat", "sherwani")),
    CategoryRule("fashion", "dupatta", ("dupatta", "shawl", "stole", "scarf", "hijab", "abaya")),
    CategoryRule("fashion", "jeans", ("jeans", "denim")),
    CategoryRule(
        "fashion", "trousers", ("trouser", "trousers", "pants", "chinos", "culottes", "palazzo", "tights", "capri", "joggers", "cargo")
    ),
    CategoryRule("fashion", "shalwar", ("shalwar", "pajama", "pyjama", "salwar")),
    # --- Fashion: western ---
    CategoryRule("fashion", "t-shirt", ("t-shirt", "t shirt", "tee", "tshirt", "polo")),
    CategoryRule("fashion", "shirt", ("shirt", "blouse", "top", "tops")),
    CategoryRule("fashion", "dress", ("dress", "frock", "gown", "maxi", "jumpsuit")),
    CategoryRule("fashion", "outerwear", ("jacket", "coat", "hoodie", "sweater", "sweatshirt", "cardigan", "blazer", "puffer", "jumper")),
    CategoryRule("fashion", "shorts", ("shorts", "skirt")),
    # --- Accessories ---
    CategoryRule("fashion", "bags", ("bag", "handbag", "tote", "clutch", "wallet", "backpack", "purse", "pouch")),
    CategoryRule("fashion", "watches", ("watch", "watches")),
    CategoryRule("fashion", "jewellery", ("earring", "earrings", "necklace", "bracelet", "ring", "jewellery", "jewelry", "bangle")),
    CategoryRule("fashion", "accessories", ("belt", "cap", "socks", "sunglasses", "tie", "cufflinks", "accessor")),
)

VERTICALS = ("fashion", "electronics", "beauty", "home", "other")
CATEGORIES_BY_VERTICAL: dict[str, list[str]] = {}
for _rule in CATEGORY_RULES:
    CATEGORIES_BY_VERTICAL.setdefault(_rule.vertical, [])
    if _rule.category not in CATEGORIES_BY_VERTICAL[_rule.vertical]:
        CATEGORIES_BY_VERTICAL[_rule.vertical].append(_rule.category)
ALL_CATEGORIES = {r.category: r.vertical for r in CATEGORY_RULES}

GENDER_KEYWORDS: dict[str, tuple[str, ...]] = {
    "kids": ("kids", "kid", "boys", "boy", "girls", "girl", "baby", "toddler", "infant", "junior", "children", "child", "teen"),
    "women": ("women", "woman", "womens", "ladies", "lady", "female", "mom"),
    "men": ("men", "man", "mens", "male", "gents", "gentleman"),
    "unisex": ("unisex",),
}

COLORS = (
    "off white",
    "off-white",
    "sky blue",
    "navy blue",
    "royal blue",
    "light blue",
    "dark blue",
    "sea green",
    "bottle green",
    "olive green",
    "light green",
    "dark green",
    "hot pink",
    "baby pink",
    "dusty pink",
    "light grey",
    "dark grey",
    "charcoal",
    "black",
    "white",
    "red",
    "maroon",
    "burgundy",
    "pink",
    "peach",
    "coral",
    "orange",
    "rust",
    "mustard",
    "yellow",
    "lemon",
    "green",
    "olive",
    "mint",
    "teal",
    "turquoise",
    "aqua",
    "blue",
    "navy",
    "indigo",
    "purple",
    "lilac",
    "lavender",
    "mauve",
    "magenta",
    "plum",
    "brown",
    "beige",
    "cream",
    "ivory",
    "khaki",
    "camel",
    "tan",
    "fawn",
    "grey",
    "gray",
    "silver",
    "gold",
    "golden",
    "multi",
    "multicolor",
    "ferozi",
)
COLOR_CANONICAL = {
    "off-white": "off white",
    "gray": "grey",
    "golden": "gold",
    "multicolor": "multi",
    "navy blue": "navy",
    "ferozi": "turquoise",
    "dark grey": "charcoal",
}

FABRICS = (
    "lawn",
    "cotton",
    "khaddar",
    "khaddi",
    "cambric",
    "chiffon",
    "silk",
    "linen",
    "karandi",
    "marina",
    "velvet",
    "organza",
    "net",
    "jacquard",
    "denim",
    "wool",
    "fleece",
    "polyester",
    "viscose",
    "rayon",
    "georgette",
    "crepe",
    "jersey",
    "lycra",
    "satin",
    "dobby",
    "poplin",
    "leather",
    "suede",
    "canvas",
    "wash and wear",
    "wash & wear",
    "boski",
    "pashmina",
    "slub",
    "corduroy",
    "twill",
    "muslin",
    "raw silk",
    "acrylic",
)
FABRIC_CANONICAL = {"khaddi": "khaddar", "wash & wear": "wash and wear"}


def _compile_words(words: tuple[str, ...]) -> re.Pattern:
    escaped = sorted((re.escape(w) for w in words), key=len, reverse=True)
    # Optional plural suffix so "shirts"/"watches" match "shirt"/"watch".
    return re.compile(r"(?<![a-z0-9])(" + "|".join(escaped) + r")(?:s|es)?(?![a-z0-9])", re.IGNORECASE)


_CATEGORY_PATTERNS = [(rule, _compile_words(rule.keywords)) for rule in CATEGORY_RULES]
_GENDER_PATTERNS = {g: _compile_words(words) for g, words in GENDER_KEYWORDS.items()}
_COLOR_PATTERN = _compile_words(COLORS)
_FABRIC_PATTERN = _compile_words(FABRICS)


def detect_category(*texts: str | None, allowed: list[str] | None = None) -> tuple[str, str]:
    """Return (vertical, category) for the given texts, searched in priority order.

    `allowed` restricts matches to the verticals a store actually sells, so a
    fashion store's "do not iron" care note can't turn a kurta into an appliance.
    """
    for text in texts:
        if not text:
            continue
        for rule, pattern in _CATEGORY_PATTERNS:
            if allowed and rule.vertical not in allowed:
                continue
            if pattern.search(text):
                return rule.vertical, rule.category
    if allowed and len(allowed) == 1:
        return allowed[0], "other"
    return "other", "other"


def detect_gender(*texts: str | None) -> str | None:
    blob = " ".join(t for t in texts if t)
    if not blob:
        return None
    # Kids first: "girls kurta" must not become women.
    for gender in ("kids", "unisex", "women", "men"):
        if _GENDER_PATTERNS[gender].search(blob):
            return gender
    return None


def detect_color(*texts: str | None) -> str | None:
    for text in texts:
        if text and (m := _COLOR_PATTERN.search(text)):
            value = m.group(1).lower()
            return COLOR_CANONICAL.get(value, value)
    return None


def detect_fabric(*texts: str | None) -> str | None:
    for text in texts:
        if text and (m := _FABRIC_PATTERN.search(text)):
            value = m.group(1).lower()
            return FABRIC_CANONICAL.get(value, value)
    return None


def find_categories_in_text(text: str) -> list[tuple[str, str]]:
    """All (vertical, category) pairs mentioned in free text (used by the query parser)."""
    found: list[tuple[str, str]] = []
    for rule, pattern in _CATEGORY_PATTERNS:
        if pattern.search(text) and (rule.vertical, rule.category) not in found:
            found.append((rule.vertical, rule.category))
    return found
