import pytest

from app.services.normalization.normalizer import RawProduct, clean_title, compute_discount, extract_specs, normalize, parse_price
from app.services.normalization.taxonomy import detect_category, detect_color, detect_fabric, detect_gender


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Men Black Oxford Casual Shirt", ("fashion", "shirt")),
        ("Men Wash and Wear Kameez Shalwar", ("fashion", "shalwar-kameez")),
        ("Embroidered Lawn Kurti", ("fashion", "kurta")),
        ("3PC Lawn Printed Suit", ("fashion", "suit")),
        ("Women Slim Fit Jeans", ("fashion", "jeans")),
        ("Boys Running Sneakers", ("fashion", "sneakers")),
        ("Samsung Galaxy A15 8GB/256GB", ("electronics", "smartphone")),
        ("Lenovo LP40 Pro TWS Earbuds", ("electronics", "earbuds")),
        ("Samsung Galaxy Watch 9 44mm", ("electronics", "smartwatch")),
        ("Samsung Galaxy Buds 3 Pro", ("electronics", "earbuds")),
        ("Samsung Galaxy Watch Fast Wireless Charger", ("electronics", "charger-cable")),
        ("R-012 Rugged Smart Watch Strap", ("electronics", "accessory")),
        ("AirPods Pro Charging Case", ("electronics", "accessory")),
        ("Ronin R-6600 Power Bank 20000mAh", ("electronics", "power-bank")),
        ("Oud Eau De Parfum 100ml", ("beauty", "fragrance")),
        ("King Size Bed Sheet Set", ("home", "bedding")),
    ],
)
def test_detect_category(title, expected):
    assert detect_category(title) == expected


def test_category_respects_store_verticals():
    # A fashion store's care note mentioning "iron" must not make it an appliance.
    assert detect_category("Cambric Printed", "Do not steam iron directly", allowed=["fashion"]) == ("fashion", "other")


def test_plural_matches():
    assert detect_category("best shirts for men")[1] == "shirt"
    assert detect_category("smart watches")[1] == "smartwatch"


@pytest.mark.parametrize(
    ("text", "gender"),
    [
        ("Girls Printed Frock", "kids"),
        ("Women Basic Tee", "women"),
        ("Mens Polo", "men"),
        ("Unisex Cap", "unisex"),
        ("Perfume for Men & Women", "unisex"),
        ("Lawn Suit", None),
    ],
)
def test_detect_gender(text, gender):
    assert detect_gender(text) == gender


def test_detect_color_and_fabric():
    assert detect_color("Navy Blue Khaddar Kurta") == "navy"
    assert detect_color("Off-White Shirt") == "off white"
    assert detect_fabric("Navy Blue Khaddar Kurta") == "khaddar"
    assert detect_fabric("Wash & Wear Suit") == "wash and wear"


@pytest.mark.parametrize(("raw", "value"), [("Rs. 2,499", 2499.0), ("PKR 1,250.50", 1250.5), (999, 999.0), ("", None), ("free", None)])
def test_parse_price(raw, value):
    assert parse_price(raw) == value


def test_discount_and_specs():
    assert compute_discount(750, 1000) == 25.0
    assert compute_discount(1000, 1000) == 0.0
    specs = extract_specs("Infinix Hot 40i 8GB/128GB 5000mAh 6.56 inch")
    assert specs["ram"] == "8GB"
    assert specs["storage"] == "128GB"
    assert specs["battery_mah"] == "5000"


def test_clean_title_strips_sku():
    assert clean_title("Zarnaab - 3 Pc (WU3PSSW26R9O10)") == "Zarnaab - 3 Pc"
    assert clean_title("Black Cotton Trousers - AL-T-856") == "Black Cotton Trousers"
    assert clean_title("Galaxy A15") == "Galaxy A15"


def test_normalize_full_record():
    raw = RawProduct(
        external_id="1",
        title="Women Maroon Embroidered Lawn Kurta",
        url="https://x.pk/products/a",
        price="2,450",
        original_price="3,500",
        brand="",
        description="<p>Soft <b>lawn</b> fabric</p>",
        tags=["Women", "Eid"],
    )
    rec = normalize(raw, store_name="Gul Ahmed", allowed_verticals=["fashion"])
    assert rec["category"] == "kurta" and rec["gender"] == "women"
    assert rec["color"] == "maroon" and rec["fabric"] == "lawn"
    assert rec["discount_percentage"] == 30.0
    assert rec["brand_name"] == "Gul Ahmed"
    assert rec["description"] == "Soft lawn fabric"


def test_normalize_rejects_bad_prices_and_fixes_compare_at():
    assert normalize(RawProduct("1", "Shirt", "u", price=None), store_name="S") is None
    rec = normalize(RawProduct("1", "Shirt", "u", price="1000", original_price="0"), store_name="S")
    assert rec["original_price"] == 1000 and rec["discount_percentage"] == 0


@pytest.mark.parametrize("vendor", ["Men", "BOYS", "Bags", "Pret", "WN_26", "SU-25", "", None])
def test_generic_vendors_fall_back_to_store(vendor):
    rec = normalize(RawProduct("1", "Black Kurta", "u", price=1000, brand=vendor), store_name="J.")
    assert rec["brand_name"] == "J."


def test_real_vendor_is_kept():
    rec = normalize(RawProduct("1", "Galaxy A15", "u", price=1000, brand="Samsung"), store_name="Telemart")
    assert rec["brand_name"] == "Samsung"


# --- audience (men / women / kids) — cases taken from real store data ---------------------------
from app.services.normalization.normalizer import detect_audience  # noqa: E402


@pytest.mark.parametrize(
    ("title", "tags", "sizes", "default", "expected"),
    [
        # Beechtree girls' suit: no kid word in the title, but age sizes and kid tags.
        ("2 PIECE FLORAL EMBROIDERED SUIT", ["11-12Y", "6-7Y", "Pink"], [], None, "kids"),
        ("Basic Polo", [], ["3-4 Years", "5-6 Years"], None, "kids"),
        ("Romper", [], ["6-12M", "12-18M"], None, "kids"),
        # Beechtree women's pret: only internal collection codes; "pret" means womenswear.
        ("SOLID YARN DYED STRIPE SHIRT (PRET)", ["NA-PRET", "MAIN-EMB-PRET"], ["S", "M", "L"], None, "women"),
        ("BASIC STRAIGHT PANTS", ["PRET-BOTTOMS"], ["S", "M"], None, "women"),
        # No signal at all: fall back to the store's audience, else unknown.
        ("EMBROIDERED STRAIGHT PANTS", ["NEW"], ["S", "M"], "women", "women"),
        ("Athleisure Graphic Tee", ["Sale", "New-2025"], ["S", "M", "L"], None, None),
        # Explicit title words beat tags and store defaults.
        ("Men Oxford Check Shirt", ["kids"], [], "women", "men"),
        # A stray "Girls" navigation tag can't make an adult-sized item a kids' item.
        ("Fleece Hoodie", ["Girls Winter Dress"], ["S", "M", "L", "XL"], None, None),
    ],
)
def test_detect_audience(title, tags, sizes, default, expected):
    assert detect_audience(title, None, tags, None, sizes, default) == expected


def test_single_vertical_store_never_falls_back_to_clothing():
    # Saeed Ghani (beauty only): an eye cream must not become a "shirt" via noisy tags.
    rec = normalize(
        RawProduct("1", "Super Bright Under Eye Gel Cream", "u", price=900, tags=["shirt"]), store_name="SG", allowed_verticals=["beauty"]
    )
    assert (rec["vertical"], rec["category"]) == ("beauty", "skincare")
    rec = normalize(RawProduct("2", "Gift Hamper Deluxe", "u", price=900, tags=["shirt"]), store_name="SG", allowed_verticals=["beauty"])
    assert rec["vertical"] == "beauty"


def test_age_sizes_beat_misleading_product_type():
    # Real J. data: boys' kurta whose product_type is the department "Men Division".
    assert detect_audience("Green Formal Kurta Trousers", "Men Division", ["boys&girls-kidboys"], None, ["2 Y", "4 Y", "6 Y"]) == "kids"
    assert (
        detect_audience("Purple Printed Khaddar Slub Stitched 3Pc", "Women Division", ["boys&girls-teengirls"], None, ["12 Y", "14 Y"])
        == "kids"
    )
    # Product type still helps when nothing else does.
    assert detect_audience("Formal Shoes", "Men Division", [], None, ["40", "41"]) == "men"
